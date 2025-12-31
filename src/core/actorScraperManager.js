#!/usr/bin/env node

/**
 * ActorScraperManager
 *
 * Manages actor scraping from multiple sources with intelligent merging.
 * - Executes enabled actor scrapers sequentially
 * - Merges results based on priority rules
 * - Caches actors locally in data/actors/
 * - Uses .index.json for name variant mapping
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeActorName, actorToNFO, nfoToActor } = require('../../scrapers/actors/schema');
const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
const { loadConfig } = require('./config');

// ─────────────────────────────
// Configuration Loading
// ─────────────────────────────
// Using centralized config from config.js
// Removed getActorsPath() - now using cache-helper's getActorsCachePath()

// ─────────────────────────────
// Index Management
// ─────────────────────────────

/**
 * Load actor index from .index.json
 * Maps name variants to normalized slug IDs
 *
 * @returns {object} - Index mapping
 */
function loadIndex() {
  const actorsPath = getActorsCachePath();
  const indexPath = path.join(actorsPath, '.index.json');

  if (!fs.existsSync(indexPath)) {
    return {};
  }

  try {
    const data = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[ActorScraperManager] Failed to load index:', error.message);
    return {};
  }
}

/**
 * Save actor index to .index.json
 *
 * @param {object} index - Index mapping
 */
function saveIndex(index) {
  const actorsPath = getActorsCachePath();
  const indexPath = path.join(actorsPath, '.index.json');

  // Ensure actors directory exists
  if (!fs.existsSync(actorsPath)) {
    fs.mkdirSync(actorsPath, { recursive: true });
  }

  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error('[ActorScraperManager] Failed to save index:', error.message);
  }
}

/**
 * Update index with actor name variants
 *
 * @param {object} actor - Actor data
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
 *
 * @param {string} name - Actor name (any variant)
 * @returns {string|null} - Actor ID or null if not found
 */
function resolveActorId(name) {
  const index = loadIndex();
  return index[name.toLowerCase()] || null;
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

    // Update index
    updateIndex(actor);
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
  return new Promise((resolve) => {
    const scraperPath = path.join(__dirname, '../../scrapers/actors', scraperName, 'run.js');

    // Check if scraper exists
    if (!fs.existsSync(scraperPath)) {
      console.error(`[ActorScraperManager] Scraper not found: ${scraperPath}`);
      resolve(null);
      return;
    }

    console.log(`[ActorScraperManager] Executing scraper: ${scraperName} for ${actorName}`);

    // Spawn scraper process
    const child = spawn('node', [scraperPath, actorName], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let hasResolved = false;

    // Set timeout (10 seconds)
    const timeout = setTimeout(() => {
      if (!hasResolved) {
        console.error(`[ActorScraperManager] Scraper ${scraperName} timed out after 10s`);
        hasResolved = true;
        child.kill('SIGTERM');

        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (!child.killed) {
            console.error(`[ActorScraperManager] Force killing scraper ${scraperName}`);
            child.kill('SIGKILL');
          }
        }, 2000);

        resolve(null);
      }
    }, 10000);

    // Collect stdout
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Capture stderr (progress logs)
    child.stderr.on('data', (data) => {
      console.log(data.toString());
    });

    // Handle process exit
    child.on('close', (code) => {
      if (hasResolved) return;

      clearTimeout(timeout);
      hasResolved = true;

      if (code !== 0) {
        console.error(`[ActorScraperManager] Scraper ${scraperName} exited with code ${code}`);
        resolve(null);
        return;
      }

      // Parse JSON output
      try {
        const result = JSON.parse(stdout);
        console.log(`[ActorScraperManager] Scraper ${scraperName} completed successfully`);
        resolve(result);
      } catch (error) {
        console.error(`[ActorScraperManager] Failed to parse JSON from ${scraperName}:`, error.message);
        resolve(null);
      }
    });

    // Handle process error
    child.on('error', (error) => {
      if (hasResolved) return;

      clearTimeout(timeout);
      hasResolved = true;

      console.error(`[ActorScraperManager] Failed to execute ${scraperName}:`, error.message);
      resolve(null);
    });
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
 * 2. Absolute path (if actorsPath configured and file exists)
 * 3. Relative path /actors/filename - for WebUI compatibility
 *
 * @param {object} actorData - Actor data object
 * @returns {string} - Best thumb URL to use
 */
function resolveActorThumb(actorData) {
  const config = loadConfig();

  // Priority 1: Use original URL if available
  if (actorData.thumbUrl && actorData.thumbUrl.startsWith('http')) {
    return actorData.thumbUrl;
  }

  // Priority 2: Use absolute path if actorsPath is configured
  if (config.actorsPath && actorData.thumbLocal) {
    const absolutePath = path.join(config.actorsPath, actorData.thumbLocal);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  // Priority 3: Fallback to relative path (for WebUI)
  if (actorData.thumbLocal) {
    return `/actors/${path.basename(actorData.thumbLocal)}`;
  }

  // Final fallback: use whatever thumb value exists
  return actorData.thumb || '';
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
  const requiredFields = ['name', 'altName', 'birthdate', 'height', 'bust', 'waist', 'hips', 'thumb'];

  return requiredFields.every(field => {
    const value = actor[field];
    if (typeof value === 'string') return value !== '';
    if (typeof value === 'number') return value > 0;
    return value !== null && value !== undefined;
  });
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
 *
 * @param {string} actorName - Actor name (any variant)
 * @returns {Promise<object|null>} - Actor data or null
 */
async function getActor(actorName) {
  // Try to resolve actor ID from index
  const actorId = resolveActorId(actorName);

  if (actorId) {
    // Try to load from local storage
    const actor = loadActorLocal(actorId);
    if (actor) {
      console.log(`[ActorScraperManager] Loaded actor from cache: ${actorId}`);
      return actor;
    }
  }

  // Not in cache, scrape it
  console.log(`[ActorScraperManager] Actor not in cache, scraping: ${actorName}`);
  return await scrapeActor(actorName);
}

// ─────────────────────────────
// Batch Processing
// ─────────────────────────────

/**
 * Get scrape path based on library path
 * Items are stored in {libraryPath}/.javinizer/scrape/
 */
function getScrapePath() {
  const config = loadConfig();
  const libraryPath = config.libraryPath;

  if (!libraryPath) {
    return path.join(__dirname, '../../data/scrape'); // Fallback
  }

  return path.join(libraryPath, '.javinizer', 'scrape');
}

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

  console.log('[ActorScraperManager] Starting batch actor scraping...');

  if (emitter) {
    emitter.emit('progress', {
      message: '🔍 Extracting actor names from movies...'
    });
  }

  // Extract all actor names from movie JSONs
  const actorNames = extractActorNamesFromMovies();

  if (actorNames.length === 0) {
    console.error('[ActorScraperManager] No actors found in movie files');
    return {
      success: true,
      message: 'No actors to scrape',
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  console.log(`[ActorScraperManager] Found ${actorNames.length} unique actors in movies`);

  if (emitter) {
    emitter.emit('progress', {
      message: `📋 Found ${actorNames.length} unique actor(s) to process`
    });
  }

  let scraped = 0;
  let cached = 0;
  let failed = 0;

  // Process each actor
  for (let i = 0; i < actorNames.length; i++) {
    const actorName = actorNames[i];
    console.log(`[ActorScraperManager] Processing actor ${i + 1}/${actorNames.length}: ${actorName}`);

    if (emitter) {
      emitter.emit('progress', {
        message: `👤 Processing ${i + 1}/${actorNames.length}: ${actorName}`
      });
    }

    try {
      // Check if already in cache
      const actorId = resolveActorId(actorName);
      if (actorId) {
        const existing = loadActorLocal(actorId);
        if (existing) {
          console.log(`[ActorScraperManager] Actor already cached: ${actorName}`);
          cached++;

          if (emitter) {
            emitter.emit('progress', {
              message: `✓ ${actorName} - found in cache`
            });
          }
          continue;
        }
      }

      // Scrape actor (pass emitter for detailed scraper logs)
      const actorData = await scrapeActor(actorName, emitter);

      if (actorData) {
        scraped++;
        console.log(`[ActorScraperManager] Successfully scraped: ${actorName}`);

        if (emitter) {
          emitter.emit('progress', {
            message: `✓ ${actorName} - scraped successfully`
          });
        }
      } else {
        failed++;
        console.log(`[ActorScraperManager] Failed to scrape: ${actorName}`);

        if (emitter) {
          emitter.emit('progress', {
            message: `✗ ${actorName} - scraping failed`
          });
        }
      }
    } catch (error) {
      failed++;
      console.error(`[ActorScraperManager] Error scraping ${actorName}:`, error.message);

      if (emitter) {
        emitter.emit('progress', {
          message: `✗ ${actorName} - error: ${error.message}`
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
      message: '📝 Updating movie files with actor data...'
    });
  }

  const updateSummary = await updateMovieActorData();

  if (emitter) {
    emitter.emit('progress', {
      message: `✅ Updated ${updateSummary.updated} movie file(s)`
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
  updateIndex,
  batchScrapeActors,
  updateMovieActorData,
  batchProcessActors
};
