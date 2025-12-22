const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(process.cwd(), "config.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function saveConfig(config) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf8"
  );
}

module.exports = { loadConfig, saveConfig };
