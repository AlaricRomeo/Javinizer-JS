const fs = require("fs");
const path = require("path");

const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "wmv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

function enrichModelWithLocalMedia(model, item) {
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

  return model;
}

module.exports = { enrichModelWithLocalMedia };
