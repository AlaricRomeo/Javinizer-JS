/**
 * Converte un NFO (già parsato con xml2js)
 * nel modello dati canonico
 */
function mapNfoToModel(parsedXml) {
  const movie = parsedXml.movie;
  if (!movie) return null;

  const getValue = (field) =>
    movie[field] && movie[field][0] ? movie[field][0] : "";

  const model = {
    id: getValue("id"),
    code: getValue("id"),

    title: getValue("title"),
    originalTitle: getValue("originaltitle"),

    releaseDate: getValue("premiered"),
    runtime: movie.runtime ? Number(movie.runtime[0]) : null,

    studio: getValue("studio"),
    label: getValue("label"),
    series: getValue("set"),
    director: getValue("director"),

    plot: getValue("plot"),
    tagline: getValue("tagline"),
    contentRating: getValue("mpaa") || "XXX",

    genres: movie.genre ? movie.genre.filter(Boolean) : [],
    tags: movie.tag ? movie.tag.filter(Boolean) : [],

    rating: {
      value: movie.rating ? Number(movie.rating[0]) : null,
      votes: movie.votes ? Number(movie.votes[0]) : null
    },

    actor: [],

    // Media URLs
    coverUrl: getValue("coverurl"),
    screenshotUrl: getValue("screenshoturl"),
    trailerUrl: getValue("trailer"),

    images: {
      poster: "",
      fanart: []
    },

    local: {
      path: "",
      files: []
    },

    meta: {
      createdAt: "",
      updatedAt: "",
      locked: false
    }
  };

  // Actor mapping
  if (movie.actor) {
    model.actor = movie.actor.map(a => ({
      name: a.name ? a.name[0] : "",
      altName: a.altname ? a.altname[0] : "",
      role: a.role ? a.role[0] : "",
      thumb: a.thumb ? a.thumb[0] : ""
    }));
  }

  return model;
}

module.exports = { mapNfoToModel };
