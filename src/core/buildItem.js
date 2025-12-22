const { readNfo } = require("./readNfo");
const { mapNfoToModel } = require("./nfoMapper");
const { enrichModelWithLocalMedia } = require("./localMediaMapper");

/**
 * Costruisce il modello canonico completo
 * a partire da un item del filesystem
 */
async function buildItem(item) {
  if (!item || !item.nfo) return null;

  // 1. leggi NFO (XML grezzo)
  const parsedXml = await readNfo(item.nfo);

  // 2. mappa nel modello canonico
  let model = mapNfoToModel(parsedXml);

  if (!model) return null;

  // 3. arricchisci con dati locali
  model = enrichModelWithLocalMedia(model, item);

  return model;
}

module.exports = { buildItem };
