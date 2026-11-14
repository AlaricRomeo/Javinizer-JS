/**
 * Kodi conventions for per-movie actor photos (see Kodi's
 * CVideoInfoScannerArt::FetchActorThumbs): photos live in "<movie>/.actors",
 * are named after the NFO <name> with every space turned into "_" (case
 * sensitive), and only .jpg/.png/.tbn are picked up.
 */

const ACTORS_DIR = '.actors';

// Extensions Kodi reads from .actors (".jpeg" is NOT one of them)
const KODI_ACTOR_EXTENSIONS = ['jpg', 'png'];

/**
 * Filename (without extension) Kodi expects for an actor's photo.
 * Mirrors Kodi: spaces -> "_", then CUtil::MakeLegalFileName.
 * @param {string} name - Actor name exactly as written in the movie NFO
 * @returns {string}
 */
function actorFileBase(name) {
  const illegal = process.platform === 'win32' ? /[\\/:*?"<>|]/g : /\//g;
  return String(name).replace(/ /g, '_').replace(illegal, '_');
}

module.exports = { ACTORS_DIR, KODI_ACTOR_EXTENSIONS, actorFileBase };
