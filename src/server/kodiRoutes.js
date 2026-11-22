const express = require("express");
const fs = require("fs");
const path = require("path");
const { loadConfig, resolveLibraryFolder } = require("../core/config");
const kodiAuth = require("../core/kodiAuth");
const { resolveKodiPath, hostFromRequest } = require("../core/kodiPaths");
const kodiProgress = require("../core/kodiProgress");
const { imageType } = require("../core/imageType");

/**
 * Read-only API for the Kodi add-on (kodi/plugin.video.javinizer).
 *
 * Everything is served from the in-memory NFO cache shared with search
 * (routes.js libraryApi) — no per-movie disk I/O while browsing. The disk is
 * only touched when Kodi fetches an image (and caches it) or starts playback.
 */
const router = express.Router();

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".webm", ".flv", ".iso"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const INDEX_WAIT_MS = 8000;
const ACTOR_CACHE_TTL_MS = 60000;

function libraryApi() {
  return require("./routes").libraryApi;
}

// ─────────────────────────────
// Auth
// ─────────────────────────────
function getToken(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return typeof req.query.t === "string" ? req.query.t : "";
}

// Null when the add-on is switched off or has no password: API disabled
function passwordHash() {
  const cfg = loadConfig();
  return cfg.kodi && cfg.kodi.enabled && cfg.kodi.passwordHash ? cfg.kodi.passwordHash : null;
}

router.post("/login", async (req, res) => {
  const hash = passwordHash();
  if (!hash) return res.status(403).json({ ok: false, error: "Kodi access is disabled: enable the Kodi add-on and set its password in the Javinizer-js configuration" });

  const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
  if (!kodiAuth.verifyPassword(password, hash)) {
    // Slow down guessing
    await new Promise(resolve => setTimeout(resolve, 1000));
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }
  res.json({ ok: true, token: kodiAuth.issueToken(req.body.device) });
});

router.use((req, res, next) => {
  if (!passwordHash()) return res.status(403).json({ ok: false, error: "Kodi access is disabled: enable the Kodi add-on and set its password in the Javinizer-js configuration" });
  if (!kodiAuth.isValidToken(getToken(req))) return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  next();
});

router.post("/logout", (req, res) => {
  kodiAuth.revokeToken(getToken(req));
  res.json({ ok: true });
});

// POST /kodi/progress {id, position, total} — from the add-on's player service
router.post("/progress", (req, res) => {
  const body = req.body || {};
  const position = Number(body.position), total = Number(body.total);
  if (typeof body.id !== "string" || !resolveLibraryFolder(loadConfig(), body.id) ||
      !Number.isFinite(position) || !Number.isFinite(total)) {
    return res.status(400).json({ ok: false, error: "Invalid progress" });
  }
  res.json({ ok: true, saved: kodiProgress.setProgress(body.id, position, total) });
});

// ─────────────────────────────
// Library snapshot
// ─────────────────────────────
function decodeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function actorVersion(dbActor) {
  return (dbActor.meta && dbActor.meta.lastUpdate) || "";
}

let _actorCache = new Map();
let _actorCacheAt = 0;

/**
 * Actor identity for a cast name: the actor index record when known (so
 * aliases across movies collapse into one actor), else the bare name.
 */
function resolveActor(name) {
  if (Date.now() - _actorCacheAt > ACTOR_CACHE_TTL_MS) {
    _actorCache = new Map();
    _actorCacheAt = Date.now();
  }
  const key = name.toLowerCase();
  if (_actorCache.has(key)) return _actorCache.get(key);

  let actor;
  try {
    const dbActor = require("../../scrapers/actors/actorDb").findActorByName(name);
    if (dbActor) {
      actor = {
        id: dbActor.id,
        name: decodeXml(dbActor.name),
        favorite: !!dbActor.favorite,
        // ?v= changes with the record, so Kodi's texture cache (keyed by
        // URL) refetches a replaced photo instead of showing the old one
        thumb: dbActor.thumbLocal
          ? `/kodi/actor-art/${encodeURIComponent(dbActor.thumbLocal)}?v=${encodeURIComponent(actorVersion(dbActor))}`
          : (/^https?:\/\//.test(dbActor.thumbUrl) ? dbActor.thumbUrl : ""),
        version: actorVersion(dbActor)
      };
    }
  } catch (_) {}
  if (!actor) actor = { id: `name:${key}`, name: decodeXml(name), favorite: false, thumb: "" };

  _actorCache.set(key, actor);
  return actor;
}

function toMovie(item, data) {
  const id = item.id;
  const q = `id=${encodeURIComponent(id)}`;
  const code = decodeXml(data.code) || path.basename(id);
  return {
    id,
    code,
    title: decodeXml(data.title) || code,
    originalTitle: decodeXml(data.originalTitle),
    plot: decodeXml(data.plot),
    premiered: data.premiered || "",
    year: parseInt(data.year, 10) || (data.premiered ? parseInt(data.premiered.slice(0, 4), 10) || 0 : 0),
    // Fallback: NFO mtime, for NFOs written without <dateadded>
    dateAdded: data.dateAdded || (data.mtimeMs ? new Date(data.mtimeMs).toISOString().slice(0, 19).replace("T", " ") : ""),
    runtime: parseInt(data.runtime, 10) || 0,
    studio: decodeXml(data.studio),
    director: decodeXml(data.director),
    genres: (data.genres || []).map(decodeXml),
    // Cast photos: the library photo first, then the movie's own .actors/
    // copy (resolved lazily by /actor-thumb, no disk I/O while listing).
    // "l" in ?v= marks the library-first order, so Kodi drops the copies it cached before
    actors: (data.actorNames || []).map(name => {
      const actor = resolveActor(name);
      const v = `l${Math.round(data.mtimeMs || 0)}-${actor.version || ""}`;
      return {
        id: actor.id,
        name: actor.name,
        favorite: actor.favorite,
        thumb: `/kodi/actor-thumb?${q}&name=${encodeURIComponent(name)}&v=${encodeURIComponent(v)}`
      };
    }),
    poster: `/kodi/art?${q}&type=poster`,
    fanart: `/kodi/art?${q}&type=fanart`
  };
}

/**
 * All library movies, or null while the index is still being built (a cold
 * start reads every NFO; a request must not hang for minutes on that).
 */
async function getMovies() {
  const api = libraryApi();
  if (api.isSearchIndexStale()) {
    const build = api.ensureSearchIndex().catch(err => console.error("[kodi] Index build failed:", err.message));
    await Promise.race([build, new Promise(resolve => setTimeout(resolve, INDEX_WAIT_MS))]);
    if (api.isSearchIndexStale()) return null;
  }
  return api.libraryReader.items
    .map(item => {
      const data = api.getNfoData(item.id);
      return data ? toMovie(item, data) : null;
    })
    .filter(Boolean);
}

function notReady(res) {
  const progress = libraryApi().getSearchIndexProgress();
  res.status(503).json({ ok: false, error: "Library index is still loading", ...progress });
}

// ─────────────────────────────
// GET /kodi/addon, /kodi/addon.zip — add-on self-update (updater.py)
// ─────────────────────────────
function addonSourceVersion() {
  const { ADDON_DIR } = require("../core/kodiAddonZip");
  const xml = fs.readFileSync(path.join(ADDON_DIR, "addon.xml"), "utf8");
  const match = xml.match(/<addon\b[^>]*\bversion="([^"]+)"/);
  return match ? match[1] : "";
}

router.get("/addon", (req, res) => {
  try {
    res.json({ ok: true, version: addonSourceVersion() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/addon.zip", (req, res) => {
  try {
    const { buildKodiAddonZip, ZIP_PATH, ADDON_DIR } = require("../core/kodiAddonZip");
    // Rebuilt when the add-on sources changed after the last build
    const stale = !fs.existsSync(ZIP_PATH) ||
      fs.statSync(path.join(ADDON_DIR, "addon.xml")).mtimeMs > fs.statSync(ZIP_PATH).mtimeMs;
    if (stale) buildKodiAddonZip();
    res.type("application/zip");
    fs.createReadStream(ZIP_PATH).on("error", () => res.status(500).end()).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /kodi/movies
//   sort=code|title|dateadded|premiered|runtime|random  order=asc|desc
//   q (search syntax), actor (actor id), genre, studio, ids (comma list)
//   inprogress=1 (resume points only, last played first)
//   offset, limit (0 = all)
// ─────────────────────────────
const SORT_KEYS = {
  code: m => m.code,
  title: m => m.title,
  dateadded: m => m.dateAdded,
  premiered: m => m.premiered,
  runtime: m => m.runtime
};

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

router.get("/movies", async (req, res) => {
  try {
    let movies = await getMovies();
    if (!movies) return notReady(res);

    movies = movies.map(m => ({ ...m, resume: kodiProgress.getProgress(m.id) }));
    const { q, actor, genre, studio, ids } = req.query;
    const inProgress = req.query.inprogress === "1";
    if (inProgress) movies = movies.filter(m => m.resume);
    if (typeof ids === "string" && ids) {
      const idSet = new Set(ids.split(","));
      movies = movies.filter(m => idSet.has(m.id));
    }
    if (typeof q === "string" && q.trim()) {
      const matchIds = new Set((await libraryApi().matchSearchIndex(q.trim())).map(e => e.id));
      movies = movies.filter(m => matchIds.has(m.id));
    }
    if (typeof actor === "string" && actor) movies = movies.filter(m => m.actors.some(a => a.id === actor));
    if (typeof genre === "string" && genre) {
      const g = genre.toLowerCase();
      movies = movies.filter(m => m.genres.some(x => x.toLowerCase() === g));
    }
    if (typeof studio === "string" && studio) {
      const s = studio.toLowerCase();
      movies = movies.filter(m => m.studio.toLowerCase() === s);
    }

    const sort = String(req.query.sort || "code");
    if (inProgress) {
      movies.sort((a, b) => b.resume.updatedAt.localeCompare(a.resume.updatedAt));
    } else if (sort === "random") {
      shuffle(movies);
    } else {
      const key = SORT_KEYS[sort] || SORT_KEYS.code;
      const dir = req.query.order === "desc" ? -1 : 1;
      movies.sort((a, b) => {
        const va = key(a), vb = key(b);
        const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
        return c * dir;
      });
    }

    const total = movies.length;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);
    const items = limit ? movies.slice(offset, offset + limit) : movies.slice(offset);

    res.json({ ok: true, total, offset, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /kodi/actors — actors with at least one movie in the library
// ─────────────────────────────
router.get("/actors", async (req, res) => {
  try {
    const movies = await getMovies();
    if (!movies) return notReady(res);

    const byId = new Map();
    for (const movie of movies) {
      for (const actor of movie.actors) {
        const entry = byId.get(actor.id);
        if (entry) entry.count++;
        // Library photo for the actor list; actors missing from the index
        // keep the first movie's .actors/ copy
        else byId.set(actor.id, { ...actor, thumb: resolveActor(actor.name).thumb || actor.thumb, count: 1 });
      }
    }
    let actors = [...byId.values()];
    if (req.query.favorites === "1") actors = actors.filter(a => a.favorite);
    actors.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    res.json({ ok: true, actors });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
// GET /kodi/genres, /kodi/studios — names with movie counts
// ─────────────────────────────
function countBy(movies, valuesOf) {
  const counts = new Map();
  for (const movie of movies) {
    for (const value of valuesOf(movie)) {
      if (!value) continue;
      const key = value.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { name: value, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

router.get("/genres", async (req, res) => {
  const movies = await getMovies();
  if (!movies) return notReady(res);
  res.json({ ok: true, genres: countBy(movies, m => m.genres) });
});

router.get("/studios", async (req, res) => {
  const movies = await getMovies();
  if (!movies) return notReady(res);
  res.json({ ok: true, studios: countBy(movies, m => [m.studio]) });
});

// ─────────────────────────────
// Images
// ─────────────────────────────
// Kodi gets jpeg/png only, detected from the content (not the extension)
function sendImage(res, filePath) {
  let type = "";
  try { type = imageType(filePath); } catch (_) { return res.status(404).end(); }
  if (type === "jpeg" || type === "png") {
    res.setHeader("Content-Type", `image/${type}`);
    return fs.createReadStream(filePath)
      .on("error", () => { if (!res.headersSent) res.status(404).end(); })
      .pipe(res);
  }
  require("sharp")(filePath).jpeg({ quality: 92 }).toBuffer()
    .then(buffer => res.type("image/jpeg").send(buffer))
    .catch(() => res.status(500).end());
}

// Same priority as localMediaMapper.js: folder > poster > *-thumb, *fanart
function findArt(files, type) {
  const images = files.filter(f => IMAGE_EXTENSIONS.includes(f.split(".").pop().toLowerCase()));
  const base = f => f.slice(0, f.lastIndexOf(".")).toLowerCase();
  const patterns = type === "fanart"
    ? [b => b === "fanart", b => b.endsWith("fanart")]
    : [b => b === "folder", b => b === "poster", b => b.endsWith("poster"), b => b.endsWith("-thumb")];
  for (const match of patterns) {
    const found = images.find(f => match(base(f)));
    if (found) return found;
  }
  return null;
}

router.get("/art", (req, res) => {
  try {
    const folder = resolveLibraryFolder(loadConfig(), String(req.query.id || ""));
    if (!folder) return res.status(404).end();
    const file = findArt(fs.readdirSync(folder), req.query.type === "fanart" ? "fanart" : "poster");
    if (!file) return res.status(404).end();
    sendImage(res, path.join(folder, file));
  } catch (err) {
    res.status(500).end();
  }
});

function libraryActorPhoto(file) {
  if (!file) return null;
  const { getActorsCachePath } = require("../../scrapers/actors/cache-helper");
  const filePath = path.join(getActorsCachePath(), path.basename(file));
  return fs.existsSync(filePath) ? filePath : null;
}

router.get("/actor-art/:file", (req, res) => {
  const filePath = libraryActorPhoto(req.params.file);
  if (!filePath) return res.status(404).end();
  sendImage(res, filePath);
});

// GET /kodi/actor-thumb?id=&name= — cast photo for one movie: the actor
// library photo (always the live source, as in the web UI), else the movie's
// .actors/<Name_With_Underscores>.jpg|png copy, else the actor's online photo
router.get("/actor-thumb", (req, res) => {
  try {
    const name = String(req.query.name || "");
    if (!name) return res.status(404).end();
    const dbActor = require("../../scrapers/actors/actorDb").findActorByName(name);
    const filePath = dbActor && libraryActorPhoto(dbActor.thumbLocal);
    if (filePath) return sendImage(res, filePath);
    const folder = resolveLibraryFolder(loadConfig(), String(req.query.id || ""));
    if (folder) {
      const { ACTORS_DIR, KODI_ACTOR_EXTENSIONS, actorFileBase } = require("../core/kodiActors");
      const base = path.join(folder, ACTORS_DIR, actorFileBase(name));
      const local = KODI_ACTOR_EXTENSIONS.map(ext => `${base}.${ext}`).find(p => fs.existsSync(p));
      if (local) return sendImage(res, local);
    }
    if (dbActor && /^https?:\/\//.test(dbActor.thumbUrl)) return res.redirect(dbActor.thumbUrl);
    res.status(404).end();
  } catch (err) {
    res.status(500).end();
  }
});

// ─────────────────────────────
// GET /kodi/play?id= — path Kodi should open (manual pathMap or Samba
// auto-detection, see src/core/kodiPaths.js)
// ─────────────────────────────
router.get("/play", (req, res) => {
  try {
    const cfg = loadConfig();
    const folder = resolveLibraryFolder(cfg, String(req.query.id || ""));
    if (!folder) return res.status(404).json({ ok: false, error: "Movie not found" });

    const videos = fs.readdirSync(folder)
      .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .filter(f => !/(^|[-_. ])(trailer|sample)([-_. ]|$)/i.test(path.parse(f).name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (videos.length === 0) return res.status(404).json({ ok: false, error: "No video file in the movie folder" });

    const host = hostFromRequest(req);
    const mapped = videos.map(v => resolveKodiPath(path.join(folder, v), cfg, host));
    if (mapped.some(m => !m)) return res.status(409).json({ ok: false, error: `No Samba share or Kodi path mapping covers ${folder}` });

    // Multi-part movies (CD1/CD2...) play as one Kodi stack
    const paths = mapped.map(m => m.path);
    const playPath = paths.length === 1 ? paths[0] : `stack://${paths.map(p => p.replace(/,/g, ",,")).join(" , ")}`;
    res.json({ ok: true, path: playPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
