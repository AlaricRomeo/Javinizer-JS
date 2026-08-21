const { readNfo } = require("./readNfo");
const { mapNfoToModel } = require("./nfoMapper");
const { enrichModelWithLocalMedia } = require("./localMediaMapper");

/**
 * Builds the complete canonical model
 * from a filesystem item
 *
 * @param {object} item - Filesystem item ({id, path, nfo})
 * @param {Map} [actorCache] - Optional actorDb.findActorByName() memo, shared
 *   across a batch of buildItem() calls (e.g. GET /library-list's Promise.all
 *   over the whole library) so the same actor recurring across many movies
 *   costs one SQLite lookup instead of one per appearance. A single-item
 *   call site can omit it — a fresh, one-off Map is cheap for one item.
 */
async function buildItem(item, actorCache) {
  if (!item || !item.nfo) return null;

  // 1. read NFO (raw XML)
  const parsedXml = await readNfo(item.nfo);

  // 2. map to canonical model
  let model = mapNfoToModel(parsedXml);

  if (!model) return null;

  // 3. enrich with local data
  model = enrichModelWithLocalMedia(model, item, actorCache || new Map());

  // 4. add folder ID for save operations (folder name, not video code)
  model.folderId = item.id;

  return model;
}

module.exports = { buildItem };
