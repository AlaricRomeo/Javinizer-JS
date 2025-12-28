const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Reads and parses a .nfo file in Kodi/NFO format
 * @param {string} nfoPath - full path to .nfo file
 * @returns {Promise<Object>} - object with parsed fields
 */
async function parseNfo(nfoPath) {
  const xml = fs.readFileSync(nfoPath, "utf8");
  const parser = new xml2js.Parser();

  const result = await parser.parseStringPromise(xml);
  const movie = result.movie || {};

  // Extract the fields we need
  return {
    title: getString(movie.title),
    originalTitle: getString(movie.originaltitle),
    releaseDate: getString(movie.premiered),
    runtime: getString(movie.runtime),
    plot: getString(movie.plot),
    director: getString(movie.director),
    studio: getString(movie.studio),
    genres: getArray(movie.genre),
    actors: parseActors(movie.actor)
  };
}

/**
 * Helper to extract a string from an XML array
 */
function getString(arr) {
  if (!arr || !arr[0]) return "";
  return String(arr[0]).trim();
}

/**
 * Helper to extract an array from XML elements
 */
function getArray(arr) {
  if (!arr) return [];
  return arr.map(item => String(item).trim());
}

/**
 * Parser for actors
 */
function parseActors(actorArray) {
  if (!actorArray) return [];

  return actorArray.map(actor => ({
    name: getString(actor.name),
    altname: getString(actor.altname),
    thumb: getString(actor.thumb),
    role: getString(actor.role)
  }));
}

module.exports = { parseNfo };
