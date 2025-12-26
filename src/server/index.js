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
// Middleware base
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
  // Rimuove il prefisso /media/ dall'URL
  const requestedPath = decodeURIComponent(req.url.substring(1));

  // Verifica che il file esista
  if (!fs.existsSync(requestedPath)) {
    return res.status(404).send("File not found");
  }

  // Invia il file
  res.sendFile(requestedPath);
});

// ─────────────────────────────
// API routes
// ─────────────────────────────
// Pass WebSocket server to routes for scraping
app.use("/item", (req, res, next) => {
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
  console.log(`WebUI attiva su http://localhost:${PORT}`);
});
