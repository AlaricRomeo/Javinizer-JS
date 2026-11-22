const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/**
 * Builds kodi/plugin.video.javinizer.zip (installable via Kodi's "Install
 * from zip file") in plain Node — no external zip tool, so it works the same
 * on Linux, macOS and Windows.
 */

const ADDON_ID = "plugin.video.javinizer";
const KODI_DIR = path.join(__dirname, "../../kodi");
const SOURCE_DIR = path.join(KODI_DIR, ADDON_ID);
const ZIP_PATH = path.join(KODI_DIR, `${ADDON_ID}.zip`);

function listFiles(dir, base = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc") || entry.name.startsWith(".")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(`${rel}/`, ...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildKodiAddonZip() {
  const locals = [];
  const centrals = [];
  let offset = 0;

  // Top folder entry first, then every folder/file ("name/" = folder entry)
  for (const rel of ["", ...listFiles(SOURCE_DIR)]) {
    const isDir = rel === "" || rel.endsWith("/");
    const fullPath = path.join(SOURCE_DIR, ...rel.split("/"));
    const data = isDir ? Buffer.alloc(0) : fs.readFileSync(fullPath);
    const compressed = isDir ? data : zlib.deflateRawSync(data);
    const method = isDir ? 0 : 8;
    const name = Buffer.from(isDir && rel === "" ? `${ADDON_ID}/` : `${ADDON_ID}/${rel}`, "utf8");
    const crc = zlib.crc32(data);
    const { time, day } = dosDateTime(fs.statSync(fullPath).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(method, 8);   // 0 = stored, 8 = deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);     // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    if (isDir) central.writeUInt32LE(0x10, 38); // MS-DOS directory attribute
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  // Write-then-rename: a download in progress never sees a half-written zip
  const tmp = `${ZIP_PATH}.tmp`;
  fs.writeFileSync(tmp, Buffer.concat([...locals, ...centrals, end]));
  fs.renameSync(tmp, ZIP_PATH);
  return ZIP_PATH;
}

module.exports = { buildKodiAddonZip, ZIP_PATH, ADDON_DIR: SOURCE_DIR };

// `npm run kodi:zip`
if (require.main === module) {
  console.log(`[kodi] Add-on zip written to ${buildKodiAddonZip()}`);
}
