#!/usr/bin/env node

/**
 * ActorScraperManager
 *
 * Manages actor scraping from multiple sources with intelligent merging.
 * - Executes enabled actor scrapers sequentially
 * - Merges results based on priority rules
 * - Caches actors locally in data/actors/
 * - Uses actors-index.json for name variant mapping
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeActorName, actorToNFO, nfoToActor } = require('../../scrapers/actors/schema');
const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
const { loadConfig, getScrapePath } = require('./config');
const { updateActorInIndex, resolveActorId: resolveActorIdFromIndex } = require('./actorIndexManager');

// ─────────────────────────────
// Configuration Loading
// ─────────────────────────────
// Using centralized config from config.js
// Removed getActorsPath() - now using cache-helper's getActorsCachePath()

// Note: Index management is now handled by actorIndexManager.js
// Keeping resolveActorId as a wrapper for backward compatibility

/**
 * Resolve actor name to ID using centralized index manager
 * @param {string} name - Actor name (any variant)
 * @returns {string|null} - Actor ID or null if not found
 */
function resolveActorId(name) {
  return resolveActorIdFromIndex(name);
}

// ─────────────────────────────
// Local Storage
// ─────────────────────────────

/**
 * Load actor data from local storage (.nfo format)
 *
 * @param {string} id - Actor ID (slug)
 * @returns {object|null} - Actor data or null if not found
 */
function loadActorLocal(id) {
  const actorsPath = getActorsCachePath();
  const actorPath = path.join(actorsPath, `${id}.nfo`);

  if (!fs.existsSync(actorPath)) {
    return null;
  }

  try {
    const nfoContent = fs.readFileSync(actorPath, 'utf-8');
    const actor = nfoToActor(nfoContent);
    actor.id = id; // Ensure ID is set
    return actor;
  } catch (error) {
    console.error(`[ActorScraperManager] Failed to load actor ${id}:`, error.message);
    return null;
  }
}

/**
 * Save actor data to local storage (.nfo format)
 *
 * @param {object} actor - Actor data
 */
function saveActorLocal(actor) {
  const actorsPath = getActorsCachePath();

  // Ensure actors directory exists
  if (!fs.existsSync(actorsPath)) {
    fs.mkdirSync(actorsPath, { recursive: true });
  }

  const actorNfoPath = path.join(actorsPath, `${actor.id}.nfo`);

  // Update metadata
  actor.meta = actor.meta || {};
  actor.meta.lastUpdate = new Date().toISOString();

  // Resolve thumb URL before saving
  actor.thumb = resolveActorThumb(actor);

  try {
    // Convert to NFO format and save
    const nfoContent = actorToNFO(actor);
    fs.writeFileSync(actorNfoPath, nfoContent, 'utf-8');
    console.log(`[ActorScraperManager] Saved actor NFO: ${actor.id}.nfo`);

    // Update index using centralized index manager
    updateActorInIndex(actor);
  } catch (error) {
    console.error(`[ActorScraperManager] Failed to save actor ${actor.id}:`, error.message);
  }
}

// ─────────────────────────────
// Scraper Execution
// ─────────────────────────────

/**
 * Execute a single actor scraper
 *
 * @param {string} scraperName - Name of the scraper
 * @param {string} actorName - Actor name to scrape
 * @returns {Promise<object|null>} - Scraped actor data or null
 */
function executeActorScraper(scraperName, actorName) {
  return new Promise(async (resolve) => {
    const scraperPath = path.join(__dirname, '../../scrapers/actors', scraperName, 'run.js');

    // Check if scraper exists
    if (!fs.existsSync(scraperPath)) {
      console.error(`[ActorScraperManager] Scraper not found: ${scraperPath}`);
      resolve(null);
      return;
    }

    console.log(`[ActorScraperManager] Executing scraper in-process: ${scraperName} for ${actorName}`);

    // Try to require the scraper module and execute in-process
    try {
      const scraperModule = require(scraperPath);

      // Prefer exported function `scrapeJavDB` or `scrapeActor` if available
      const fn = (scraperModule && (scraperModule.scrapeJavDB || scraperModule.scrapeActor || scraperModule.scrape))
        ? (scraperModule.scrapeJavDB || scraperModule.scrapeActor || scraperModule.scrape)
        : null;

      if (typeof fn === 'function') {
        // Run scraper with timeout
        const timeoutMs = 30000; // 30s

        const runPromise = (async () => {
          try {
            const result = await fn(actorName);
            return result || null;
          } catch (err) {
            console.error(`[ActorScraperManager] Scraper ${scraperName} threw:`, err.message);
            return null;
          }
        })();

        const timeoutPromise = new Promise(res => setTimeout(() => res(null), timeoutMs));

        const final = await Promise.race([runPromise, timeoutPromise]);

        if (final === null) {
          console.error(`[ActorScraperManager] Scraper ${scraperName} timed out or returned null`);
        } else {
          console.log(`[ActorScraperManager] Scraper ${scraperName} completed successfully (in-process)`);
        }

        resolve(final);
        return;
      }
    } catch (error) {
      console.error(`[ActorScraperManager] Failed to execute scraper ${scraperName}:`, error.message);
      resolve(null);
    }
  });
}

// ─────────────────────────────
// Thumb URL Resolution
// ─────────────────────────────

/**
 * Resolve the best thumb URL for an actor based on available data
 *
 * Priority:
 * 1. Original URL from scraper (thumbUrl) - always works, filesystem-independent
 * 2. Uploaded local files (thumbLocal starting with upload_) - use /media/ endpoint
 * 3. Absolute path (if actorsPath configured and file exists)
 * 4. Relative path /actors/filename - for WebUI compatibility
 *
 * @param {object} actorData - Actor data object
 * @returns {string} - Best thumb URL to use
 */
function resolveActorThumb(actorData) {
  // Priority 1: Use original URL if available
  if (actorData.thumbUrl && actorData.thumbUrl.startsWith('http')) {
    return actorData.thumbUrl;
  }

  // Priority 2: Use thumb field BUT only if it's a remote URL
  // If it's a local /actors/ or /media/ path, we ignore it for "resolution" 
  // as the frontend handles local lookup via ID and thumbLocal.
  if (actorData.thumb && actorData.thumb.startsWith('http')) {
    return actorData.thumb;
  }

  // Priority 3: For local uploaded files, use /media/ endpoint (if in temp)
  if (actorData.thumbLocal && (actorData.thumbLocal.startsWith('upload_') || actorData.thumbLocal.startsWith('temp_'))) {
    return `/media/${actorData.thumbLocal}`;
  }

  // Final fallback: return empty string. 
  // We NO LONGER return speculative /actors/ paths here because 
  // we want the <thumb> field in the NFO to remain empty when the file is local.
  return '';
}

// ─────────────────────────────
// Data Merging
// ─────────────────────────────

/**
 * Check if actor data is complete (all fields populated)
 *
 * @param {object} actor - Actor data
 * @returns {boolean} - True if complete
 */
function isActorComplete(actor) {
  // Check ALL fields - if any field is empty, we should scrape online to fill it
  const fieldsToCheck = ['name', 'altName', 'birthdate', 'height', 'bust', 'waist', 'hips', 'thumb'];

  const emptyFields = [];
  const isComplete = fieldsToCheck.every(field => {
    const value = actor[field];
    let isEmpty = false;

    if (typeof value === 'string') {
      isEmpty = value === '';
    } else if (typeof value === 'number') {
      isEmpty = value <= 0;
    } else {
      isEmpty = value === null || value === undefined;
    }

    if (isEmpty) {
      emptyFields.push(field);
    }

    return !isEmpty;
  });

  if (!isComplete) {
    console.log(`[ActorScraperManager] Actor incomplete. Missing fields: ${emptyFields.join(', ')}`);
  }

  return isComplete;
}

/**
 * Merge local actor data with scraped data
 * Local data takes priority for non-empty fields
 *
 * @param {object} localActor - Local actor data
 * @param {object} scrapedActor - Scraped actor data
 * @returns {object} - Merged actor data
 */
function mergeLocalWithScraped(localActor, scrapedActor) {
  const { createEmptyActor } = require('../../scrapers/actors/schema');

  console.log('[ActorScraperManager] Merging local and scraped data:');
  console.log('[ActorScraperManager] Local actor:', JSON.stringify(localActor, null, 2));
  console.log('[ActorScraperManager] Scraped actor:', JSON.stringify(scrapedActor, null, 2));

  // Start with scraped data as base
  const merged = { ...scrapedActor };

  // Override with local data for non-empty fields
  Object.keys(localActor).forEach(fieldName => {
    // Skip meta field (will be handled separately)
    if (fieldName === 'meta') return;

    const localValue = localActor[fieldName];

    // Check if local value is non-empty
    const isEmpty = localValue === null ||
      localValue === undefined ||
      localValue === '' ||
      localValue === 0 ||
      (Array.isArray(localValue) && localValue.length === 0);

    // Use local value if not empty
    if (!isEmpty) {
      console.log(`[ActorScraperManager] Using local value for ${fieldName}: ${localValue}`);
      merged[fieldName] = localValue;
    } else {
      console.log(`[ActorScraperManager] Local value for ${fieldName} is empty, using scraped value: ${scrapedActor[fieldName]}`);
    }
  });

  // Preserve important local metadata
  merged.meta = merged.meta || {};
  if (localActor.meta) {
    // Preserve thumbLocal if it was manually uploaded (starts with upload_)
    if (localActor.meta.thumbLocal && localActor.meta.thumbLocal.startsWith('upload_')) {
      merged.thumbLocal = localActor.meta.thumbLocal;
    }

    // Preserve any custom metadata
    if (localActor.meta.custom) {
      merged.meta.custom = localActor.meta.custom;
    }
  }

  // Update metadata
  merged.meta.sources = merged.meta.sources || [];
  if (localActor.meta && localActor.meta.sources) {
    // Merge sources from both local and scraped
    const allSources = [...new Set([...localActor.meta.sources, ...merged.meta.sources])];
    merged.meta.sources = allSources;
  }
  merged.meta.lastUpdate = new Date().toISOString();

  console.log('[ActorScraperManager] Merged result:', JSON.stringify(merged, null, 2));

  return merged;
}

/**
 * Merge actor data from multiple scrapers
 * Uses intelligent priority-based merging
 *
 * @param {string} actorName - Actor name
 * @param {object[]} scraperResults - Array of {scraperName, data} objects
 * @param {string[]} scraperPriority - Ordered list of scraper names
 * @returns {object} - Merged actor data
 */
function mergeActorData(actorName, scraperResults, scraperPriority) {
  const { createEmptyActor } = require('../../scrapers/actors/schema');

  // Start with empty actor structure
  const merged = createEmptyActor(actorName);
  const sources = [];

  // Get all unique fields from all scrapers
  const allFields = new Set();
  scraperResults.forEach(({ data }) => {
    if (data) {
      Object.keys(data).forEach(field => {
        if (field !== 'meta') {
          allFields.add(field);
        }
      });
    }
  });

  // For each field, select value based on priority
  allFields.forEach(fieldName => {
    // Skip id (already set)
    if (fieldName === 'id') return;

    // Special handling for otherNames (merge all unique values)
    if (fieldName === 'otherNames') {
      const allNames = new Set();
      scraperResults.forEach(({ data }) => {
        if (data && data.otherNames && Array.isArray(data.otherNames)) {
          data.otherNames.forEach(name => allNames.add(name));
        }
      });
      if (allNames.size > 0) {
        merged.otherNames = Array.from(allNames);
      }
      return;
    }

    // For other fields, use priority order
    for (const scraperName of scraperPriority) {
      const scraperResult = scraperResults.find(r => r.scraperName === scraperName && r.data);

      if (scraperResult && scraperResult.data[fieldName] !== undefined) {
        const value = scraperResult.data[fieldName];

        // Check if value is non-empty
        const isEmpty = value === null ||
          value === '' ||
          value === 0 ||
          (Array.isArray(value) && value.length === 0);

        if (!isEmpty) {
          merged[fieldName] = value;

          // Track which scraper provided this field
          if (!sources.includes(scraperName)) {
            sources.push(scraperName);
          }

          break; // Found non-empty value, stop looking
        }
      }
    }
  });

  // Set metadata
  merged.meta.sources = sources;
  merged.meta.lastUpdate = new Date().toISOString();

  return merged;
}

// ─────────────────────────────
// Main Scraping Function
// ─────────────────────────────

/**
 * Scrape actor data from enabled scrapers
 * Uses intelligent merging and stops when all fields are populated
 *
 * @param {string} actorName - Actor name (any variant)
 * @param {EventEmitter} emitter - Optional event emitter for progress updates
 * @returns {Promise<object|null>} - Merged actor data or null
 */
async function scrapeActor(actorName, emitter = null) {
  const config = loadConfig();

  // Check if actors feature is enabled
  const actorsEnabled = (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled !== false);

  if (!actorsEnabled) {
    console.error('[ActorScraperManager] Actor scraping is disabled in config');
    return null;
  }

  // Get enabled scrapers from config.scrapers.actors.scrapers (default to ['javdb'])
  const enabledScrapers = (config.scrapers && config.scrapers.actors && config.scrapers.actors.scrapers)
    ? config.scrapers.actors.scrapers
    : ['javdb'];

  console.log(`[ActorScraperManager] Scraping actor: ${actorName}`);
  console.log(`[ActorScraperManager] Enabled scrapers: ${enabledScrapers.join(', ')}`);

  if (emitter) {
    emitter.emit('progress', {
      message: `  📂 Scrapers: ${enabledScrapers.join(', ')}`
    });
  }

  // Try to resolve actor ID from index
  let actorId = resolveActorId(actorName);

  if (!actorId) {
    // Generate new ID from name
    actorId = normalizeActorName(actorName);
    console.log(`[ActorScraperManager] New actor, generated ID: ${actorId}`);
  } else {
    console.log(`[ActorScraperManager] Found existing actor ID: ${actorId}`);
  }

  const scraperResults = [];

  // Execute scrapers sequentially
  for (const scraperName of enabledScrapers) {
    if (emitter) {
      emitter.emit('progress', {
        message: `  🔍 Trying scraper: ${scraperName}`
      });
    }

    const result = await executeActorScraper(scraperName, actorName);

    if (result) {
      scraperResults.push({
        scraperName,
        data: result
      });

      console.log(`[ActorScraperManager] Scraper ${scraperName} completed successfully`);

      if (emitter) {
        emitter.emit('progress', {
          message: `  ✓ Scraper ${scraperName} - data found`
        });
      }

      // Check if we have all fields populated
      const tempMerged = mergeActorData(actorName, scraperResults, enabledScrapers);
      if (isActorComplete(tempMerged)) {
        console.log('[ActorScraperManager] All fields populated, stopping scraping');

        if (emitter) {
          emitter.emit('progress', {
            message: `  ✓ All fields complete, stopping`
          });
        }
        break;
      }
    } else {
      if (emitter) {
        emitter.emit('progress', {
          message: `  ✗ Scraper ${scraperName} - no data`
        });
      }
    }
  }

  // If no data found, return null
  if (scraperResults.length === 0) {
    console.error('[ActorScraperManager] No data found for actor');
    return null;
  }

  // Merge results
  const merged = mergeActorData(actorName, scraperResults, enabledScrapers);

  // Save to local storage
  saveActorLocal(merged);

  return merged;
}

/**
 * Get actor data (from cache or scrape if needed)
 * Tries exact name first, then inverted name in cache
 *
 * @param {string} actorName - Actor name (any variant)
 * @param {boolean} forceOverwrite - If true, always scrape from remote and overwrite local data
 * @returns {Promise<object|null>} - Actor data or null
 */
async function getActor(actorName, forceOverwrite = false) {
  // If forceOverwrite is true, skip cache and scrape directly
  // BUT do NOT save yet - just return the scraped data
  // The frontend will handle the overwrite when user actually saves
  if (forceOverwrite) {
    console.log(`[ActorScraperManager] Force overwrite enabled, scraping from remote (not saving): ${actorName}`);
    const scrapedActor = await scrapeActor(actorName);

    // Just return the scraped data without saving
    // The thumb will be a remote URL, which is fine for preview
    return scrapedActor;
  }

  // Normal flow: try cache first
  // Try to resolve actor ID from index with exact name
  let actorId = resolveActorId(actorName);

  // If not found, try inverted name
  if (!actorId) {
    const parts = actorName.trim().split(/\s+/);
    if (parts.length === 2) {
      const invertedName = `${parts[1]} ${parts[0]}`;
      console.log(`[ActorScraperManager] Trying inverted name in cache: ${invertedName}`);
      actorId = resolveActorId(invertedName);
    }
  }

  if (actorId) {
    // Try to load from local storage
    const localActor = loadActorLocal(actorId);

    if (localActor) {
      console.log(`[ActorScraperManager] Loaded actor from cache: ${actorId}`);

      // Check if local data is complete
      if (isActorComplete(localActor)) {
        console.log(`[ActorScraperManager] Actor is complete, returning from cache`);
        return localActor;
      }

      // Local data is incomplete - scrape online to fill missing fields
      console.log(`[ActorScraperManager] Actor in cache but incomplete, scraping to fill missing fields: ${actorId}`);

      const scrapedActor = await scrapeActor(actorName);

      if (scrapedActor) {
        // Merge local and scraped data (local takes priority for non-empty fields)
        const mergedActor = mergeLocalWithScraped(localActor, scrapedActor);

        // Save the merged data
        saveActorLocal(mergedActor);

        console.log(`[ActorScraperManager] Merged local and scraped data for: ${actorId}`);
        return mergedActor;
      }

      // Scraping failed, return incomplete local data
      console.log(`[ActorScraperManager] Scraping failed, returning incomplete local data: ${actorId}`);
      return localActor;
    }
  }

  // Not in cache, scrape it
  console.log(`[ActorScraperManager] Actor not in cache, scraping: ${actorName}`);
  return await scrapeActor(actorName);
}

// ─────────────────────────────
// Batch Processing
// ─────────────────────────────

// getScrapePath() is now imported from config.js and always returns data/scrape

/**
 * Extract all unique actor names from scraped movie JSON files
 *
 * @returns {string[]} - Array of unique actor names
 */
function extractActorNamesFromMovies() {
  const scrapePath = getScrapePath();

  if (!fs.existsSync(scrapePath)) {
    console.error('[ActorScraperManager] Scrape directory not found');
    return [];
  }

  const actorNames = new Set();

  try {
    const files = fs.readdirSync(scrapePath);

    files.forEach(filename => {
      // Skip non-JSON files
      if (!filename.endsWith('.json')) return;

      const filePath = path.join(scrapePath, filename);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        let data = JSON.parse(content);

        // Handle wrapped format (with 'data' property from scrapeReader)
        if (data.data && typeof data.data === 'object') {
          data = data.data;
        }

        // Extract actors from movie data
        if (data.actor && Array.isArray(data.actor)) {
          data.actor.forEach(actor => {
            if (actor.name) {
              actorNames.add(actor.name);
            }
          });
        }
      } catch (error) {
        console.error(`[ActorScraperManager] Failed to read ${filename}:`, error.message);
      }
    });

    console.log(`[ActorScraperManager] Found ${actorNames.size} unique actors in ${files.length} movies`);
    return Array.from(actorNames);
  } catch (error) {
    console.error('[ActorScraperManager] Failed to extract actor names:', error.message);
    return [];
  }
}

/**
 * Batch scrape all actors from scraped movie files
 * This is called after movie scraping is complete
 *
 * @param {EventEmitter} emitter - Optional event emitter for progress updates
 * @returns {Promise<object>} - Summary of scraping results
 */
async function batchScrapeActors(emitter = null) {
  const config = loadConfig();

  // Check if actors feature is enabled
  const actorsEnabled = (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled !== false);

  if (!actorsEnabled) {
    console.error('[ActorScraperManager] Actor scraping is disabled in config');
    return {
      success: false,
      message: 'Actor scraping is disabled',
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  console.log('[Actor Scrape] Starting batch actor scraping...');

  if (emitter) {
    emitter.emit('progress', {
      message: '[Actor Scrape] Extracting actor names from movies...'
    });
  }

  // Extract all actor names from movie JSONs
  const actorNames = extractActorNamesFromMovies();

  if (actorNames.length === 0) {
    console.error('[Actor Scrape] No actors found in movie files');
    return {
      success: true,
      message: 'No actors to scrape',
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  console.log(`[Actor Scrape] Found ${actorNames.length} unique actors in movies`);

  if (emitter) {
    emitter.emit('progress', {
      message: `[Actor Scrape] Found ${actorNames.length} unique actor(s) to process`
    });
  }

  let scraped = 0;
  let cached = 0;
  let failed = 0;

  // Process each actor
  for (let i = 0; i < actorNames.length; i++) {
    const actorName = actorNames[i];
    console.log(`[Actor Scrape] Processing ${i + 1}/${actorNames.length}: ${actorName}`);

    if (emitter) {
      emitter.emit('progress', {
        message: `[Actor Scrape] Processing ${i + 1}/${actorNames.length}: ${actorName}`
      });
    }

    try {
      // Check if already in cache and complete
      const actorId = resolveActorId(actorName);
      if (actorId) {
        const existing = loadActorLocal(actorId);
        if (existing && isActorComplete(existing)) {
          console.log(`[Actor Scrape] Actor already cached and complete: ${actorName}`);
          cached++;

          if (emitter) {
            emitter.emit('progress', {
              message: `[Actor Scrape] ${actorName} - found in cache`
            });
          }
          continue;
        }
      }

      // Use getActor which checks cache first, then scrapes if needed
      const actorData = await getActor(actorName);

      if (actorData) {
        // Check if it was from cache or scraped
        if (actorId && loadActorLocal(actorId)) {
          scraped++;
          console.log(`[Actor Scrape] Successfully processed: ${actorName}`);
        } else {
          scraped++;
          console.log(`[Actor Scrape] Successfully scraped: ${actorName}`);
        }

        if (emitter) {
          emitter.emit('progress', {
            message: `[Actor Scrape] ${actorName} - processed successfully`
          });
        }
      } else {
        failed++;
        console.log(`[Actor Scrape] Failed to process: ${actorName}`);

        if (emitter) {
          emitter.emit('progress', {
            message: `[Actor Scrape] ${actorName} - processing failed`
          });
        }
      }
    } catch (error) {
      failed++;
      console.error(`[Actor Scrape] Error processing ${actorName}:`, error.message);

      if (emitter) {
        emitter.emit('progress', {
          message: `[Actor Scrape] ${actorName} - error: ${error.message}`
        });
      }
    }
  }

  const summary = {
    success: true,
    message: 'Batch scraping completed',
    total: actorNames.length,
    scraped: scraped,
    cached: cached,
    failed: failed
  };

  console.log('[ActorScraperManager] Batch scraping summary:', summary);
  return summary;
}

/**
 * Update all movie JSON files with enriched actor data from cache
 *
 * @returns {Promise<object>} - Summary of update results
 */
async function updateMovieActorData() {
  const scrapePath = getScrapePath();

  if (!fs.existsSync(scrapePath)) {
    console.error('[ActorScraperManager] Scrape directory not found');
    return {
      success: false,
      message: 'Scrape directory not found',
      total: 0,
      updated: 0,
      failed: 0
    };
  }

  console.log('[ActorScraperManager] Updating movie files with actor data...');

  let updated = 0;
  let failed = 0;
  let total = 0;

  try {
    const files = fs.readdirSync(scrapePath);

    for (const filename of files) {
      // Skip non-JSON files
      if (!filename.endsWith('.json')) continue;

      total++;
      const filePath = path.join(scrapePath, filename);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileData = JSON.parse(content);

        // Handle wrapped format (with 'data' property from scrapeReader)
        const hasWrapper = fileData.data && typeof fileData.data === 'object';
        const movieData = hasWrapper ? fileData.data : fileData;

        // Check if movie has actors
        if (!movieData.actor || !Array.isArray(movieData.actor)) {
          continue;
        }

        let movieUpdated = false;

        // Update each actor in the movie
        for (const actor of movieData.actor) {
          if (!actor.name) continue;

          // Resolve actor ID
          const actorId = resolveActorId(actor.name);
          if (!actorId) {
            console.error(`[ActorScraperManager] No actor ID found for: ${actor.name}`);
            continue;
          }

          // Load actor data from cache
          const actorData = loadActorLocal(actorId);
          if (!actorData) {
            console.error(`[ActorScraperManager] Actor not in cache: ${actor.name}`);
            continue;
          }

          // Update actor fields in movie JSON
          actor.altName = actorData.altName || actor.altName;
          actor.birthdate = actorData.birthdate || actor.birthdate;
          actor.height = actorData.height || actor.height;
          actor.bust = actorData.bust || actor.bust;
          actor.waist = actorData.waist || actor.waist;
          actor.hips = actorData.hips || actor.hips;
          actor.thumb = resolveActorThumb(actorData);

          movieUpdated = true;
        }

        // Save updated movie JSON (preserve wrapper if it exists)
        if (movieUpdated) {
          const dataToSave = hasWrapper ? fileData : movieData;
          fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
          updated++;
          console.log(`[ActorScraperManager] Updated movie: ${filename}`);
        }
      } catch (error) {
        failed++;
        console.error(`[ActorScraperManager] Failed to update ${filename}:`, error.message);
      }
    }

    const summary = {
      success: true,
      message: 'Movie update completed',
      total: total,
      updated: updated,
      failed: failed
    };

    console.log('[ActorScraperManager] Movie update summary:', summary);
    return summary;
  } catch (error) {
    console.error('[ActorScraperManager] Failed to update movies:', error.message);
    return {
      success: false,
      message: error.message,
      total: total,
      updated: updated,
      failed: failed
    };
  }
}

/**
 * Complete batch workflow: scrape actors + update movie JSONs
 *
 * @param {EventEmitter} emitter - Optional event emitter for progress updates
 * @returns {Promise<object>} - Complete workflow summary
 */
async function batchProcessActors(emitter = null) {
  console.log('[ActorScraperManager] Starting complete batch actor processing...');

  // Step 1: Scrape all actors
  const scrapeSummary = await batchScrapeActors(emitter);

  // Step 2: Update movie JSON files
  if (emitter) {
    emitter.emit('progress', {
      message: '[Actor Scrape] Updating movie files with actor data...'
    });
  }

  const updateSummary = await updateMovieActorData();

  if (emitter) {
    emitter.emit('progress', {
      message: `[Actor Scrape] Updated ${updateSummary.updated} movie file(s)`
    });
  }

  return {
    success: scrapeSummary.success && updateSummary.success,
    scraping: scrapeSummary,
    updating: updateSummary
  };
}

module.exports = {
  scrapeActor,
  getActor,
  loadActorLocal,
  saveActorLocal,
  resolveActorId,
  batchScrapeActors,
  updateMovieActorData,
  batchProcessActors
};
