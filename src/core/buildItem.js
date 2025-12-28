const { readNfo } = require("./readNfo");
const { mapNfoToModel } = require("./nfoMapper");
const { enrichModelWithLocalMedia } = require("./localMediaMapper");

/**
 * Builds the complete canonical model
 * from a filesystem item
 */
async function buildItem(item) {
  if (!item || !item.nfo) return null;

  // 1. read NFO (raw XML)
  const parsedXml = await readNfo(item.nfo);

  // 2. map to canonical model
  let model = mapNfoToModel(parsedXml);

  if (!model) return null;

  // 3. enrich with local data
  model = enrichModelWithLocalMedia(model, item);

  return model;
}

module.exports = { buildItem };
