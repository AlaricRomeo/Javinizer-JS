const fs = require("fs");
const path = require("path");

/**
 * Resume points reported by the Kodi add-on's player service, per movie id
 * (library folder path): shared by every Kodi in the house.
 */

const PROGRESS_PATH = path.join(process.cwd(), "data", "kodi-progress.json");
// Same rules as Kodi's own bookmarks (ignoresecondsatstart / ignorepercentatend)
const IGNORE_SECONDS_AT_START = 180;
const WATCHED_RATIO = 0.92;

let _progress = null;

function load() {
  if (_progress) return _progress;
  try {
    _progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
  } catch (_) {
    _progress = {};
  }
  return _progress;
}

function save() {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  const tmp = `${PROGRESS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_progress, null, 2));
  fs.renameSync(tmp, PROGRESS_PATH);
}

function getProgress(id) {
  return load()[id] || null;
}

/** Stores a resume point, or clears it (too early, or watched to the end). */
function setProgress(id, position, total) {
  const progress = load();
  const keep = position >= IGNORE_SECONDS_AT_START && total > 0 && position < total * WATCHED_RATIO;
  if (keep) progress[id] = { position: Math.round(position), total: Math.round(total), updatedAt: new Date().toISOString() };
  else if (progress[id]) delete progress[id];
  else return false;
  save();
  return keep;
}

module.exports = { getProgress, setProgress };
