/**
 * Cache Helper for Actor Scrapers
 *
 * Internal cache (data/actors/) is the single source of truth for all
 * actors and is always used by every scraper, including "local".
 * externalPath is not read by any scraper — it's only a copy destination
 * for actors marked as favorite (see POST /actors/favorite in routes.js).
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
 * Get internal actors cache path (always data/actors/)
 */
function getActorsCachePath() {
  return path.join(__dirname, '../../data/actors');
}

/**
 * Find the actual local photo file for an actor ID in a directory,
 * trying all known extensions. Returns the filename (e.g. "id.webp") or null.
 * Used to self-heal thumbLocal references that point to a deleted/renamed file
 * (e.g. after a re-upload changed the extension).
 */
function findLocalPhoto(dirPath, actorId) {
  const extensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif'];
  for (const ext of extensions) {
    const filename = `${actorId}${ext}`;
    if (fs.existsSync(path.join(dirPath, filename))) return filename;
  }
  return null;
}

/**
 * Get the "copy favorite actors to" path (user-configured, optional).
 * Not read by any scraper — only used as a copy destination when an actor
 * is marked favorite. Returns null if not configured.
 */
function getExternalActorsPath() {
  try {
    const config = loadConfig();
    if (config.scrapers &&
        config.scrapers.actors &&
        config.scrapers.actors.externalPath &&
        config.scrapers.actors.externalPath.trim() !== '') {
      return config.scrapers.actors.externalPath;
    }
  } catch (_) {}
  return null;
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
 *
 * IMPORTANT: Does NOT try inverted names - that's the scraper's responsibility
 * Each scraper should try the inverted name if the first lookup fails
 */
function loadFromCache(actorName) {
  const actorsPath = getActorsCachePath();

  // Try to resolve ID from index
  let actorId = resolveActorId(actorName);

  // If not in index, try normalized name as fallback
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
  getExternalActorsPath,
  findLocalPhoto,
  loadFromCache,
  isActorComplete,
  mergeActorData,
  resolveActorId,
  updateIndex,
  removeEmptyFields
};
