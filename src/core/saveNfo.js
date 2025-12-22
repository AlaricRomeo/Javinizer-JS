const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Mappa i nomi dei campi del modello canonico
 * ai nomi dei campi XML NFO (bidirezionale)
 */
const fieldMapping = {
  originalTitle: "originaltitle",
  releaseDate: "premiered",
  contentRating: "mpaa",
  genres: "genre",
  tags: "tag",
  coverUrl: "coverurl",
  screenshotUrl: "screenshoturl",
  trailerUrl: "trailer"
};

/**
 * Converte un campo del modello canonico in formato XML NFO
 * @param {string} key - Nome del campo
 * @param {*} value - Valore del campo
 * @returns {object} - Oggetto con xmlKey e xmlValue
 */
function modelFieldToXml(key, value) {
  const xmlKey = fieldMapping[key] || key;

  // Gestione campi vuoti
  if (value === null || value === undefined || value === "") {
    return { xmlKey, xmlValue: [""] };
  }

  // Gestione campi semplici (stringhe e numeri)
  if (typeof value === "string" || typeof value === "number") {
    return { xmlKey, xmlValue: [String(value)] };
  }

  // Gestione array semplici (genres, tags)
  if (Array.isArray(value)) {
    // Array di actor (struttura complessa)
    if (xmlKey === "actor") {
      return {
        xmlKey,
        xmlValue: value.map(actor => ({
          name: [actor.name || ""],
          altname: [actor.altName || ""],
          role: [actor.role || ""],
          thumb: [actor.thumb || ""]
        }))
      };
    }
    // Array semplici
    return { xmlKey, xmlValue: value.map(v => String(v)) };
  }

  // Gestione oggetti complessi
  if (typeof value === "object") {
    // Rating (si divide in due campi)
    if (xmlKey === "rating") {
      return {
        xmlKey: "rating",
        xmlValue: [String(value.value || "")],
        extra: { votes: [String(value.votes || "")] }
      };
    }
  }

  return { xmlKey, xmlValue: [String(value)] };
}

/**
 * Salva le modifiche nell'NFO file preservando tutti i campi esistenti
 * Modalità PATCH: modifica solo i campi specificati
 * @param {string} nfoPath - Path al file .nfo
 * @param {object} changes - Oggetto con le modifiche da applicare
 */
async function saveNfoPatch(nfoPath, changes) {
  const xml = fs.readFileSync(nfoPath, "utf8");

  // backup
  fs.writeFileSync(nfoPath + ".bak", xml, "utf8");

  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder({
    headless: true,
    renderOpts: {
      pretty: true,
      indent: "  ",
      newline: "\n",
      allowEmpty: true
    },
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: false }
  });

  const parsed = await parser.parseStringPromise(xml);
  const movie = parsed.movie;

  // Applica ogni modifica usando la funzione helper
  for (const key in changes) {
    const result = modelFieldToXml(key, changes[key]);

    // Applica il valore principale
    movie[result.xmlKey] = result.xmlValue;

    // Applica eventuali campi extra (es. votes per rating)
    if (result.extra) {
      Object.assign(movie, result.extra);
    }
  }

  const newXml = builder.buildObject(parsed);
  fs.writeFileSync(nfoPath, newXml, "utf8");
}

/**
 * Salva l'intero modello canonico come NFO
 * Modalità FULL: crea un nuovo NFO completo (usato dallo scraper)
 * @param {string} nfoPath - Path al file .nfo
 * @param {object} model - Modello canonico completo
 */
async function saveNfoFull(nfoPath, model) {
  // backup se esiste già
  if (fs.existsSync(nfoPath)) {
    const xml = fs.readFileSync(nfoPath, "utf8");
    fs.writeFileSync(nfoPath + ".bak", xml, "utf8");
  }

  const builder = new xml2js.Builder({
    headless: true,
    renderOpts: {
      pretty: true,
      indent: "  ",
      newline: "\n",
      allowEmpty: true
    },
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: false }
  });

  // Costruisci la struttura movie dall'inizio
  const movie = {};

  // Campi semplici obbligatori
  movie.title = [model.title || ""];
  movie.originaltitle = [model.originalTitle || ""];
  movie.id = [model.id || model.code || ""];
  movie.premiered = [model.releaseDate || ""];
  movie.year = model.releaseDate ? [model.releaseDate.substring(0, 4)] : [""];
  movie.director = [model.director || ""];
  movie.studio = [model.studio || ""];
  movie.label = [model.label || ""];
  movie.rating = [model.rating?.value ? String(model.rating.value) : ""];
  movie.votes = [model.rating?.votes ? String(model.rating.votes) : ""];
  movie.plot = [model.plot || ""];
  movie.runtime = [model.runtime ? String(model.runtime) : ""];
  movie.trailer = [model.trailerUrl || ""];
  movie.mpaa = [model.contentRating || "XXX"];
  movie.tagline = [model.tagline || ""];
  movie.set = [model.series || ""];
  movie.thumb = [""];
  movie.coverurl = [model.coverUrl || ""];
  movie.screenshoturl = [model.screenshotUrl || ""];

  // Genres (array)
  if (model.genres && model.genres.length > 0) {
    movie.genre = model.genres;
  }

  // Tags (array)
  if (model.tags && model.tags.length > 0) {
    movie.tag = model.tags;
  }

  // Actors (array complesso)
  if (model.actor && model.actor.length > 0) {
    movie.actor = model.actor.map(a => ({
      name: [a.name || ""],
      altname: [a.altName || ""],
      thumb: [a.thumb || ""],
      role: [a.role || "Actress"]
    }));
  }

  const newXml = builder.buildObject({ movie });
  fs.writeFileSync(nfoPath, newXml, "utf8");
}

module.exports = { saveNfoPatch, saveNfoFull };
