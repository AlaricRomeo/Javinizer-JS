/**
 * Cache Helper for Actor Scrapers
 *
 * Provides unified cache management for all actor scrapers.
 * Each scraper should:
 * 1. Check cache first (external path or internal)
 * 2. If data is complete, return it
 * 3. If data is incomplete or missing, scrape online
 * 4. Save to cache (external path if set, otherwise internal)
 */

const fs = require('fs');
const path = require('path');
const { normalizeActorName, nfoToActor, actorToNFO, removeEmptyFields } = require('./schema');

/**
 * Load config.json
 */
function loadConfig() {
  // Support both CONFIG_PATH env (Docker) and default location
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }

  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * Get actors cache directory path
 * Returns external path if configured, otherwise internal cache
 */
function getActorsCachePath() {
  const config = loadConfig();

  // Check if external path is configured in scrapers.actors.externalPath
  if (config.scrapers &&
      config.scrapers.actors &&
      config.scrapers.actors.externalPath &&
      config.scrapers.actors.externalPath.trim() !== '') {
    return config.scrapers.actors.externalPath;
  }

  // Fallback to internal cache
  return path.join(__dirname, '../../data/actors');
}

/**
 * Load actor index from actors-index.json
 * Auto-migrates from old .index.json if found
 */
function loadIndex() {
  const actorsPath = getActorsCachePath();
  const indexPath = path.join(actorsPath, 'actors-index.json');
  const oldIndexPath = path.join(actorsPath, '.index.json');

  // Auto-migrate from old .index.json to actors-index.json (Windows compatibility)
  if (!fs.existsSync(indexPath) && fs.existsSync(oldIndexPath)) {
    try {
      fs.renameSync(oldIndexPath, indexPath);
    } catch (error) {
      console.error('[CacheHelper] Failed to migrate index:', error.message);
    }
  }

  if (!fs.existsSync(indexPath)) {
    return {};
  }

  try {
    const data = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[CacheHelper] Failed to load index:', error.message);
    return {};
  }
}

/**
 * Save actor index to actors-index.json
 */
function saveIndex(index) {
  const actorsPath = getActorsCachePath();
  const indexPath = path.join(actorsPath, 'actors-index.json');

  // Ensure directory exists
  if (!fs.existsSync(actorsPath)) {
    fs.mkdirSync(actorsPath, { recursive: true });
  }

  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error('[CacheHelper] Failed to save index:', error.message);
  }
}

/**
 * Update index with actor name variants
 */
function updateIndex(actor) {
  const index = loadIndex();
  const id = actor.id;

  // Add main name
  if (actor.name) {
    index[actor.name.toLowerCase()] = id;
  }

  // Add alternative name
  if (actor.altName) {
    index[actor.altName.toLowerCase()] = id;
  }

  // Add other names
  if (actor.otherNames && Array.isArray(actor.otherNames)) {
    actor.otherNames.forEach(name => {
      if (name) {
        index[name.toLowerCase()] = id;
      }
    });
  }

  saveIndex(index);
}

/**
 * Resolve actor name to ID using index
 */
function resolveActorId(name) {
  const index = loadIndex();
  return index[name.toLowerCase()] || null;
}

/**
 * Load actor from cache (.nfo format)
 * Returns actor object or null if not found
 * Tries exact name first, then inverted name
 */
function loadFromCache(actorName) {
  const actorsPath = getActorsCachePath();

  // Try to resolve ID from index with exact name first
  let actorId = resolveActorId(actorName);

  // If not found, try inverted name in index
  if (!actorId) {
    const parts = actorName.trim().split(/\s+/);
    if (parts.length === 2) {
      const invertedName = `${parts[1]} ${parts[0]}`;
      actorId = resolveActorId(invertedName);
    }
  }

  // If still not in index, try normalized name as fallback
  if (!actorId) {
    actorId = normalizeActorName(actorName);
  }

  const actorNfoPath = path.join(actorsPath, `${actorId}.nfo`);

  if (!fs.existsSync(actorNfoPath)) {
    return null;
  }

  try {
    const nfoContent = fs.readFileSync(actorNfoPath, 'utf-8');
    const actor = nfoToActor(nfoContent);
    actor.id = actorId;
    return actor;
  } catch (error) {
    console.error(`[CacheHelper] Failed to load from cache:`, error.message);
    return null;
  }
}

/**
 * Save actor to cache (.nfo format)
 * Saves to external path if configured, otherwise internal cache
 */
function saveToCache(actor) {
  const actorsPath = getActorsCachePath();

  // Ensure directory exists
  if (!fs.existsSync(actorsPath)) {
    fs.mkdirSync(actorsPath, { recursive: true });
  }

  // Ensure actor has ID
  if (!actor.id) {
    actor.id = normalizeActorName(actor.name);
  }

  const actorNfoPath = path.join(actorsPath, `${actor.id}.nfo`);

  // Update metadata
  actor.meta = actor.meta || {};
  actor.meta.lastUpdate = new Date().toISOString();

  try {
    // Convert to NFO format and save
    const nfoContent = actorToNFO(actor);
    fs.writeFileSync(actorNfoPath, nfoContent, 'utf-8');
    console.error(`[CacheHelper] Saved to cache: ${actor.id}.nfo`);

    // Update index
    updateIndex(actor);

    return true;
  } catch (error) {
    console.error(`[CacheHelper] Failed to save to cache:`, error.message);
    return false;
  }
}

/**
 * Check if actor data is complete
 */
function isActorComplete(actor) {
  if (!actor) return false;

  const requiredFields = ['name', 'altName', 'birthdate', 'height', 'bust', 'waist', 'hips', 'thumb'];

  return requiredFields.every(field => {
    const value = actor[field];
    if (typeof value === 'string') return value !== '';
    if (typeof value === 'number') return value > 0;
    return value !== null && value !== undefined;
  });
}

/**
 * Merge two actor objects, preferring non-empty values
 */
function mergeActorData(cached, scraped) {
  if (!cached) return scraped;
  if (!scraped) return cached;

  const merged = { ...cached };

  // Merge each field, preferring non-empty scraped data
  Object.keys(scraped).forEach(key => {
    if (key === 'meta' || key === 'id') return; // Skip meta and id

    const scrapedValue = scraped[key];
    const cachedValue = cached[key];

    // Check if scraped value is non-empty
    const isScrapedEmpty = scrapedValue === null ||
                          scrapedValue === '' ||
                          scrapedValue === 0 ||
                          (Array.isArray(scrapedValue) && scrapedValue.length === 0);

    if (!isScrapedEmpty) {
      merged[key] = scrapedValue;
    }
  });

  // Special handling for otherNames - merge arrays
  if (cached.otherNames && scraped.otherNames) {
    const allNames = new Set([...cached.otherNames, ...scraped.otherNames]);
    merged.otherNames = Array.from(allNames);
  }

  return merged;
}

module.exports = {
  loadConfig,
  getActorsCachePath,
  loadFromCache,
  saveToCache,
  isActorComplete,
  mergeActorData,
  resolveActorId,
  updateIndex,
  removeEmptyFields
};
