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
// API routes
// ─────────────────────────────
app.use("/item", itemRoutes);

// ─────────────────────────────
// Start server
// ─────────────────────────────
app.listen(PORT, () => {
  console.log(`WebUI attiva su http://localhost:${PORT}`);
});
