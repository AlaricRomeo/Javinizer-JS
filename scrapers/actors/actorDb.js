/**
 * Persistent actor index (SQLite via node:sqlite)
 *
 * Single source of truth for actor identity. Names carry equal weight —
 * primary name and alt names are all rows in actor_names, distinguished only
 * by `kind` ('primary' or 'alt'), so a lookup by any variant is one indexed
 * query and there's no risk of one merge overwriting another's variants.
 * The `actors` table holds only physical attributes and photo references
 * (externalPath, internal cache); it has no name columns.
 *
 * This replaces full-directory NFO scans as the primary lookup path — scans
 * still exist as a cold-start fallback (bin/build-actor-index.js) and feed
 * the index opportunistically as actors are found.
 *
 * Rows are never deleted except via the explicit "delete actor" action.
 * Stale file references self-heal to '' on read instead of being purged
 * reactively, since nothing in the app watches the filesystem for deletes.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { toTitleCase, dedupeAltNames } = require('./schema');

const DB_PATH = path.join(__dirname, '../../data/actors-index.db');
const IMAGE_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png', 'gif'];

let _db = null;

function invertName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

/**
 * Migrate a pre-normalization DB (actors.name/alt_name/other_names columns,
 * actor_names with no `name`/`kind`) to the current schema. No-op on a fresh
 * install (no actors table yet) or one already on the current schema.
 */
function migrateIfNeeded(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tables.includes('actors')) return;

  const actorsCols = db.prepare('PRAGMA table_info(actors)').all().map(c => c.name);
  if (!actorsCols.includes('name')) return; // already normalized

  console.error('[actorDb] Migrating to normalized names schema...');

  // legacy_alter_table=ON stops SQLite from auto-rewriting actor_movies' FK
  // to point at "actors_old" when actors is renamed below — without this,
  // dropping actors_old later cascade-deletes actor_movies along with it.
  // Both pragmas are no-ops inside a transaction, so they're set outside it.
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec('PRAGMA foreign_keys = OFF');

  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE actors RENAME TO actors_old');
    db.exec(`
      CREATE TABLE actors (
        id TEXT PRIMARY KEY,
        birthdate TEXT DEFAULT '',
        height INTEGER DEFAULT 0,
        bust INTEGER DEFAULT 0,
        waist INTEGER DEFAULT 0,
        hips INTEGER DEFAULT 0,
        thumb_url TEXT DEFAULT '',
        thumb_external_file TEXT DEFAULT '',
        thumb_cache_file TEXT DEFAULT '',
        sources TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO actors (id, birthdate, height, bust, waist, hips, thumb_url, thumb_external_file, thumb_cache_file, sources, created_at, updated_at)
      SELECT id, birthdate, height, bust, waist, hips, thumb_url, thumb_external_file, thumb_cache_file, sources, created_at, updated_at
      FROM actors_old
    `);

    db.exec('DROP TABLE IF EXISTS actor_names'); // old shape has no name/kind/id columns
    db.exec(`
      CREATE TABLE actor_names (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        name_inverted_lower TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'alt',
        UNIQUE(actor_id, name_lower)
      )
    `);

    const oldActors = db.prepare('SELECT id, name, alt_name, other_names FROM actors_old').all();
    const insertName = db.prepare(`
      INSERT INTO actor_names (actor_id, name, name_lower, name_inverted_lower, kind)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(actor_id, name_lower) DO NOTHING
    `);
    for (const a of oldActors) {
      if (a.name) {
        insertName.run(a.id, a.name, a.name.toLowerCase().trim(), invertName(a.name).toLowerCase().trim(), 'primary');
      }
      (a.alt_name || '').split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
        insertName.run(a.id, n, n.toLowerCase(), invertName(n).toLowerCase(), 'alt');
      });
      // No separate 'other' kind anymore — former other_names fold into 'alt' too.
      (JSON.parse(a.other_names || '[]') || []).forEach(n => {
        if (!n) return;
        insertName.run(a.id, n, n.toLowerCase(), invertName(n).toLowerCase(), 'alt');
      });
    }

    db.exec('DROP TABLE actors_old');
    db.exec('COMMIT');
    console.error(`[actorDb] Migration complete: ${oldActors.length} actor(s).`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA legacy_alter_table = OFF');
  }
}

function getDb() {
  if (_db) return _db;

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA foreign_keys = ON');

  migrateIfNeeded(_db);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      birthdate TEXT DEFAULT '',
      height INTEGER DEFAULT 0,
      bust INTEGER DEFAULT 0,
      waist INTEGER DEFAULT 0,
      hips INTEGER DEFAULT 0,
      thumb_url TEXT DEFAULT '',
      thumb_external_file TEXT DEFAULT '',
      thumb_cache_file TEXT DEFAULT '',
      sources TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actor_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      name_inverted_lower TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'alt',
      UNIQUE(actor_id, name_lower)
    );
    CREATE INDEX IF NOT EXISTS idx_actor_names_lookup ON actor_names(name_lower);
    CREATE INDEX IF NOT EXISTS idx_actor_names_inverted ON actor_names(name_inverted_lower);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_actor_names_one_primary ON actor_names(actor_id) WHERE kind = 'primary';

    CREATE TABLE IF NOT EXISTS actor_movies (
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      movie_id TEXT NOT NULL,
      PRIMARY KEY (actor_id, movie_id)
    );
  `);

  // Added after the initial actors table shape — existing DBs need it bolted on.
  const actorsCols = _db.prepare('PRAGMA table_info(actors)').all().map(c => c.name);
  if (!actorsCols.includes('favorite')) {
    _db.exec('ALTER TABLE actors ADD COLUMN favorite INTEGER DEFAULT 0');
  }

  // The 'other' name kind was folded into 'alt' (no more primary/alt/other
  // split, just primary/alt) — self-heal any row still on the old kind.
  if (_db.prepare("SELECT 1 FROM actor_names WHERE kind = 'other' LIMIT 1").get()) {
    _db.exec('BEGIN');
    try {
      _db.exec(`
        DELETE FROM actor_names
        WHERE kind = 'other'
        AND EXISTS (
          SELECT 1 FROM actor_names a2
          WHERE a2.actor_id = actor_names.actor_id AND a2.kind = 'alt' AND a2.name_lower = actor_names.name_lower
        )
      `);
      _db.exec("UPDATE actor_names SET kind = 'alt' WHERE kind = 'other'");
      _db.exec('COMMIT');
    } catch (err) {
      _db.exec('ROLLBACK');
      throw err;
    }
  }

  return _db;
}

/**
 * Build the friendly actor object shape used throughout the app (same
 * fields as scrapers/actors/schema.js's createEmptyActor/nfoToActor) from
 * an actors row plus its actor_names rows.
 */
function buildActor(actorRow) {
  if (!actorRow) return null;
  const db = getDb();
  const names = db.prepare('SELECT name, kind FROM actor_names WHERE actor_id = ? ORDER BY id').all(actorRow.id);

  const primary = names.find(n => n.kind === 'primary');
  const alts = names.filter(n => n.kind !== 'primary').map(n => n.name);

  // The internal cache is the one source of truth for the scraper's own photo
  // resolution (see resolvePhotoSource() below for why externalPath isn't
  // used here). thumb_cache_file is the actual filename on disk — usually
  // "{id}.{ext}", but not always: mergeActors() can leave a winner row
  // pointing at a loser's differently-named file (photos are deliberately
  // never renamed on merge/rename), so reconstructing "{id}.{ext}" here
  // instead of using thumb_cache_file verbatim silently 404s in exactly
  // that case.
  const primaryFile = actorRow.thumb_cache_file || '';

  return {
    id: actorRow.id,
    name: primary ? primary.name : actorRow.id,
    altName: alts.join(', '),
    birthdate: actorRow.birthdate || '',
    height: actorRow.height || 0,
    bust: actorRow.bust || 0,
    waist: actorRow.waist || 0,
    hips: actorRow.hips || 0,
    thumbUrl: actorRow.thumb_url || '',
    thumbLocal: actorRow.thumb_cache_file || '',
    thumb: primaryFile ? `/actors/${primaryFile}` : (actorRow.thumb_url || ''),
    favorite: !!actorRow.favorite,
    meta: {
      sources: JSON.parse(actorRow.sources || '[]'),
      lastUpdate: actorRow.updated_at || ''
    }
  };
}

/**
 * Insert a name row for an actor if that exact name isn't already recorded
 * for them (any kind). Never demotes an existing 'primary' row — use
 * setPrimaryName() for that.
 */
function insertNameIfNew(db, actorId, name, kind) {
  if (!name) return;
  const displayName = toTitleCase(name);
  const nameLower = displayName.toLowerCase().trim();
  if (!nameLower) return;
  const invertedLower = invertName(displayName).toLowerCase().trim();
  db.prepare(`
    INSERT INTO actor_names (actor_id, name, name_lower, name_inverted_lower, kind)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(actor_id, name_lower) DO NOTHING
  `).run(actorId, displayName, nameLower, invertedLower, kind);
}

/**
 * Ensure `name` is the actor's primary name — demoting whatever was
 * primary before to 'alt' (never dropped), and promoting/inserting the new
 * one. No-op if `name` is already the current primary.
 */
function setPrimaryName(db, actorId, name) {
  if (!name) return;
  const displayName = toTitleCase(name);
  const nameLower = displayName.toLowerCase().trim();
  if (!nameLower) return;

  const currentPrimary = db.prepare("SELECT * FROM actor_names WHERE actor_id = ? AND kind = 'primary'").get(actorId);
  if (currentPrimary && currentPrimary.name_lower === nameLower && currentPrimary.name === displayName) return;

  db.exec('BEGIN');
  try {
    if (currentPrimary && currentPrimary.name_lower !== nameLower) {
      db.prepare("UPDATE actor_names SET kind = 'alt' WHERE actor_id = ? AND kind = 'primary'").run(actorId);
    }

    const existingRow = db.prepare('SELECT id FROM actor_names WHERE actor_id = ? AND name_lower = ?').get(actorId, nameLower);
    if (existingRow) {
      db.prepare("UPDATE actor_names SET kind = 'primary', name = ? WHERE id = ?").run(displayName, existingRow.id);
    } else {
      const invertedLower = invertName(displayName).toLowerCase().trim();
      db.prepare(`
        INSERT INTO actor_names (actor_id, name, name_lower, name_inverted_lower, kind)
        VALUES (?, ?, ?, ?, 'primary')
      `).run(actorId, displayName, nameLower, invertedLower);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Insert or update an actor from an actor object. Only overwrites a
 * physical-attribute field when the incoming value is non-empty, so a
 * partial online result never blanks out a manually-set field. Name
 * variants (primary/alt/other) are additive — nothing is ever removed by
 * an upsert, only added or (for the primary) reassigned — unless
 * options.replaceNames is set (see below).
 *
 * @param {object} actor - Actor object (id, name, altName, otherNames, ...)
 * @param {object} [options]
 * @param {string} [options.source] - Scraper/context name, merged into sources
 * @param {boolean} [options.replaceNames] - A manual edit from the actor form
 *   is authoritative for alt/other names, unlike a scraper result: if the
 *   user deleted a wrong alt name and saved, it must actually disappear, not
 *   just fail to be re-added. When true, every non-primary name row is wiped
 *   before altName/otherNames are re-inserted from this call — so anything
 *   not present in this call's data is gone. The primary is untouched by
 *   the wipe (handled by setPrimaryName() below), so a name swap never
 *   loses the old primary — it survives, demoted to 'alt'.
 * @returns {object} The merged actor, as returned by getActor()
 */
function upsertActor(actor, options = {}) {
  if (!actor || !actor.id || !actor.name) return null;

  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM actors WHERE id = ?').get(actor.id);

  const pick = (incoming, current, fallback) => {
    if (incoming === undefined || incoming === null || incoming === '') return current !== undefined ? current : fallback;
    if (typeof incoming === 'number' && incoming <= 0) return current !== undefined ? current : fallback;
    return incoming;
  };

  const existingSources = existing ? JSON.parse(existing.sources || '[]') : [];
  const incomingSources = (actor.meta && Array.isArray(actor.meta.sources)) ? actor.meta.sources : (options.source ? [options.source] : []);
  const mergedSources = Array.from(new Set([...existingSources, ...incomingSources]));

  const row = {
    id: actor.id,
    birthdate: pick(actor.birthdate, existing && existing.birthdate, ''),
    height: pick(actor.height, existing && existing.height, 0),
    bust: pick(actor.bust, existing && existing.bust, 0),
    waist: pick(actor.waist, existing && existing.waist, 0),
    hips: pick(actor.hips, existing && existing.hips, 0),
    thumb_url: pick(actor.thumbUrl, existing && existing.thumb_url, ''),
    thumb_external_file: existing ? existing.thumb_external_file : '',
    thumb_cache_file: pick(actor.thumbLocal, existing && existing.thumb_cache_file, ''),
    sources: JSON.stringify(mergedSources),
    created_at: existing ? existing.created_at : now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO actors (id, birthdate, height, bust, waist, hips, thumb_url, thumb_external_file, thumb_cache_file, sources, created_at, updated_at)
    VALUES (@id, @birthdate, @height, @bust, @waist, @hips, @thumb_url, @thumb_external_file, @thumb_cache_file, @sources, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      birthdate=excluded.birthdate, height=excluded.height, bust=excluded.bust, waist=excluded.waist, hips=excluded.hips,
      thumb_url=excluded.thumb_url, thumb_cache_file=excluded.thumb_cache_file,
      sources=excluded.sources, updated_at=excluded.updated_at
  `).run(row);

  if (options.replaceNames) {
    // Wipe non-primary names before setPrimaryName() so a swapped-out old
    // primary (demoted to 'alt' below) survives the wipe instead of being
    // deleted along with the actually-removed names.
    db.prepare("DELETE FROM actor_names WHERE actor_id = ? AND kind != 'primary'").run(actor.id);
  }

  setPrimaryName(db, actor.id, actor.name);

  // otherNames is accepted here (not part of the actor schema, but some
  // scrapers/callers still produce it as a pre-persistence variant list) and
  // folded into the same 'alt' kind as altName — there's no separate 'other'
  // kind of name anymore, just primary + alt.
  const altNames = dedupeAltNames(actor.name, [
    ...(actor.altName || '').split(',').map(s => s.trim()),
    ...(Array.isArray(actor.otherNames) ? actor.otherNames : [])
  ].filter(Boolean));
  altNames.forEach(n => insertNameIfNew(db, actor.id, n, 'alt'));

  return getActor(actor.id);
}

/**
 * Update just the externalPath photo reference for an actor.
 */
function touchExternalFile(actorId, filename) {
  const db = getDb();
  db.prepare('UPDATE actors SET thumb_external_file = ?, updated_at = ? WHERE id = ?')
    .run(filename || '', new Date().toISOString(), actorId);
}

/**
 * Update just the internal cache photo reference for an actor.
 */
function touchCacheFile(actorId, filename) {
  const db = getDb();
  db.prepare('UPDATE actors SET thumb_cache_file = ?, updated_at = ? WHERE id = ?')
    .run(filename || '', new Date().toISOString(), actorId);
}

/**
 * Look up an actor's raw row (physical attributes only, no names) by any
 * known name variant (primary, alt, other — either name order). Returns
 * null if not indexed.
 */
function findActorRowByName(name) {
  if (!name) return null;
  const db = getDb();
  const needle = name.toLowerCase().trim();

  const match = db.prepare(`
    SELECT actor_id FROM actor_names WHERE name_lower = ? OR name_inverted_lower = ? LIMIT 1
  `).get(needle, needle);

  if (!match) return null;

  return db.prepare('SELECT * FROM actors WHERE id = ?').get(match.actor_id);
}

/**
 * Same as findActorRowByName(), returning the friendly actor object shape
 * (includes the resolved primary/alt names).
 */
function findActorByName(name) {
  return buildActor(findActorRowByName(name));
}

function getActorRow(actorId) {
  const db = getDb();
  return db.prepare('SELECT * FROM actors WHERE id = ?').get(actorId);
}

function getActor(actorId) {
  return buildActor(getActorRow(actorId));
}

/**
 * Resolve an actor's existing canonical id from a name and/or alt-name-style
 * hints (comma-separated string or array), trying the primary name first
 * and then each hint in order. Returns null if nothing matches — the
 * caller should treat that as a genuinely new actor.
 */
function resolveId(name, altNameHints) {
  const tryOne = n => {
    const row = findActorRowByName(n);
    return row ? row.id : null;
  };

  const id = tryOne(name);
  if (id) return id;

  const hints = altNameHints
    ? (Array.isArray(altNameHints) ? altNameHints.join(',') : altNameHints).split(',').map(s => s.trim()).filter(Boolean)
    : [];

  for (const h of hints) {
    const hitId = tryOne(h);
    if (hitId) return hitId;
  }

  return null;
}

/**
 * Resolve the actor's photo source to use when copying it somewhere new
 * (e.g. into a movie folder). The internal cache is the single source of
 * truth here — every upload/scrape writes there under the actor's real id,
 * so it's always consistent and never ambiguous. externalPath and a movie
 * folder's own copy are deliberately NOT resolution sources: both can
 * silently disagree with the cache (externalPath is a separately
 * user-curated mirror the app doesn't control the freshness of; a movie
 * folder's copy is per-library-root) — either one "winning" here is exactly
 * how a stale photo gets served after the real one was updated.
 * Self-heals: clears the pointer if the file no longer exists on disk.
 *
 * @param {string} actorId
 * @param {object} paths - { cachePath }
 * @returns {{absolutePath: string, ext: string}|null}
 */
function resolvePhotoSource(actorId, paths) {
  const db = getDb();
  const row = getActorRow(actorId);
  if (!row) return null;

  if (row.thumb_cache_file && paths.cachePath) {
    const p = path.join(paths.cachePath, row.thumb_cache_file);
    if (fs.existsSync(p)) return { absolutePath: p, ext: path.extname(row.thumb_cache_file).replace(/^\./, '') };
    db.prepare('UPDATE actors SET thumb_cache_file = ?, updated_at = ? WHERE id = ?')
      .run('', new Date().toISOString(), actorId);
  }

  return null;
}

/**
 * Record that an actor appears in a movie (idempotent).
 */
function linkMovie(actorId, movieId) {
  if (!actorId || !movieId) return;
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO actor_movies (actor_id, movie_id) VALUES (?, ?)').run(actorId, movieId);
}

/**
 * List the movie ids an actor is known to appear in.
 */
function getMoviesForActor(actorId) {
  const db = getDb();
  return db.prepare('SELECT movie_id FROM actor_movies WHERE actor_id = ?').all(actorId).map(r => r.movie_id);
}

/**
 * Set/unset an actor's favorite flag. Never touched by upsertActor(), so a
 * scraper re-visiting this actor can't silently clear it.
 */
function setFavorite(actorId, favorite) {
  const db = getDb();
  db.prepare('UPDATE actors SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, actorId);
}

/**
 * Find name strings shared by more than one actor — a signal (not proof)
 * that two actor records might represent the same real person, or that a
 * manually-entered alt name collided with someone else's. Detection only;
 * merging requires human judgement, so this never modifies data.
 *
 * @returns {Array<{name: string, actorIds: string[]}>}
 */
function findDuplicateNames() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT name_lower, GROUP_CONCAT(DISTINCT actor_id) as actor_ids
    FROM actor_names
    GROUP BY name_lower
    HAVING COUNT(DISTINCT actor_id) > 1
  `).all();
  return rows.map(r => ({ name: r.name_lower, actorIds: r.actor_ids.split(',') }));
}

/**
 * Groups findDuplicateNames() by the pair of actor ids involved, collecting
 * every shared name for that pair plus a display summary of each side — the
 * shape the merge-review UI (and bin/merge-actors.js) actually wants instead
 * of one row per shared name.
 *
 * @returns {Array<{ids: string[], sharedNames: string[], actors: object[]}>}
 */
function findDuplicateGroups() {
  const duplicates = findDuplicateNames();
  const pairs = new Map();

  duplicates.forEach(d => {
    const ids = [...d.actorIds].sort();
    const key = ids.join('|');
    if (!pairs.has(key)) pairs.set(key, { ids, sharedNames: [] });
    pairs.get(key).sharedNames.push(d.name);
  });

  return Array.from(pairs.values()).map(({ ids, sharedNames }) => ({
    ids,
    sharedNames,
    actors: ids.map(id => {
      const actor = getActor(id);
      const movies = getMoviesForActor(id);
      return actor ? { ...actor, movieCount: movies.length } : { id, movieCount: 0 };
    })
  }));
}

/**
 * Permanently remove an actor and its name/movie references.
 * Explicit-only — never called as a side effect of a cache clear.
 */
function deleteActor(actorId) {
  const db = getDb();
  db.prepare('DELETE FROM actors WHERE id = ?').run(actorId);
}

/**
 * Full name breakdown for an actor (primary + alt names as an array) — for
 * display purposes (e.g. bin/merge-actors.js), where getActor()'s flattened
 * altName string isn't detailed enough.
 */
function getActorNames(actorId) {
  const db = getDb();
  const rows = db.prepare('SELECT name, kind FROM actor_names WHERE actor_id = ? ORDER BY id').all(actorId);
  return {
    primary: (rows.find(r => r.kind === 'primary') || {}).name || null,
    alt: rows.filter(r => r.kind !== 'primary').map(r => r.name)
  };
}

/**
 * Every name variant known for the actor matching `name` (primary + all alt
 * names), or just `[name]` if the index has no record of them. Movie search
 * (routes.js's getSearchIndex(), grid.js) needs this instead of trusting a
 * single movie's own possibly-stale/partial NFO altname — the central index
 * is where a newly-learned alias (e.g. from a later rescrape or manual edit)
 * actually lands, and a movie's own NFO never gets refreshed from it after
 * the fact, so two movies of the same actor scraped at different times can
 * disagree on which name variants they hold.
 */
function resolveAliases(name) {
  if (!name) return [];
  const row = findActorRowByName(name);
  if (!row) return [name];
  const names = getActorNames(row.id);
  return [names.primary, ...names.alt].filter(Boolean);
}

/**
 * Remove a single alt name from an actor — e.g. to resolve a false
 * duplicate-name match (findDuplicateNames()) that turned out to just be an
 * unwanted alias rather than the same person. Never removes the primary
 * name (that's a rename, not a removal — use setPrimaryName() for that).
 *
 * @returns {boolean} true if a row was actually removed
 */
function removeName(actorId, name) {
  const db = getDb();
  const nameLower = String(name || '').toLowerCase().trim();
  if (!nameLower) return false;
  const result = db.prepare(
    "DELETE FROM actor_names WHERE actor_id = ? AND name_lower = ? AND kind != 'primary'"
  ).run(actorId, nameLower);
  return result.changes > 0;
}

/**
 * Merge loserId into winnerId: every name variant of the loser (its primary
 * demoted to 'alt') and every movie link is moved onto the winner; any
 * physical field the winner has empty is filled from the loser unless
 * `fieldOverrides` says otherwise; sources are unioned. The loser row is
 * then deleted (cascades to its own now-empty actor_names/actor_movies
 * rows). Photo files on disk are left untouched — anything still pointing
 * at the loser's id by filename (an old movie's own NFO, for instance)
 * keeps resolving, since /actors/* serves by filename, not by DB row.
 *
 * @param {string} winnerId - the id that survives
 * @param {string} loserId - the id that gets merged away and deleted
 * @param {object} [fieldOverrides] - explicit values for any of birthdate/
 *   height/bust/waist/hips/thumb_url/thumb_external_file/thumb_cache_file,
 *   used instead of "fill winner's empty field from loser" when the caller
 *   already resolved a conflict (both non-empty and different).
 * @returns {object} the merged actor (getActor(winnerId))
 */
function mergeActors(winnerId, loserId, fieldOverrides = {}) {
  if (!winnerId || !loserId || winnerId === loserId) {
    throw new Error('mergeActors requires two distinct actor ids');
  }

  const db = getDb();
  const winner = getActorRow(winnerId);
  const loser = getActorRow(loserId);
  if (!winner || !loser) throw new Error('mergeActors: both ids must exist');

  db.exec('BEGIN');
  try {
    const fields = ['birthdate', 'height', 'bust', 'waist', 'hips', 'thumb_url', 'thumb_external_file', 'thumb_cache_file'];
    const merged = {};
    fields.forEach(f => {
      if (fieldOverrides[f] !== undefined) {
        merged[f] = fieldOverrides[f];
      } else {
        const winnerEmpty = winner[f] === '' || winner[f] === 0 || winner[f] === null;
        merged[f] = (winnerEmpty && loser[f]) ? loser[f] : winner[f];
      }
    });
    const mergedSources = Array.from(new Set([...JSON.parse(winner.sources || '[]'), ...JSON.parse(loser.sources || '[]')]));

    db.prepare(`
      UPDATE actors SET
        birthdate=?, height=?, bust=?, waist=?, hips=?,
        thumb_url=?, thumb_external_file=?, thumb_cache_file=?,
        sources=?, updated_at=?
      WHERE id=?
    `).run(
      merged.birthdate, merged.height, merged.bust, merged.waist, merged.hips,
      merged.thumb_url, merged.thumb_external_file, merged.thumb_cache_file,
      JSON.stringify(mergedSources), new Date().toISOString(), winnerId
    );

    // Every one of the loser's names moves onto the winner as an alt name —
    // including its former primary, since the winner already has its own.
    db.prepare(`
      INSERT INTO actor_names (actor_id, name, name_lower, name_inverted_lower, kind)
      SELECT ?, name, name_lower, name_inverted_lower, 'alt'
      FROM actor_names WHERE actor_id = ?
      ON CONFLICT(actor_id, name_lower) DO NOTHING
    `).run(winnerId, loserId);

    db.prepare(`
      INSERT INTO actor_movies (actor_id, movie_id)
      SELECT ?, movie_id FROM actor_movies WHERE actor_id = ?
      ON CONFLICT(actor_id, movie_id) DO NOTHING
    `).run(winnerId, loserId);

    db.prepare('DELETE FROM actors WHERE id = ?').run(loserId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getActor(winnerId);
}

module.exports = {
  getDb,
  upsertActor,
  touchExternalFile,
  touchCacheFile,
  findActorByName,
  findActorRowByName,
  getActor,
  resolveId,
  resolvePhotoSource,
  linkMovie,
  getMoviesForActor,
  findDuplicateNames,
  findDuplicateGroups,
  getActorNames,
  resolveAliases,
  removeName,
  mergeActors,
  deleteActor,
  setFavorite,
  IMAGE_EXTENSIONS
};
