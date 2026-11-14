const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Formats a date as Kodi's <dateadded> value: "YYYY-MM-DD HH:MM:SS" (local time)
 * @param {Date} date
 * @returns {string}
 */
function formatNfoDate(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const ucFirst = str => str ? str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : str;

const isRemoteUrl = v => typeof v === "string" && /^https?:\/\//i.test(v);

/**
 * Actor <thumb> written to the movie NFO. Kodi/Jellyfin can't resolve
 * javinizer-js internal paths (e.g. "/actors/x.webp"), so prefer the actor's
 * remote URL. javinizer-js itself never relies on this value when it has
 * better: the UI resolves .actors/ first, then the central actor store, and
 * only then this URL (see localMediaMapper.js / createActorThumbnail).
 * Falls back to the original value when no remote URL is known.
 * @param {{name?: string, thumb?: string, thumbUrl?: string}} actor
 * @returns {string}
 */
function nfoActorThumb(actor) {
  const thumb = actor.thumb || "";
  if (isRemoteUrl(thumb)) return thumb;
  if (isRemoteUrl(actor.thumbUrl)) return actor.thumbUrl;
  try {
    const dbActor = actor.name ? require("../../scrapers/actors/actorDb").findActorByName(actor.name) : null;
    if (dbActor && isRemoteUrl(dbActor.thumbUrl)) return dbActor.thumbUrl;
  } catch (err) {
    console.error(`[saveNfo] Actor lookup failed for ${actor.name}:`, err.message);
  }
  return thumb;
}

/**
 * Maps canonical model field names
 * to XML NFO field names (bidirectional)
 */
const fieldMapping = {
  originalTitle: "originaltitle",
  releaseDate: "premiered",
  dateAdded: "dateadded",
  contentRating: "mpaa",
  genres: "genre",
  tags: "tag",
  coverUrl: "coverurl",
  screenshotUrl: "screenshoturl",
  trailerUrl: "trailer"
};

/**
 * Converts a canonical model field to XML NFO format
 * @param {string} key - Field name
 * @param {*} value - Field value
 * @returns {object} - Object with xmlKey and xmlValue
 */
function modelFieldToXml(key, value) {
  const xmlKey = fieldMapping[key] || key;

  // Handle empty fields
  if (value === null || value === undefined || value === "") {
    return { xmlKey, xmlValue: [""] };
  }

  // Handle simple fields (strings and numbers)
  if (typeof value === "string" || typeof value === "number") {
    return { xmlKey, xmlValue: [String(value)] };
  }

  // Handle simple arrays (genres, tags)
  if (Array.isArray(value)) {
    // Actor array (complex structure)
    if (xmlKey === "actor") {
      return {
        xmlKey,
        xmlValue: value.map(actor => ({
          name: [actor.name || ""],
          altname: [actor.altName || ""],
          role: [actor.role || ""],
          thumb: [nfoActorThumb(actor)]
        }))
      };
    }
    // Simple arrays (genres, tags) — title-case each entry
    return { xmlKey, xmlValue: value.map(v => ucFirst(String(v))) };
  }

  // Handle complex objects
  if (typeof value === "object") {
    // Rating (splits into two fields)
    if (xmlKey === "rating") {
      return {
        xmlKey: "rating",
        xmlValue: [String(value.value || "")],
        extra: { votes: [String(value.votes || "")] }
      };
    }
  }

  return { xmlKey, xmlValue: [String(value)] };
}

/**
 * Saves changes to NFO file preserving all existing fields
 * PATCH mode: modifies only specified fields
 * @param {string} nfoPath - Path to .nfo file
 * @param {object} changes - Object with changes to apply
 */
async function saveNfoPatch(nfoPath, changes) {
  const xml = fs.readFileSync(nfoPath, "utf8");

  // backup
  fs.writeFileSync(nfoPath + ".bak", xml, "utf8");

  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder({
    headless: true,
    renderOpts: {
      pretty: true,
      indent: "  ",
      newline: "\n",
      allowEmpty: true
    },
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: false }
  });

  const parsed = await parser.parseStringPromise(xml);
  const movie = parsed.movie;

  // Apply each change using helper function
  for (const key in changes) {
    const result = modelFieldToXml(key, changes[key]);

    // Apply main value
    movie[result.xmlKey] = result.xmlValue;

    // Apply any extra fields (e.g. votes for rating)
    if (result.extra) {
      Object.assign(movie, result.extra);
    }
  }

  const newXml = builder.buildObject(parsed);
  fs.writeFileSync(nfoPath, newXml, "utf8");
}

/**
 * Saves the entire canonical model as NFO
 * FULL mode: creates a new complete NFO (used by scraper)
 * @param {string} nfoPath - Path to .nfo file
 * @param {object} model - Complete canonical model
 */
async function saveNfoFull(nfoPath, model) {
  // backup if already exists — and keep its <dateadded>: a rescrape must
  // not reset when the movie was first added to the library
  let existingDateAdded = "";
  if (fs.existsSync(nfoPath)) {
    const xml = fs.readFileSync(nfoPath, "utf8");
    fs.writeFileSync(nfoPath + ".bak", xml, "utf8");
    existingDateAdded = (xml.match(/<dateadded>([^<]*)<\/dateadded>/i)?.[1] || "").trim();
  }

  const builder = new xml2js.Builder({
    headless: true,
    renderOpts: {
      pretty: true,
      indent: "  ",
      newline: "\n",
      allowEmpty: true
    },
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: false }
  });

  // Build movie structure from scratch
  const movie = {};

  // Required simple fields
  movie.title = [model.title || ""];
  movie.originaltitle = [model.originalTitle || ""];
  movie.id = [model.id || model.code || ""];
  movie.premiered = [model.releaseDate || ""];
  movie.year = model.releaseDate ? [model.releaseDate.substring(0, 4)] : [""];
  movie.dateadded = [model.dateAdded || existingDateAdded || formatNfoDate(new Date())];
  movie.director = [model.director || ""];
  movie.studio = [model.studio || ""];
  movie.label = [model.label || ""];
  movie.rating = [model.rating?.value ? String(model.rating.value) : ""];
  movie.votes = [model.rating?.votes ? String(model.rating.votes) : ""];
  movie.plot = [model.plot || ""];
  movie.runtime = [model.runtime ? String(model.runtime) : ""];
  movie.trailer = [model.trailerUrl || ""];
  movie.mpaa = [model.contentRating || "XXX"];
  movie.tagline = [model.tagline || ""];
  movie.set = [model.series || ""];
  movie.thumb = [""];
  movie.coverurl = [model.coverUrl || ""];
  movie.screenshoturl = [model.screenshotUrl || ""];

  // Genres (array)
  if (model.genres && model.genres.length > 0) {
    movie.genre = model.genres.map(ucFirst);
  }

  // Tags (array)
  if (model.tags && model.tags.length > 0) {
    movie.tag = model.tags.map(ucFirst);
  }

  // Actors (complex array)
  if (model.actor && model.actor.length > 0) {
    movie.actor = model.actor.map(a => ({
      name: [a.name || ""],
      altname: [a.altName || ""],
      thumb: [nfoActorThumb(a)],
      role: [a.role || "Actress"]
    }));
  }

  const newXml = builder.buildObject({ movie });
  fs.writeFileSync(nfoPath, newXml, "utf8");
}

module.exports = { saveNfoPatch, saveNfoFull, formatNfoDate, nfoActorThumb };
