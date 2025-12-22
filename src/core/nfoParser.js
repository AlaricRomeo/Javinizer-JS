const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Legge e parsifica un file .nfo in formato Kodi/NFO
 * @param {string} nfoPath - path completo del file .nfo
 * @returns {Promise<Object>} - oggetto con i campi parsati
 */
async function parseNfo(nfoPath) {
  const xml = fs.readFileSync(nfoPath, "utf8");
  const parser = new xml2js.Parser();

  const result = await parser.parseStringPromise(xml);
  const movie = result.movie || {};

  // Estrai i campi che ci interessano
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
 * Helper per estrarre una stringa da un array XML
 */
function getString(arr) {
  if (!arr || !arr[0]) return "";
  return String(arr[0]).trim();
}

/**
 * Helper per estrarre un array da elementi XML
 */
function getArray(arr) {
  if (!arr) return [];
  return arr.map(item => String(item).trim());
}

/**
 * Parser per gli attori
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
