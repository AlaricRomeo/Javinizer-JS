const LibraryReader = require("./core/libraryReader");
const { readNfo } = require("./core/readNfo");
const { mapNfoToModel } = require("./core/nfoMapper");
const { enrichModelWithLocalMedia } = require("./core/localMediaMapper");

async function test() {
  const reader = new LibraryReader("/mnt/Jav/to"); // <-- path reale
  reader.loadLibrary();

  const item = reader.getCurrent();
  if (!item) {
    console.log("Nessun item trovato");
    return;
  }

  const raw = await readNfo(item.nfo);
  let model = mapNfoToModel(raw);
  model = enrichModelWithLocalMedia(model, item);

  console.dir(model, { depth: null });
}

test();
