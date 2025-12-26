const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const sharp = require("sharp");
const { saveNfoFull } = require("./saveNfo");

/**
 * Salva un item scraped creando:
 * 1. Cartella nella libreria
 * 2. Spostamento e rinomina del video
 * 3. Generazione NFO
 * 4. Download fanart
 * 5. Creazione poster dal crop della fanart
 */
class ScrapeSaver {
  constructor(config) {
    this.config = config;
  }

  /**
   * Formatta il nome della cartella usando i tag configurati
   */
  formatFolderName(item) {
    let format = this.config.folderFormat || "<ID>";

    // Estrai anno dalla data di rilascio
    const year = item.releaseDate ? item.releaseDate.split("-")[0] : "";

    // Sostituisci i tag
    format = format
      .replace(/<ID>/g, item.id || "")
      .replace(/<TITLE>/g, item.title || "")
      .replace(/<YEAR>/g, year)
      .replace(/<STUDIO>/g, item.studio || "")
      .replace(/<ORIGINALTITLE>/g, item.originalTitle || "");

    // Rimuovi caratteri non validi per i nomi di file
    format = format.replace(/[<>:"/\\|?*]/g, "");

    return format.trim();
  }

  /**
   * Trova il file video che inizia con l'ID
   */
  findVideoFile(id, videoPath) {
    if (!fs.existsSync(videoPath)) {
      return null;
    }

    const files = fs.readdirSync(videoPath);
    const videoFile = files.find(f => {
      const lower = f.toLowerCase();
      return lower.startsWith(id.toLowerCase()) &&
             (lower.endsWith(".mp4") || lower.endsWith(".mkv") ||
              lower.endsWith(".avi") || lower.endsWith(".wmv"));
    });

    return videoFile ? path.join(videoPath, videoFile) : null;
  }

  /**
   * Scarica un'immagine da URL
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
   * Crea il poster dalla fanart (crop della parte sinistra)
   */
  async createPoster(fanartPath, posterPath) {
    try {
      const image = sharp(fanartPath);
      const metadata = await image.metadata();

      // Calcola dimensioni per il crop (rapporto 100:71 = width:height)
      const posterWidth = Math.floor(metadata.height * 100 / 71);

      // Crop della parte sinistra
      await image
        .extract({
          left: 0,
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
   * Salva l'item completo
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
      // 1. Crea nome cartella
      const folderName = this.formatFolderName(item);
      const folderPath = path.join(this.config.libraryPath, folderName);

      if (fs.existsSync(folderPath)) {
        results.errors.push(`Folder already exists: ${folderName}`);
        return results;
      }

      fs.mkdirSync(folderPath, { recursive: true });
      results.folder = folderPath;

      // 2. Sposta e rinomina video (se esiste)
      const videoPath = scrapeData.videoFile || this.config.videoPath;
      const videoFile = this.findVideoFile(item.id, path.dirname(videoPath));

      if (videoFile && fs.existsSync(videoFile)) {
        const ext = path.extname(videoFile);
        const newVideoPath = path.join(folderPath, `${item.id}${ext}`);
        fs.renameSync(videoFile, newVideoPath);
        results.video = newVideoPath;
      } else {
        results.errors.push(`Video file not found for ${item.id}`);
      }

      // 3. Genera NFO
      const nfoPath = path.join(folderPath, `${item.id}.nfo`);
      await saveNfoFull(nfoPath, item);
      results.nfo = nfoPath;

      // 4. Scarica fanart
      if (item.coverUrl) {
        const fanartPath = path.join(folderPath, "fanart.jpg");
        try {
          await this.downloadImage(item.coverUrl, fanartPath);
          results.fanart = fanartPath;

          // 5. Crea poster
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
