const express = require("express");
const path = require("path");

const itemRoutes = require("./routes");

const app = express();
const PORT = 4004;

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
app.use("/item", itemRoutes);

// ─────────────────────────────
// Start server
// ─────────────────────────────
app.listen(PORT, () => {
  console.log(`WebUI attiva su http://localhost:${PORT}`);
});
