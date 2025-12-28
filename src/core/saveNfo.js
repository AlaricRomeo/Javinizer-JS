const fs = require("fs");
const xml2js = require("xml2js");

/**
 * Maps canonical model field names
 * to XML NFO field names (bidirectional)
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
 * Converts a canonical model field to XML NFO format
 * @param {string} key - Field name
 * @param {*} value - Field value
 * @returns {object} - Object with xmlKey and xmlValue
 */
function modelFieldToXml(key, value) {
  const xmlKey = fieldMapping[key] || key;

  // Handle empty fields
  if (value === null || value === undefined || value === "") {
    return { xmlKey, xmlValue: [""] };
  }

  // Handle simple fields (strings and numbers)
  if (typeof value === "string" || typeof value === "number") {
    return { xmlKey, xmlValue: [String(value)] };
  }

  // Handle simple arrays (genres, tags)
  if (Array.isArray(value)) {
    // Actor array (complex structure)
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
    // Simple arrays
    return { xmlKey, xmlValue: value.map(v => String(v)) };
  }

  // Handle complex objects
  if (typeof value === "object") {
    // Rating (splits into two fields)
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
 * Saves changes to NFO file preserving all existing fields
 * PATCH mode: modifies only specified fields
 * @param {string} nfoPath - Path to .nfo file
 * @param {object} changes - Object with changes to apply
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

  // Apply each change using helper function
  for (const key in changes) {
    const result = modelFieldToXml(key, changes[key]);

    // Apply main value
    movie[result.xmlKey] = result.xmlValue;

    // Apply any extra fields (e.g. votes for rating)
    if (result.extra) {
      Object.assign(movie, result.extra);
    }
  }

  const newXml = builder.buildObject(parsed);
  fs.writeFileSync(nfoPath, newXml, "utf8");
}

/**
 * Saves the entire canonical model as NFO
 * FULL mode: creates a new complete NFO (used by scraper)
 * @param {string} nfoPath - Path to .nfo file
 * @param {object} model - Complete canonical model
 */
async function saveNfoFull(nfoPath, model) {
  // backup if already exists
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

  // Build movie structure from scratch
  const movie = {};

  // Required simple fields
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

  // Actors (complex array)
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
