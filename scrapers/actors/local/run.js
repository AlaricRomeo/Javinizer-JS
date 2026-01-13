#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Reads actor data from local cache (externalPath or internal cache)
 * This scraper only reads from local storage, never from remote sources.
 *
 * Use Case:
 * - Put "local" first in scrapers list to prioritize cached data
 * - Remove "local" from list when "Force Overwrite" is enabled
 *
 * Extracts:
 * - All actor data from .nfo files in cache directory
 */

const fs = require('fs');
const path = require('path');
const { createEmptyActor, removeEmptyFields, normalizeActorName } = require('../schema');
const { loadFromCache, getActorsCachePath } = require('../cache-helper');

/**
 * Invert name parts (e.g., "Mao Hamasaki" → "Hamasaki Mao")
 */
function invertName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name;
}

/**
 * Scrape actor from local cache only
 * @param {string} actorName - Actor name to search
 * @returns {Promise<object|null>} - Actor data or null if not found
 */
async function scrapeLocal(actorName) {
  console.error(`[local] Searching in cache for: ${actorName}`);

  try {
    // Try with original name
    let cachedActor = loadFromCache(actorName);

    // If not found, try with inverted name
    if (!cachedActor) {
      const invertedName = invertName(actorName);
      if (invertedName !== actorName) {
        console.error(`[local] Trying inverted name: ${invertedName}`);
        cachedActor = loadFromCache(invertedName);
      }
    }

    if (cachedActor) {
      console.error(`[local] Found actor in cache: ${cachedActor.id}`);

      // Ensure local photo path is set correctly
      const actorsPath = getActorsCachePath();
      if (cachedActor.thumbLocal) {
        const photoPath = path.join(actorsPath, cachedActor.thumbLocal);
        if (fs.existsSync(photoPath)) {
          cachedActor.thumb = `/actors/${cachedActor.thumbLocal}`;
          console.error(`[local] Photo found: ${cachedActor.thumbLocal}`);
        }
      }

      return removeEmptyFields(cachedActor);
    }

    console.error('[local] Actor not found in cache');
    return null;

  } catch (error) {
    console.error('[local] Error:', error.message);
    return null;
  }
}

/**
 * Scrape multiple actors from local cache (batch processing)
 */
async function scrapeActors(names) {
  const results = [];

  console.error(`[local] Processing ${names.length} actor(s) from cache...`);

  for (const name of names) {
    try {
      const actor = await scrapeLocal(name);

      if (actor) {
        results.push(actor);
      } else {
        // Actor not found in cache
        results.push({
          id: normalizeActorName(name),
          name,
          error: 'Not found'
        });
      }
    } catch (error) {
      console.error(`[local] Error processing ${name}:`, error.message);
      results.push({
        id: normalizeActorName(name),
        name,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Main entry point
 */
async function main() {
  const names = process.argv.slice(2);

  if (names.length === 0) {
    console.error('[local] Usage: node run.js <NAME> [NAME2] [NAME3] ...');
    console.error('[local] Example: node run.js "Hayami Remu"');
    console.error('[local] Example: node run.js "Hayami Remu" "Sunohara Miki"');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

    // Check for errors
    const hasErrors = results.some(r => r.error);

    // Local scraper is fast, minimal timeout
    setTimeout(() => {
      process.exit(hasErrors ? 1 : 0);
    }, 100);

  } catch (error) {
    console.error('[local] Critical error:', error.message);

    // Return minimal array with error markers
    const errorResults = names.map(name => ({
      id: normalizeActorName(name),
      name,
      error: error.message
    }));
    console.log(JSON.stringify(errorResults, null, 2));

    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { scrapeLocal, scrapeActors };
