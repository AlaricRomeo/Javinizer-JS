const fs = require("fs");
const path = require("path");

const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "wmv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

function enrichModelWithLocalMedia(model, item, actorCache) {
  const files = fs.readdirSync(item.path);

  model.local.path = item.path;
  model.local.files = files;

  // VIDEO
  const videoFile = files.find(f => {
    const ext = f.split(".").pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  });

  if (videoFile) {
    model.local.video = videoFile;
  }

  // Helper: check if file matches pattern with any image extension
  const matchesImagePattern = (filename, pattern) => {
    const lowerName = filename.toLowerCase();
    const ext = lowerName.split('.').pop();

    if (!IMAGE_EXTENSIONS.includes(ext)) return false;

    // Exact match with extension (e.g., "folder.jpg")
    if (pattern.includes('.')) {
      return lowerName === pattern;
    }

    // Pattern match using regex
    // For patterns like "-fanart" or "-thumb", remove the leading dash
    // For patterns like "fanart" or "poster", use as-is
    const suffix = pattern.startsWith('-') ? pattern.substring(1) : pattern;

    // Regex: ^.*fanart\.(jpg|jpeg|png|webp|gif)$
    // Matches: "fanart.jpg", "movie-fanart.jpg", "movie -fanart.jpg", etc.
    const extPattern = IMAGE_EXTENSIONS.join('|');
    const regex = new RegExp(`^.*${suffix}\\.(${extPattern})$`, 'i');
    return regex.test(lowerName);
  };

  // POSTER / FOLDER
  // Priority: folder.[ext] > poster.[ext] > *-thumb.[ext]
  const posterFile = files.find(f => matchesImagePattern(f, "folder.jpg")) ||
                     files.find(f => matchesImagePattern(f, "folder")) ||
                     files.find(f => matchesImagePattern(f, "poster.jpg")) ||
                     files.find(f => matchesImagePattern(f, "poster")) ||
                     files.find(f => matchesImagePattern(f, "-thumb"));

  if (posterFile) {
    model.images.poster = path.join(item.path, posterFile);
  }

  // FANART
  // Match fanart.[ext] or *-fanart.[ext]
  const fanartFile = files.find(f => matchesImagePattern(f, "fanart")) ||
                     files.find(f => matchesImagePattern(f, "-fanart"));

  if (fanartFile) {
    model.images.fanart.push(path.join(item.path, fanartFile));
  }

  // ACTOR PHOTOS — ground truth for this specific movie
  // If this movie's own actors/ subfolder already has a photo for an actor
  // (written by the "copy actors to movie folder" feature), the edit page
  // should show that one first, ahead of whatever the centralized actor
  // store (externalPath/cache) currently resolves to.
  if (model.actor && Array.isArray(model.actor)) {
    const actorsDir = path.join(item.path, 'actors');
    const actorFiles = fs.existsSync(actorsDir) ? fs.readdirSync(actorsDir) : [];

    // A movie's own NFO never stores the actor's central-index id or
    // favorite flag (only name/altname/role/thumb — see nfoMapper.js), so
    // resolve both here on every load. Without a real id, the actor-edit
    // modal falls back to normalizeActorName(name), which guesses the
    // *un-inverted* slug (e.g. "haruna-katou") and silently misses actors
    // whose canonical id is family-name-first (e.g. "katou-haruna") — image
    // preview/upload then reads/writes the wrong file. Without the favorite
    // flag, the star always renders unlit even for an already-favorited actor.
    const actorDb = require('../../scrapers/actors/actorDb');
    model.actor.forEach(actor => {
      if (!actor.name) return;

      // actorCache (shared across a whole GET /library-list batch by
      // buildItem's caller) turns the same actor recurring across hundreds
      // of movies back into one SQLite lookup instead of one per movie.
      const cacheKey = actor.name.toLowerCase();
      let dbActor = actorCache && actorCache.get(cacheKey);
      if (dbActor === undefined) {
        dbActor = actorDb.findActorByName(actor.name) || null;
        if (actorCache) actorCache.set(cacheKey, dbActor);
      }
      if (dbActor) {
        actor.id = dbActor.id;
        actor.favorite = dbActor.favorite;
      }

      if (actorFiles.length > 0) {
        const match = actorFiles.find(f => {
          const dot = f.lastIndexOf('.');
          if (dot === -1) return false;
          return f.slice(0, dot) === actor.name && IMAGE_EXTENSIONS.includes(f.slice(dot + 1).toLowerCase());
        });
        if (match) {
          actor.localThumb = path.join(actorsDir, match);
        }
      }
    });
  }

  return model;
}

module.exports = { enrichModelWithLocalMedia };
