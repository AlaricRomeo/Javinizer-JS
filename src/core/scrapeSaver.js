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
   * Formats the folder name using configured pattern
   */
  formatFolderName(item) {
    // Get pattern from config, default to {id}
    let pattern = this.config.scrapeFolderPattern || "{id}";

    // Extract year from release date
    const year = item.releaseDate ? item.releaseDate.split("-")[0] : "";

    // Prepare values for placeholders
    const values = {
      id: item.id || "",
      contentid: item.contentId || "",
      title: item.title || "",
      alternatetitle: item.alternateTitle || "",
      label: item.label || "",
      maker: item.studio || "",
      year: year
    };

    // Replace placeholders with values
    let folderName = pattern.replace(/\{(\w+)\}/g, (match, key) => {
      const lowerKey = key.toLowerCase();
      return values.hasOwnProperty(lowerKey) ? values[lowerKey] : match;
    });

    // Sanitize folder name
    folderName = this.sanitizeFolderName(folderName);

    return folderName;
  }

  /**
   * Sanitizes folder name removing invalid characters
   */
  sanitizeFolderName(name) {
    // Remove invalid characters for file names (Windows and Unix)
    let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");

    // Remove trailing spaces and periods (invalid on Windows)
    sanitized = sanitized.replace(/[\s.]+$/, "").trim();

    // Check for Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reservedNames.test(sanitized)) {
      sanitized = `_${sanitized}`;
    }

    // If empty after sanitization, use fallback
    if (!sanitized) {
      sanitized = "unknown";
    }

    return sanitized;
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
      // Read the file into a buffer first to avoid file locking issues on Windows
      const imageBuffer = await fs.promises.readFile(fanartPath);

      // Create Sharp instance from buffer instead of file path
      const image = sharp(imageBuffer);
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
      errors: [],
      warnings: []
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

      // Check if file exists - ora diventa un warning invece di un errore
      if (!fs.existsSync(videoFile)) {
        const warningMsg = `Video file not found: ${videoFile}`;
        console.warn(`[ScrapeSaver] ${warningMsg} - Procedo comunque senza video`);
        results.warnings.push(warningMsg);
      } else {
        // Solo se il file esiste, lo spostiamo
        const ext = path.extname(videoFile);
        const newVideoPath = path.join(folderPath, `${item.id}${ext}`);
        fs.renameSync(videoFile, newVideoPath);
        results.video = newVideoPath;
        console.log(`[ScrapeSaver] Moved video: ${videoFile} -> ${newVideoPath}`);
      }

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
