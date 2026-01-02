const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const sharp = require("sharp");
const { saveNfoFull } = require("./saveNfo");

/**
 * Saves a scraped item by creating:
 * 1. Folder in the library
 * 2. Moving and renaming the video
 * 3. Generating NFO
 * 4. Downloading fanart
 * 5. Creating poster from fanart crop
 */
class ScrapeSaver {
  constructor(config) {
    this.config = config;
  }

  /**
   * Formats the folder name using configured tags
   */
  formatFolderName(item) {
    let format = this.config.folderFormat || "<ID>";

    // Extract year from release date
    const year = item.releaseDate ? item.releaseDate.split("-")[0] : "";

    // Replace tags
    format = format
      .replace(/<ID>/g, item.id || "")
      .replace(/<TITLE>/g, item.title || "")
      .replace(/<YEAR>/g, year)
      .replace(/<STUDIO>/g, item.studio || "")
      .replace(/<ORIGINALTITLE>/g, item.originalTitle || "");

    // Remove invalid characters for file names (Windows and Unix)
    format = format.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");

    // Remove trailing spaces and periods (invalid on Windows)
    format = format.replace(/[\s.]+$/, "");

    // Check for Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reservedNames.test(format)) {
      format = `_${format}`;
    }

    return format.trim();
  }

  /**
   * Downloads an image from URL
   */
  downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;

      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on("error", reject);
    });
  }

  /**
   * Creates the poster from fanart (crop of the right side)
   */
  async createPoster(fanartPath, posterPath) {
    try {
      const image = sharp(fanartPath);
      const metadata = await image.metadata();

      // Calculate dimensions for crop (ratio 71:100 = width:height)
      const posterWidth = Math.floor(metadata.height * 71 / 100);

      console.log(`[Poster Crop] Fanart: ${metadata.width}x${metadata.height}`);
      console.log(`[Poster Crop] Poster width calculated: ${posterWidth}`);

      // If poster is wider than original image, use the entire image
      if (posterWidth >= metadata.width) {
        console.log(`[Poster Crop] Poster width >= fanart width, copying without crop`);
        await image.toFile(posterPath);
        return true;
      }

      // Crop from the right side
      const leftOffset = metadata.width - posterWidth;
      console.log(`[Poster Crop] Left offset: ${leftOffset}, cropping from right side`);

      await image
        .extract({
          left: leftOffset,
          top: 0,
          width: posterWidth,
          height: metadata.height
        })
        .toFile(posterPath);

      return true;
    } catch (err) {
      console.error("Error creating poster:", err);
      return false;
    }
  }

  /**
   * Saves the complete item
   */
  async saveItem(item, scrapeData) {
    const results = {
      success: false,
      folder: null,
      video: null,
      nfo: null,
      fanart: null,
      poster: null,
      errors: []
    };

    try {
      // 1. Get video file path from JSON (required field)
      const videoFile = scrapeData.videoFile;

      console.log(`[ScrapeSaver] videoFile from JSON: ${videoFile}`);

      // videoFile is required in JSON
      if (!videoFile) {
        results.errors.push(`Missing videoFile field in JSON for ${item.id}`);
        console.error(`[ScrapeSaver] videoFile field is missing in JSON`);
        return results;
      }

      // Check if file exists
      if (!fs.existsSync(videoFile)) {
        results.errors.push(`Video file not found: ${videoFile}`);
        console.error(`[ScrapeSaver] Video file doesn't exist: ${videoFile}`);
        return results;
      }

      // 2. Create folder in the same directory as the video file
      const videoDir = path.dirname(videoFile);
      const folderName = this.formatFolderName(item);
      const folderPath = path.join(videoDir, folderName);

      console.log(`[ScrapeSaver] Creating folder: ${folderPath}`);
      console.log(`[ScrapeSaver] Video source: ${videoFile}`);

      if (fs.existsSync(folderPath)) {
        results.errors.push(`Folder already exists: ${folderName}`);
        return results;
      }

      fs.mkdirSync(folderPath, { recursive: true });
      results.folder = folderPath;

      // 3. Move and rename video
      const ext = path.extname(videoFile);
      const newVideoPath = path.join(folderPath, `${item.id}${ext}`);
      fs.renameSync(videoFile, newVideoPath);
      results.video = newVideoPath;
      console.log(`[ScrapeSaver] Moved video: ${videoFile} -> ${newVideoPath}`);

      // 4. Generate NFO
      // Note: Actor data should already be enriched from batch-actors process
      const nfoPath = path.join(folderPath, `${item.id}.nfo`);
      await saveNfoFull(nfoPath, item);
      results.nfo = nfoPath;

      // 5. Download fanart
      if (item.coverUrl) {
        const fanartPath = path.join(folderPath, "fanart.jpg");
        try {
          await this.downloadImage(item.coverUrl, fanartPath);
          results.fanart = fanartPath;

          // 6. Create poster
          const posterPath = path.join(folderPath, "poster.jpg");
          const posterCreated = await this.createPoster(fanartPath, posterPath);
          if (posterCreated) {
            results.poster = posterPath;
          }
        } catch (err) {
          results.errors.push(`Failed to download fanart: ${err.message}`);
        }
      }

      results.success = true;
      return results;

    } catch (err) {
      results.errors.push(err.message);
      return results;
    }
  }
}

module.exports = ScrapeSaver;
