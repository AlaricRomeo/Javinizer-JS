const fs = require("fs");
const path = require("path");

const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "wmv"];

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

  // POSTER / FOLDER
  if (files.includes("folder.jpg")) {
    model.images.poster = path.join(item.path, "folder.jpg");
  } else if (files.includes("poster.jpg")) {
    model.images.poster = path.join(item.path, "poster.jpg");
  }

  // FANART
  if (files.includes("fanart.jpg")) {
    model.images.fanart.push(path.join(item.path, "fanart.jpg"));
  }

  return model;
}

module.exports = { enrichModelWithLocalMedia };
