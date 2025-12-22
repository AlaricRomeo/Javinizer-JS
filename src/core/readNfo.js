const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Legge e parse un file .nfo (XML)
 * Ritorna un oggetto JS grezzo
 */
async function readNfo(nfoPath) {
  const xmlContent = fs.readFileSync(nfoPath, "utf-8");

  const parser = new xml2js.Parser({
    explicitArray: true,
    trim: true
  });

  const result = await parser.parseStringPromise(xmlContent);
  return result;
}

module.exports = { readNfo };
