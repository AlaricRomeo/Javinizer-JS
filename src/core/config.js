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
      libraryPaths: [process.env.LIBRARY_PATH || getDefaultLibraryPath()],
      mode: "scrape",
      language: "en",
      videoPlayerPath: "",
      browserPath: "",
      scrapeFolderPattern: "{id} - ({year})",
      scrapeTitlePattern: "{title}",
      badges: {
        uncensored: false,
        decensored: false,
        leaked: false
      },
      scrapers: {
        video: ["javlibrary", "r18dev"],
        actors: {
          enabled: true,
          scrapers: ["local", "javdb", "xcity", "xslist-fs"],
          externalPath: "",
          copyToMovieFolder: false
        }
      },
      genreRules: "",
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
  return migrateLibraryPaths(JSON.parse(raw));
}

/**
 * Legacy configs have a single `libraryPath` string; normalize to the
 * `libraryPaths` array (in memory — persisted on the next saveConfig).
 */
function migrateLibraryPaths(config) {
  if (!Array.isArray(config.libraryPaths)) {
    config.libraryPaths = config.libraryPath ? [config.libraryPath] : [];
  }
  delete config.libraryPath;
  return config;
}

/**
 * All configured library roots (non-empty, de-duplicated). Also accepts a raw,
 * not yet migrated config (legacy `libraryPath`).
 */
function getLibraryPaths(config) {
  const roots = Array.isArray(config.libraryPaths) ? config.libraryPaths
    : config.libraryPath ? [config.libraryPath] : [];
  return [...new Set(roots.filter(p => typeof p === "string" && p.trim()))];
}

/**
 * True if `target` is one of the library roots or lies inside one.
 */
function isInsideLibrary(config, target) {
  return getLibraryRootOf(config, target) !== null;
}

/**
 * Root that contains `target` (or null).
 */
function getLibraryRootOf(config, target) {
  const resolved = path.resolve(target);
  return getLibraryPaths(config).find(root => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  }) || null;
}

/**
 * Absolute path of a movie folder from its item id (= absolute folder path,
 * see LibraryReader), or null if it isn't an existing folder inside a library
 * root. A bare folder name (ids before multi-root support) is looked up in
 * each root, first match wins.
 */
function resolveLibraryFolder(config, folderId) {
  if (!folderId) return null;
  if (path.isAbsolute(folderId)) {
    return isInsideLibrary(config, folderId) && fs.existsSync(folderId) ? folderId : null;
  }
  if (folderId !== path.basename(folderId)) return null;
  for (const root of getLibraryPaths(config)) {
    const p = path.join(root, folderId);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function saveConfig(config) {
  migrateLibraryPaths(config);

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

/**
 * Get path to the persisted library index cache
 * Used to avoid a full folder rescan on every server restart
 */
function getLibraryCachePath() {
  return path.join(process.cwd(), 'data', 'library-cache.json');
}

/**
 * Get path to the persisted "last viewed item" pointer
 * Used to resume edit-mode navigation where the user left off after a server restart
 */
function getLibraryPositionPath() {
  return path.join(process.cwd(), 'data', 'library-position.json');
}

module.exports = {
  loadConfig, saveConfig, getScrapePath, getLibraryCachePath, getLibraryPositionPath,
  getLibraryPaths, isInsideLibrary, getLibraryRootOf, resolveLibraryFolder
};
