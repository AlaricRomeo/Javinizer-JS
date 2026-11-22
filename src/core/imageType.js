const fs = require("fs");

/**
 * Real image format from the file's first bytes. Extensions can't be trusted:
 * scraped photos are often WebP/PNG saved as ".jpg" (browsers don't care,
 * Kodi can't decode them).
 * @param {string|Buffer} source - file path or image data
 * @returns {"jpeg"|"png"|"webp"|"gif"|""}
 */
function imageType(source) {
  let head;
  if (Buffer.isBuffer(source)) {
    head = source.subarray(0, 12);
  } else {
    head = Buffer.alloc(12);
    const fd = fs.openSync(source, "r");
    try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (head.toString("latin1", 0, 3) === "GIF") return "gif";
  return "";
}

const JPEG_QUALITY = 92;

/** Image data as JPEG (unchanged when it already is one). */
async function toJpegBuffer(buffer) {
  if (imageType(buffer) === "jpeg") return buffer;
  return require("sharp")(buffer).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

/**
 * Writes `srcPath` to `destPath` as JPEG: every actor photo is stored as a
 * real .jpg, whatever format the scraper/upload delivered.
 */
async function writeJpegFile(srcPath, destPath) {
  fs.writeFileSync(destPath, await toJpegBuffer(fs.readFileSync(srcPath)));
}

module.exports = { imageType, toJpegBuffer, writeJpegFile };
