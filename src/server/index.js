const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const itemRoutes = require("./routes");

const app = express();
const PORT = 4004;

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// ─────────────────────────────
// Base middleware
// ─────────────────────────────
app.use(express.json());

// ─────────────────────────────
// Static files (WebUI)
// ─────────────────────────────
app.use("/", express.static(
  path.join(__dirname, "../web")
));

// ─────────────────────────────
// Serve media files - looks in multiple locations
// First checks temp directory (for uploaded images), then actors cache, then checks absolute paths in library, then relative paths in library
// ─────────────────────────────
app.use("/media", (req, res) => {
  const fs = require("fs");

  // Remove /media/ prefix from URL
  const requestedFile = decodeURIComponent(req.url.substring(1));

  // First, try to find the file in temp directory (for newly uploaded images)
  const tempPath = path.join(process.cwd(), 'data/temp');
  const tempFilePath = path.join(tempPath, requestedFile);
  if (fs.existsSync(tempFilePath)) {
    // File found in temp directory
    const ext = path.extname(requestedFile).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Read file and send as stream instead of using sendFile
    const readStream = fs.createReadStream(tempFilePath);

    readStream.on('error', (err) => {
      console.error(`[Media] Error reading temp file:`, err.message);
      if (!res.headersSent) {
        res.status(500).send("Error reading file");
      }
    });

    return readStream.pipe(res);
  }

  // Second, try to find the file in actors cache
  const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
  const actorsPath = getActorsCachePath();
  const actorFilePath = path.join(actorsPath, requestedFile);
  if (fs.existsSync(actorFilePath)) {
    // File found in actors cache
    const ext = path.extname(requestedFile).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Read file and send as stream instead of using sendFile
    const readStream = fs.createReadStream(actorFilePath);

    readStream.on('error', (err) => {
      console.error(`[Media] Error reading actor file:`, err.message);
      if (!res.headersSent) {
        res.status(500).send("Error reading file");
      }
    });

    return readStream.pipe(res);
  }

  // Get library config
  const config = require('../core/config').loadConfig();
  if (config.libraryPath) {
    // Check if requestedFile is an absolute path that starts with library path
    if (requestedFile.startsWith(config.libraryPath)) {
      // It's already an absolute path in the library
      const absoluteFilePath = requestedFile;

      // Security check: ensure the resolved path is within the library path
      const libraryPathResolved = path.resolve(config.libraryPath);
      if (path.resolve(absoluteFilePath).startsWith(libraryPathResolved) && fs.existsSync(absoluteFilePath)) {
        const ext = path.extname(requestedFile).toLowerCase();
        const contentTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif'
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Set headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Read file and send as stream instead of using sendFile
        const readStream = fs.createReadStream(absoluteFilePath);

        readStream.on('error', (err) => {
          console.error(`[Media] Error reading absolute library file:`, err.message);
          if (!res.headersSent) {
            res.status(500).send("Error reading file");
          }
        });

        return readStream.pipe(res);
      }
    } else {
      // It's a relative path, append to library path
      const libraryFilePath = path.join(config.libraryPath, requestedFile);

      // Security check: ensure the resolved path is within the library path
      const libraryPathResolved = path.resolve(config.libraryPath);
      if (path.resolve(libraryFilePath).startsWith(libraryPathResolved) && fs.existsSync(libraryFilePath)) {
        const ext = path.extname(requestedFile).toLowerCase();
        const contentTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif'
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Set headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Read file and send as stream instead of using sendFile
        const readStream = fs.createReadStream(libraryFilePath);

        readStream.on('error', (err) => {
          console.error(`[Media] Error reading library file:`, err.message);
          if (!res.headersSent) {
            res.status(500).send("Error reading file");
          }
        });

        return readStream.pipe(res);
      }
    }
  }

  // File not found in any location
  return res.status(404).send("File not found");
});

// ─────────────────────────────
// Serve actor thumbnails
// ─────────────────────────────
app.use("/actors", (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");

    // Load config directly to get actors path
    let actorsPath;
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // Check if external actors path is configured
        if (config.scrapers && config.scrapers.actors && config.scrapers.actors.externalPath) {
          actorsPath = config.scrapers.actors.externalPath;
        } else {
          // Default path
          actorsPath = path.join(process.cwd(), 'data/actors');
        }
      } else {
        // Default path if config doesn't exist
        actorsPath = path.join(process.cwd(), 'data/actors');
      }
    } catch (configErr) {
      console.error('[Server] Error loading config for actors path:', configErr.message);
      // Fallback to default path
      actorsPath = path.join(process.cwd(), 'data/actors');
    }

    // Get filename from URL (e.g., /actors/mao-hamasaki.webp?t=123 → mao-hamasaki.webp)
    // Strip query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const filename = decodeURIComponent(url.pathname.substring(1));
    const filePath = path.join(actorsPath, filename);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Actor thumbnail not found");
    }

    // Determine content type from extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Read file and send as stream instead of using sendFile
    const readStream = fs.createReadStream(filePath);

    readStream.on('error', (err) => {
      console.error(`[Server] Error reading actor file:`, err.message);
      if (!res.headersSent) {
        res.status(500).send("Error reading file");
      }
    });

    readStream.pipe(res);
  } catch (error) {
    console.error('[Server] Error in /actors endpoint:', error.message);
    res.status(500).send("Internal server error");
  }
});


// ─────────────────────────────
// API routes
// ─────────────────────────────
// Pass WebSocket server to routes for scraping
app.use("/item", (req, res, next) => {
  req.wss = wss;
  next();
}, itemRoutes);

// Mount API routes (also need WebSocket for actor scraping)
app.use("/api", (req, res, next) => {
  req.wss = wss;
  next();
}, itemRoutes);

// ─────────────────────────────
// WebSocket connection handling
// ─────────────────────────────
wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('[WebSocket] Received:', data);

      // Handle prompt responses
      if (data.type === 'promptResponse' && data.promptId) {
        if (ws.pendingPrompts && ws.pendingPrompts[data.promptId]) {
          // Call the callback with the user's response
          ws.pendingPrompts[data.promptId](data.response);
          delete ws.pendingPrompts[data.promptId];
        }
      }

      // Handle scraper error responses
      if (data.type === 'scraperErrorResponse') {
        if (ws.pendingScraperError) {
          // Call the callback with the user's response (true = continue, false = stop)
          ws.pendingScraperError(data.continue);
          ws.pendingScraperError = null;
        }
      }

      // Handle legacy responses (for backwards compatibility)
      if (data.type === 'response' && ws.pendingPromptResolve) {
        ws.pendingPromptResolve(data.value);
        ws.pendingPromptResolve = null;
      }
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
  });
});

// ─────────────────────────────
// Cleanup temp directory on startup
// ─────────────────────────────
const { cleanupTempDirectory } = require('../core/utils');
cleanupTempDirectory();

// ─────────────────────────────
// Start server
// ─────────────────────────────
server.listen(PORT, () => {
  console.log(`WebUI active on http://localhost:${PORT}`);
});
