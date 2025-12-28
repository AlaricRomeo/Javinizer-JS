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
// Serve media files from library
// ─────────────────────────────
app.use("/media", (req, res) => {
  const fs = require("fs");
  // Remove /media/ prefix from URL
  const requestedPath = decodeURIComponent(req.url.substring(1));

  // Verify that file exists
  if (!fs.existsSync(requestedPath)) {
    return res.status(404).send("File not found");
  }

  // Send file
  res.sendFile(requestedPath);
});

// ─────────────────────────────
// Serve actor thumbnails
// ─────────────────────────────
app.use("/actors", (req, res) => {
  const fs = require("fs");

  // Load config to get actorsPath
  const configPath = path.join(__dirname, "../../config.json");
  let actorsPath;

  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);
    actorsPath = config.actorsPath || path.join(__dirname, "../../data/actors");
  } catch (error) {
    actorsPath = path.join(__dirname, "../../data/actors");
  }

  // Get filename from URL (e.g., /actors/mao-hamasaki.webp → mao-hamasaki.webp)
  // req.url starts with "/" (e.g., "/mao-hamasaki.webp")
  const filename = decodeURIComponent(req.url.substring(1));
  const filePath = path.resolve(path.join(actorsPath, filename));

  // Verify file exists
  if (!fs.existsSync(filePath)) {
    console.error(`[Server] File not found: ${filePath}`);
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

  // Set headers and stream file
  res.setHeader('Content-Type', contentType);
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
  fileStream.on('error', (err) => {
    console.error(`[Server] Error streaming file:`, err.message);
    if (!res.headersSent) {
      res.status(500).send("Error streaming file");
    }
  });
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
// Start server
// ─────────────────────────────
server.listen(PORT, () => {
  console.log(`WebUI active on http://localhost:${PORT}`);
});
