/**
 * Rebuilds the actor_movies index (scrapers/actors/actorDb.js) from
 * scratch by reading every item's actor list straight out of its NFO.
 *
 * actor_movies has no per-row library reference — it's simply wiped and
 * rewritten wholesale every time this runs, which only ever happens right
 * after a library-path change (the one event that already invalidates
 * libraryReader's own on-disk cache — see POST /config in routes.js). A
 * plain server restart on the same path reuses that cache and never
 * touches this at all, so the cost (one NFO read per item) is paid only
 * when the library actually changes, not on every boot.
 */
const { buildItem } = require("./buildItem");
const actorDb = require("../../scrapers/actors/actorDb");

/**
 * @param {object} libraryReader - Already pointed at the current library
 *   and freshly loaded (items populated) by the caller.
 * @param {(msg: string) => void} [onProgress] - Optional progress callback,
 *   called occasionally (not per item) with a human-readable status line.
 * @returns {Promise<{total: number, links: number}>}
 */
async function rebuildActorMoviesIndex(libraryReader, onProgress) {
  // loadLibrary() only loads one batch per call (see libraryReader.js) —
  // loadAll() is the only way to guarantee every item is actually present
  // before scanning. Safe here (unlike in a request handler): this always
  // runs in its own standalone process (see bin/rebuild-actor-movies.js),
  // never inside the live server, so blocking is fine.
  if (!libraryReader.fullyLoaded) libraryReader.loadAll();

  const items = libraryReader.items;
  const actorCache = new Map();
  const pairs = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const model = await buildItem(item, actorCache);
      if (model && Array.isArray(model.actor)) {
        for (const actor of model.actor) {
          if (actor.id) pairs.push({ actorId: actor.id, movieId: item.id });
        }
      }
    } catch (err) {
      // A stale/unreadable NFO shouldn't abort the whole rebuild — just
      // contributes no links for this item, same tolerance as GET /library-list.
      console.error(`[actor-movies] Skipping unreadable item ${item.id}: ${err.message}`);
    }

    if (onProgress && (i % 250 === 0 || i === items.length - 1)) {
      onProgress(`Scanned ${i + 1}/${items.length} movies`);
    }
  }

  actorDb.rebuildAllActorMovies(pairs);
  return { total: items.length, links: pairs.length };
}

module.exports = { rebuildActorMoviesIndex };
