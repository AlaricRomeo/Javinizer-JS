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
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('[local] Usage: node run.js <actor_name>');
    process.exit(1);
  }

  const actorName = args[0];

  try {
    const actor = await scrapeLocal(actorName);

    if (actor) {
      console.log(JSON.stringify(actor, null, 2));
      process.exit(0);
    } else {
      console.log(JSON.stringify(null));
      process.exit(0);
    }

  } catch (error) {
    console.error('[local] Error:', error.message);
    console.log(JSON.stringify(null));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { scrapeLocal };
