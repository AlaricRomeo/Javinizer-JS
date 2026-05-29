#!/usr/bin/env node

/**
 * ActorScraperManager
 *
 * Manages actor scraping from multiple sources with intelligent merging.
 * - Executes enabled actor scrapers sequentially
 * - Merges results based on priority rules
 * - Caches actors locally in data/actors/
 * - Finds actors by scanning NFO files (no index)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { normalizeActorName, actorToNFO, nfoToActor } = require('../../scrapers/actors/schema');
const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');
const { loadConfig, getScrapePath } = require('./config');

// ─────────────────────────────
// Local Storage
// ─────────────────────────────


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
function executeActorScraper(scraperName, actorName, nameVariants = []) {
  return new Promise(async (resolve) => {
    const scraperPath = path.join(__dirname, '../../scrapers/actors', scraperName, 'run.js');

    if (!fs.existsSync(scraperPath)) {
      console.error(`[ActorScraperManager] Scraper not found: ${scraperPath}`);
      resolve(null);
      return;
    }

    try {
      const scraperModule = require(scraperPath);

      const fn = (scraperModule && (scraperModule.scrapeLocal || scraperModule.scrapeJavDB || scraperModule.scrapeActor || scraperModule.scrape))
        ? (scraperModule.scrapeLocal || scraperModule.scrapeJavDB || scraperModule.scrapeActor || scraperModule.scrape)
        : null;

      if (typeof fn === 'function') {
        // FlareSolverr-based scrapers (xslist) need more time
        const timeoutMs = ['xslist'].includes(scraperName) ? 120000 : 30000;

        // Build unique list: original + inverted + all variants + their inverted forms
        const invert = n => { const p = n.trim().split(/\s+/); return p.length === 2 ? `${p[1]} ${p[0]}` : n; };
        const seen = new Set();
        const allNames = [actorName, invert(actorName), ...nameVariants]
          .flatMap(n => [n, invert(n)])
          .filter(n => { if (!n || seen.has(n)) return false; seen.add(n); return true; });

        const runPromise = (async () => {
          for (const name of allNames) {
            try {
              console.log(`[ActorScraperManager] Executing scraper in-process: ${scraperName} for ${name}`);
              const result = await fn(name);
              if (result) return result;
            } catch (err) {
              console.error(`[ActorScraperManager] Scraper ${scraperName} threw for "${name}":`, err.message);
            }
          }
          return null;
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
  // Priority 1: local temp/uploaded file
  if (actorData.thumbLocal && (actorData.thumbLocal.startsWith('upload_') || actorData.thumbLocal.startsWith('temp_'))) {
    return `/media/${actorData.thumbLocal}`;
  }

  // Priority 2: local saved file — always prefer over online URL
  if (actorData.thumbLocal) {
    return `/actors/${actorData.thumbLocal}`;
  }

  // Priority 3: online URL (thumbUrl or thumb)
  if (actorData.thumbUrl && actorData.thumbUrl.startsWith('http')) {
    return actorData.thumbUrl;
  }

  if (actorData.thumb && actorData.thumb.startsWith('http')) {
    return actorData.thumb;
  }

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


/**
 * Extract all name variants from scraper results collected so far.
 * Used to pass alt names to subsequent scrapers.
 */
function extractNameVariants(scraperResults) {
  const variants = new Set();
  for (const { data } of scraperResults) {
    if (!data) continue;
    if (data.name) variants.add(data.name);
    if (data.altName) {
      data.altName.split(',').map(s => s.trim()).filter(Boolean).forEach(n => variants.add(n));
    }
    if (data.otherNames && Array.isArray(data.otherNames)) {
      data.otherNames.forEach(n => n && variants.add(n));
    }
  }
  return Array.from(variants);
}

// ─────────────────────────────
// Main Scraping Function
// ─────────────────────────────

/**
 * Core scraping function — runs enabled scrapers sequentially and merges results.
 * @param {string} actorName
 * @param {string[]} enabledScrapers
 * @param {string} actorId
 * @param {EventEmitter|null} emitter
 */
async function runScrapers(actorName, enabledScrapers, actorId, emitter, initialVariants = []) {
  if (emitter) emitter.emit('progress', { message: `  📂 Scrapers: ${enabledScrapers.join(', ')}` });

  const scraperResults = [];

  for (const scraperName of enabledScrapers) {
    if (emitter) emitter.emit('progress', { message: `[${scraperName}] Searching for: ${actorName}` });

    const variants = [...new Set([...initialVariants, ...extractNameVariants(scraperResults)])];
    const result = await executeActorScraper(scraperName, actorName, variants);

    if (result) {
      scraperResults.push({ scraperName, data: result });
      console.log(`[ActorScraperManager] Scraper ${scraperName} completed successfully`);
      if (emitter) emitter.emit('progress', { message: `[${scraperName}] ✓ Data found` });

      // Local scraper found data — if complete, skip online scrapers; if incomplete, continue to fill missing fields
      if (scraperName === 'local') {
        const tempMerged = mergeActorData(actorName, scraperResults, enabledScrapers);
        if (isActorComplete(tempMerged)) {
          console.log('[ActorScraperManager] Local found complete actor, skipping online scrapers');
          if (emitter) emitter.emit('progress', { message: `  ✓ Found locally (complete), skipping online scrapers` });
          break;
        }
        console.log('[ActorScraperManager] Local found incomplete actor, continuing with online scrapers to fill missing fields');
        if (emitter) emitter.emit('progress', { message: `  ⚠ Found locally but incomplete, fetching missing fields online` });
        continue;
      }

      const tempMerged = mergeActorData(actorName, scraperResults, enabledScrapers);
      if (isActorComplete(tempMerged)) {
        console.log('[ActorScraperManager] All fields populated, stopping scraping');
        if (emitter) emitter.emit('progress', { message: `  ✓ All fields complete, stopping` });
        break;
      }
    } else {
      if (emitter) emitter.emit('progress', { message: `[${scraperName}] ✗ Not found` });
    }
  }

  if (scraperResults.length === 0) {
    console.error('[ActorScraperManager] No data found for actor');
    return null;
  }

  const merged = mergeActorData(actorName, scraperResults, enabledScrapers);

  // Use ID from scraper results (e.g. from local/externalPath NFO) if available,
  // otherwise fall back to the derived actorId
  const idFromResults = scraperResults.map(r => r.data && r.data.id).find(id => id);
  merged.id = idFromResults || actorId;

  console.log(`[ActorScraperManager] Using actor ID: ${merged.id}`);
  saveActorLocal(merged);
  return merged;
}

/**
 * Scrape actor using all enabled scrapers.
 */
async function scrapeActor(actorName, emitter = null) {
  const config = loadConfig();
  if (!(config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled !== false)) {
    console.error('[ActorScraperManager] Actor scraping is disabled in config');
    return null;
  }

  const enabledScrapers = config.scrapers?.actors?.scrapers || ['javdb'];
  console.log(`[ActorScraperManager] Scraping actor: ${actorName}, scrapers: ${enabledScrapers.join(', ')}`);

  // Pre-load all known name variants from local storage so every scraper can try them
  const { scrapeLocal } = require('../../scrapers/actors/local/run');
  const localData = await scrapeLocal(actorName).catch(() => null);
  const actorId = (localData && localData.id) ? localData.id : normalizeActorName(actorName);
  const initialVariants = localData ? extractNameVariants([{ scraperName: 'local', data: localData }]) : [];

  return runScrapers(actorName, enabledScrapers, actorId, emitter, initialVariants);
}

/**
 * Scrape actor excluding 'local' scraper (used when forceOverwrite=true).
 * Still reads name variants from local/externalPath to help remote scrapers find the actor.
 */
async function scrapeActorExcludingLocal(actorName, emitter = null) {
  const config = loadConfig();
  if (!(config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled !== false)) {
    console.error('[ActorScraperManager] Actor scraping is disabled in config');
    return null;
  }

  const enabledScrapers = (config.scrapers?.actors?.scrapers || ['javdb']).filter(s => s !== 'local');
  console.log(`[ActorScraperManager] Scraping actor (excluding local): ${actorName}, scrapers: ${enabledScrapers.join(', ')}`);

  // Collect name variants from local/externalPath without using it as a scraper source
  const { scrapeLocal } = require('../../scrapers/actors/local/run');
  const localData = await scrapeLocal(actorName).catch(() => null);
  const actorId = (localData && localData.id) ? localData.id : normalizeActorName(actorName);
  const initialVariants = localData ? extractNameVariants([{ scraperName: 'local', data: localData }]) : [];
  if (initialVariants.length > 0) {
    console.log(`[ActorScraperManager] Name variants from local: ${initialVariants.join(', ')}`);
  }

  return runScrapers(actorName, enabledScrapers, actorId, emitter, initialVariants);
}

/**
 * Get actor data (from cache or scrape if needed)
 * Tries exact name first, then inverted name in cache
 *
 * @param {string} actorName - Actor name (any variant)
 * @param {boolean} forceOverwrite - If true, exclude 'local' scraper to force remote scraping
 * @returns {Promise<object|null>} - Actor data or null
 */
async function getActor(actorName, forceOverwrite = false) {
  // If forceOverwrite is true, skip local scraper and force remote scraping
  if (forceOverwrite) {
    console.log(`[ActorScraperManager] Force overwrite enabled, excluding 'local' scraper: ${actorName}`);
    return await scrapeActorExcludingLocal(actorName);
  }

  // Normal flow: scan local NFOs (externalPath first, then data/actors)
  const { scrapeLocal } = require('../../scrapers/actors/local/run');
  const localActor = await scrapeLocal(actorName).catch(() => null);

  if (localActor && !localActor.error) {
    if (isActorComplete(localActor)) {
      console.log(`[ActorScraperManager] Actor complete in local: ${localActor.id}`);
      return localActor;
    }
    // Incomplete — scrape online to fill missing fields
    console.log(`[ActorScraperManager] Actor incomplete in local, filling online: ${localActor.id}`);
    const scrapedActor = await scrapeActor(actorName);
    if (scrapedActor) {
      const mergedActor = mergeLocalWithScraped(localActor, scrapedActor);
      saveActorLocal(mergedActor);
      return mergedActor;
    }
    return localActor;
  }

  // Not found locally — scrape online
  console.log(`[ActorScraperManager] Actor not found locally, scraping: ${actorName}`);
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
      // Check if already in externalPath or cache and complete
      const { scrapeLocal } = require('../../scrapers/actors/local/run');
      const localData = await scrapeLocal(actorName).catch(() => null);
      if (localData && !localData.error && isActorComplete(localData)) {
        console.log(`[Actor Scrape] Actor found locally and complete: ${actorName}`);
        cached++;
        // Ensure it's saved to internal cache
        saveActorLocal(localData);
        if (emitter) {
          emitter.emit('progress', {
            message: `[local] ✓ ${actorName} - complete in library`
          });
        }
        continue;
      }

      // Use scrapeActor with emitter to get detailed progress messages
      const actorData = await scrapeActor(actorName, emitter);

      if (actorData) {
        scraped++;
        console.log(`[Actor Scrape] Successfully processed: ${actorName}`);
      } else {
        failed++;
        console.log(`[Actor Scrape] Failed to process: ${actorName}`);
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

          // Find actor via NFO scan (externalPath first, then data/actors)
          const { scrapeLocal } = require('../../scrapers/actors/local/run');
          const actorData = await scrapeLocal(actor.name).catch(() => null);
          if (!actorData || actorData.error) {
            console.error(`[ActorScraperManager] Actor not found locally: ${actor.name}`);
            continue;
          }

          // Update actor fields in movie JSON (only if not empty)
          if (actorData.altName) actor.altName = actorData.altName;
          if (actorData.birthdate) actor.birthdate = actorData.birthdate;
          if (actorData.height) actor.height = actorData.height;
          if (actorData.bust) actor.bust = actorData.bust;
          if (actorData.waist) actor.waist = actorData.waist;
          if (actorData.hips) actor.hips = actorData.hips;

          const thumbUrl = resolveActorThumb(actorData);
          if (thumbUrl) actor.thumb = thumbUrl;


          movieUpdated = true;
          console.log(`[ActorScraperManager] Updated actor in ${filename}: ${actor.name} -> ${actorId}`);
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
 * Process actors for a single movie file
 * Scrapes only the actors found in the specified movie JSON
 *
 * @param {string} movieId - Movie ID (filename without .json extension)
 * @param {EventEmitter} emitter - Optional event emitter for progress updates
 * @returns {Promise<object>} - Summary of processing results
 */
async function processSingleMovieActors(movieId, emitter = null) {
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

  console.log(`[ActorScraperManager] Processing actors for movie: ${movieId}`);

  const scrapePath = getScrapePath();
  const movieFile = path.join(scrapePath, `${movieId}.json`);

  if (!fs.existsSync(movieFile)) {
    console.error(`[ActorScraperManager] Movie file not found: ${movieFile}`);
    return {
      success: false,
      message: 'Movie file not found',
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  // Extract actors from this movie only
  const actorNames = new Set();

  try {
    const content = fs.readFileSync(movieFile, 'utf-8');
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
    console.error(`[ActorScraperManager] Failed to read movie file: ${error.message}`);
    return {
      success: false,
      message: error.message,
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  if (actorNames.size === 0) {
    console.log('[ActorScraperManager] No actors found in movie');
    return {
      success: true,
      message: 'No actors to scrape',
      total: 0,
      scraped: 0,
      cached: 0,
      failed: 0
    };
  }

  console.log(`[ActorScraperManager] Found ${actorNames.size} actor(s) in movie: ${Array.from(actorNames).join(', ')}`);

  if (emitter) {
    emitter.emit('progress', {
      message: `[Actor Scrape] Found ${actorNames.size} actor(s) to process`
    });
  }

  let scraped = 0;
  let cached = 0;
  let failed = 0;

  // Process each actor
  const actorNamesArray = Array.from(actorNames);
  for (let i = 0; i < actorNamesArray.length; i++) {
    const actorName = actorNamesArray[i];
    console.log(`[ActorScraperManager] Processing ${i + 1}/${actorNamesArray.length}: ${actorName}`);

    if (emitter) {
      emitter.emit('progress', {
        message: `[Actor Scrape] Processing ${i + 1}/${actorNamesArray.length}: ${actorName}`
      });
    }

    try {
      // Check if already in externalPath or cache and complete
      const { scrapeLocal } = require('../../scrapers/actors/local/run');
      const localData = await scrapeLocal(actorName).catch(() => null);
      if (localData && !localData.error && isActorComplete(localData)) {
        console.log(`[ActorScraperManager] Actor found locally and complete: ${actorName}`);
        cached++;
        saveActorLocal(localData);
        if (emitter) {
          emitter.emit('progress', {
            message: `[local] ✓ ${actorName} - complete in library`
          });
        }
        continue;
      }

      // Use scrapeActor with emitter to get detailed progress messages
      const actorData = await scrapeActor(actorName, emitter);

      if (actorData) {
        scraped++;
        console.log(`[ActorScraperManager] Successfully processed: ${actorName}`);
      } else {
        failed++;
        console.log(`[ActorScraperManager] Failed to process: ${actorName}`);
      }
    } catch (error) {
      failed++;
      console.error(`[ActorScraperManager] Error processing ${actorName}:`, error.message);

      if (emitter) {
        emitter.emit('progress', {
          message: `[Actor Scrape] ${actorName} - error: ${error.message}`
        });
      }
    }
  }

  // Update the single movie file with enriched actor data
  if (emitter) {
    emitter.emit('progress', {
      message: '[Actor Scrape] Updating movie file with actor data...'
    });
  }

  let movieUpdated = 0;
  try {
    const content = fs.readFileSync(movieFile, 'utf-8');
    const fileData = JSON.parse(content);

    // Handle wrapped format
    const hasWrapper = fileData.data && typeof fileData.data === 'object';
    const movieData = hasWrapper ? fileData.data : fileData;

    if (movieData.actor && Array.isArray(movieData.actor)) {
      let updated = false;

      for (const actor of movieData.actor) {
        if (!actor.name) continue;

          // Find actor via NFO scan (externalPath first, then data/actors)
          const { scrapeLocal } = require('../../scrapers/actors/local/run');
          const actorData = await scrapeLocal(actor.name).catch(() => null);
          if (!actorData || actorData.error) {
            console.error(`[ActorScraperManager] Actor not found locally: ${actor.name}`);
            continue;
          }

        // Update actor fields in movie JSON (only if not empty)
        if (actorData.altName) actor.altName = actorData.altName;
        if (actorData.birthdate) actor.birthdate = actorData.birthdate;
        if (actorData.height) actor.height = actorData.height;
        if (actorData.bust) actor.bust = actorData.bust;
        if (actorData.waist) actor.waist = actorData.waist;
        if (actorData.hips) actor.hips = actorData.hips;

        const thumbUrl = resolveActorThumb(actorData);
        if (thumbUrl) actor.thumb = thumbUrl;

        updated = true;
        console.log(`[ActorScraperManager] Updated actor in movie: ${actor.name}`);
      }

      // Save updated movie JSON (preserve wrapper if it exists)
      if (updated) {
        const dataToSave = hasWrapper ? fileData : movieData;
        fs.writeFileSync(movieFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
        movieUpdated = 1;
        console.log(`[ActorScraperManager] Updated movie: ${movieId}.json`);
      }
    }
  } catch (error) {
    console.error(`[ActorScraperManager] Failed to update movie file: ${error.message}`);
  }

  const summary = {
    success: true,
    message: 'Single movie actor processing completed',
    total: actorNamesArray.length,
    scraped: scraped,
    cached: cached,
    failed: failed,
    movieUpdated: movieUpdated
  };

  console.log('[ActorScraperManager] Single movie processing summary:', summary);
  return summary;
}

/**
 * Process actors for multiple specified movie files
 * Scrapes only the actors found in the specified movies
 *
 * @param {string[]} movieIds - Array of movie IDs (filenames without .json extension)
 * @param {EventEmitter} emitter - Optional event emitter for progress updates
 * @returns {Promise<object>} - Summary of processing results
 */
async function processMultipleMoviesActors(movieIds, emitter = null) {
  const config = loadConfig();

  // Check if actors feature is enabled
  const actorsEnabled = (config.scrapers && config.scrapers.actors && config.scrapers.actors.enabled !== false);

  if (!actorsEnabled) {
    console.error('[ActorScraperManager] Actor scraping is disabled in config');
    return {
      success: false,
      message: 'Actor scraping is disabled',
      scraping: { total: 0, scraped: 0, cached: 0, failed: 0 },
      updating: { total: 0, updated: 0, failed: 0 }
    };
  }

  console.log(`[ActorScraperManager] Processing actors for ${movieIds.length} movies: ${movieIds.join(', ')}`);

  const scrapePath = getScrapePath();
  const actorNames = new Set();

  // Extract actors from specified movies only
  for (const movieId of movieIds) {
    const movieFile = path.join(scrapePath, `${movieId}.json`);

    if (!fs.existsSync(movieFile)) {
      console.error(`[ActorScraperManager] Movie file not found: ${movieFile}`);
      continue;
    }

    try {
      const content = fs.readFileSync(movieFile, 'utf-8');
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
      console.error(`[ActorScraperManager] Failed to read movie file ${movieId}: ${error.message}`);
    }
  }

  if (actorNames.size === 0) {
    console.log('[ActorScraperManager] No actors found in specified movies');
    return {
      success: true,
      message: 'No actors to scrape',
      scraping: { total: 0, scraped: 0, cached: 0, failed: 0 },
      updating: { total: movieIds.length, updated: 0, failed: 0 }
    };
  }

  console.log(`[ActorScraperManager] Found ${actorNames.size} unique actor(s) in ${movieIds.length} movies`);

  if (emitter) {
    emitter.emit('progress', {
      message: `[Actor Scrape] Found ${actorNames.size} unique actor(s) to process`
    });
  }

  let scraped = 0;
  let cached = 0;
  let failed = 0;

  // Process each actor
  const actorNamesArray = Array.from(actorNames);
  for (let i = 0; i < actorNamesArray.length; i++) {
    const actorName = actorNamesArray[i];
    console.log(`[ActorScraperManager] Processing ${i + 1}/${actorNamesArray.length}: ${actorName}`);

    if (emitter) {
      emitter.emit('progress', {
        message: `[Actor Scrape] Processing ${i + 1}/${actorNamesArray.length}: ${actorName}`
      });
    }

    try {
      // Check if already in externalPath or cache and complete
      const { scrapeLocal } = require('../../scrapers/actors/local/run');
      const localData = await scrapeLocal(actorName).catch(() => null);
      if (localData && !localData.error && isActorComplete(localData)) {
        console.log(`[ActorScraperManager] Actor found locally and complete: ${actorName}`);
        cached++;
        saveActorLocal(localData);
        if (emitter) {
          emitter.emit('progress', {
            message: `[local] ✓ ${actorName} - complete in library`
          });
        }
        continue;
      }

      // Use scrapeActor with emitter to get detailed progress messages
      const actorData = await scrapeActor(actorName, emitter);

      if (actorData) {
        scraped++;
        console.log(`[ActorScraperManager] Successfully processed: ${actorName}`);
      } else {
        failed++;
        console.log(`[ActorScraperManager] Failed to process: ${actorName}`);
      }
    } catch (error) {
      failed++;
      console.error(`[ActorScraperManager] Error processing ${actorName}:`, error.message);

      if (emitter) {
        emitter.emit('progress', {
          message: `[Actor Scrape] ${actorName} - error: ${error.message}`
        });
      }
    }
  }

  // Update the specified movie files with enriched actor data
  if (emitter) {
    emitter.emit('progress', {
      message: '[Actor Scrape] Updating movie files with actor data...'
    });
  }

  let moviesUpdated = 0;
  let moviesFailed = 0;

  for (const movieId of movieIds) {
    const movieFile = path.join(scrapePath, `${movieId}.json`);

    if (!fs.existsSync(movieFile)) {
      moviesFailed++;
      continue;
    }

    try {
      const content = fs.readFileSync(movieFile, 'utf-8');
      const fileData = JSON.parse(content);

      // Handle wrapped format
      const hasWrapper = fileData.data && typeof fileData.data === 'object';
      const movieData = hasWrapper ? fileData.data : fileData;

      if (movieData.actor && Array.isArray(movieData.actor)) {
        let updated = false;

        for (const actor of movieData.actor) {
          if (!actor.name) continue;

          // Find actor via NFO scan (externalPath first, then data/actors)
          const { scrapeLocal } = require('../../scrapers/actors/local/run');
          const actorData = await scrapeLocal(actor.name).catch(() => null);
          if (!actorData || actorData.error) {
            console.error(`[ActorScraperManager] Actor not found locally: ${actor.name}`);
            continue;
          }

          // Update actor fields in movie JSON (only if not empty)
          if (actorData.altName) actor.altName = actorData.altName;
          if (actorData.birthdate) actor.birthdate = actorData.birthdate;
          if (actorData.height) actor.height = actorData.height;
          if (actorData.bust) actor.bust = actorData.bust;
          if (actorData.waist) actor.waist = actorData.waist;
          if (actorData.hips) actor.hips = actorData.hips;

          const thumbUrl = resolveActorThumb(actorData);
          if (thumbUrl) actor.thumb = thumbUrl;


          updated = true;
        }

        // Save updated movie JSON (preserve wrapper if it exists)
        if (updated) {
          const dataToSave = hasWrapper ? fileData : movieData;
          fs.writeFileSync(movieFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
          moviesUpdated++;
          console.log(`[ActorScraperManager] Updated movie: ${movieId}.json`);
        }
      }
    } catch (error) {
      console.error(`[ActorScraperManager] Failed to update movie file ${movieId}: ${error.message}`);
      moviesFailed++;
    }
  }

  if (emitter) {
    emitter.emit('progress', {
      message: `[Actor Scrape] Updated ${moviesUpdated} movie file(s)`
    });
  }

  const summary = {
    success: true,
    message: 'Multiple movies actor processing completed',
    scraping: {
      total: actorNamesArray.length,
      scraped: scraped,
      cached: cached,
      failed: failed
    },
    updating: {
      total: movieIds.length,
      updated: moviesUpdated,
      failed: moviesFailed
    }
  };

  console.log('[ActorScraperManager] Multiple movies processing summary:', summary);
  return summary;
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

/**
 * Scrape actors and enrich an in-memory actor array.
 * Used by edit-mode rescrape where there is no scrape JSON file on disk.
 *
 * @param {Array} actors - Actor array from the canonical model (modified in place)
 * @param {EventEmitter} emitter - Optional emitter for progress events
 * @returns {Promise<{scraped, cached, failed, total}>}
 */
async function enrichActorArray(actors, emitter = null) {
  const summary = { scraped: 0, cached: 0, failed: 0, total: 0 };

  if (!actors || !Array.isArray(actors) || actors.length === 0) {
    return summary;
  }

  const actorNames = actors.map(a => a.name).filter(Boolean);
  summary.total = actorNames.length;

  if (emitter) emitter.emit('progress', { message: `[Actor Scrape] Found ${actorNames.length} actor(s) to process` });

  // Phase 1: scrape/cache each actor
  for (let i = 0; i < actorNames.length; i++) {
    const actorName = actorNames[i];
    if (emitter) emitter.emit('progress', { message: `[Actor Scrape] Processing ${i + 1}/${actorNames.length}: ${actorName}` });

    try {
      const { scrapeLocal } = require('../../scrapers/actors/local/run');
      const localData = await scrapeLocal(actorName).catch(() => null);
      if (localData && !localData.error && isActorComplete(localData)) {
        summary.cached++;
        saveActorLocal(localData);
        if (emitter) emitter.emit('progress', { message: `[local] ✓ ${actorName} - complete in library` });
        continue;
      }
      const actorData = await scrapeActor(actorName, emitter);
      if (actorData) {
        summary.scraped++;
      } else {
        summary.failed++;
      }
    } catch (err) {
      summary.failed++;
      if (emitter) emitter.emit('progress', { message: `[Actor Scrape] ${actorName} - error: ${err.message}` });
    }
  }

  // Phase 2: enrich the in-memory actor array with scraped local data
  if (emitter) emitter.emit('progress', { message: '[Actor Scrape] Enriching actor data...' });

  for (const actor of actors) {
    if (!actor.name) continue;
    try {
      const { scrapeLocal } = require('../../scrapers/actors/local/run');
      const localData = await scrapeLocal(actor.name).catch(() => null);
      if (!localData || localData.error) continue;

      if (localData.altName) actor.altName = localData.altName;
      if (localData.birthdate) actor.birthdate = localData.birthdate;
      if (localData.height) actor.height = localData.height;
      if (localData.bust) actor.bust = localData.bust;
      if (localData.waist) actor.waist = localData.waist;
      if (localData.hips) actor.hips = localData.hips;

      const thumbUrl = resolveActorThumb(localData);
      if (thumbUrl) actor.thumb = thumbUrl;
    } catch (err) {
      console.error(`[ActorScraperManager] enrichActorArray failed for ${actor.name}: ${err.message}`);
    }
  }

  return summary;
}

module.exports = {
  scrapeActor,
  getActor,
  saveActorLocal,
  batchScrapeActors,
  updateMovieActorData,
  batchProcessActors,
  processSingleMovieActors,
  processMultipleMoviesActors,
  enrichActorArray
};
