const fs = require("fs");
const path = require("path");
const os = require("os");

// Use CONFIG_PATH environment variable if set, otherwise use local config.json
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), "config.json");

// Get cross-platform default library path
function getDefaultLibraryPath() {
  const homeDir = os.homedir();

  // Try Videos folder first (common for media), then Documents
  const videosPath = path.join(homeDir, 'Videos');
  const documentsPath = path.join(homeDir, 'Documents');

  if (fs.existsSync(videosPath)) {
    return videosPath;
  } else if (fs.existsSync(documentsPath)) {
    return documentsPath;
  }

  // Fallback to home directory
  return homeDir;
}

function loadConfig() {
  // If config file doesn't exist, create default config
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      libraryPath: process.env.LIBRARY_PATH || getDefaultLibraryPath(),
      mode: "scrape",
      language: "en",
      scrapeFolderPattern: "{id}",
      scrapers: {
        video: ["javlibrary", "r18dev"],
        actors: {
          enabled: true,
          scrapers: ["javdb"],
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

/**
 * Get centralized scrape path
 * Always returns data/scrape regardless of library path
 * This allows managing scrapes from multiple libraries in one place
 */
function getScrapePath() {
  return path.join(process.cwd(), 'data', 'scrape');
}

module.exports = { loadConfig, saveConfig, getScrapePath };
