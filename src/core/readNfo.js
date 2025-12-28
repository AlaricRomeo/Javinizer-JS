const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Reads and parses a .nfo file (XML)
 * Returns a raw JS object
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
