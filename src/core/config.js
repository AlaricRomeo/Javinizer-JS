const fs = require("fs");
const path = require("path");

// Use CONFIG_PATH environment variable if set (Docker), otherwise use local config.json
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), "config.json");

function loadConfig() {
  // If config file doesn't exist, create default config
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      libraryPath: process.env.LIBRARY_PATH || "/library",
      mode: "scrape",
      language: "en",
      scrapers: {
        video: ["javlibrary", "r18dev"],
        actors: {
          enabled: true,
          scrapers: ["local", "javdatabase"],
          externalPath: ""
        }
      },
      fieldPriorities: {}
    };

    // Ensure config directory exists
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    saveConfig(defaultConfig);
    return defaultConfig;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function saveConfig(config) {
  // Ensure config directory exists
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf8"
  );
}

module.exports = { loadConfig, saveConfig };
