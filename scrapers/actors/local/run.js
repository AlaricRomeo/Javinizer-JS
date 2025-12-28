#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Reads actor data from local filesystem (data/actors/{id}/actor.json)
 * This is the cache layer that provides fast lookups for previously scraped actors
 */

const fs = require('fs');
const path = require('path');
const { createEmptyActor, removeEmptyFields, normalizeActorName, nfoToActor } = require('../schema');

/**
 * Load config.json
 */
function loadConfig() {
  const configPath = path.join(__dirname, '../../../config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }

  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * Get actors directory path
 */
function getActorsPath() {
  const config = loadConfig();

  // If actorsPath is null or not set, use default ./data/actors
  if (!config.actorsPath) {
    return path.join(__dirname, '../../../data/actors');
  }

  return config.actorsPath;
}

/**
 * Resolve actor name to ID using index
 */
function resolveActorId(actorName) {
  const actorsPath = getActorsPath();
  const indexPath = path.join(actorsPath, '.index.json');

  if (!fs.existsSync(indexPath)) {
    return null;
  }

  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return index[actorName.toLowerCase()] || null;
  } catch (error) {
    console.error('[Local] Failed to load index:', error.message);
    return null;
  }
}

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
 * Try to find actor with given name or ID
 */
function tryFindActor(actorId, actorsPath) {
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
    console.error(`[Local] Failed to read actor NFO file:`, error.message);
    return null;
  }
}

/**
 * Scrape actor from local storage (.nfo format)
 */
async function scrapeLocal(actorName) {
  console.error(`[Local] Searching for actor: ${actorName}`);

  const actorsPath = getActorsPath();

  // Strategy 1: Try to resolve actor ID from index
  let actorId = resolveActorId(actorName);

  if (actorId) {
    console.error(`[Local] Found in index: ${actorId}`);
    const actor = tryFindActor(actorId, actorsPath);
    if (actor) {
      console.error(`[Local] Found actor: ${actor.name}`);
      return removeEmptyFields(actor);
    }
  }

  // Strategy 2: Try normalized name
  actorId = normalizeActorName(actorName);
  console.error(`[Local] Trying normalized ID: ${actorId}`);
  let actor = tryFindActor(actorId, actorsPath);

  if (actor) {
    console.error(`[Local] Found actor: ${actor.name}`);
    return removeEmptyFields(actor);
  }

  // Strategy 3: Try inverted name
  const invertedName = invertName(actorName);
  if (invertedName !== actorName) {
    console.error(`[Local] Trying inverted name: ${invertedName}`);
    const invertedId = normalizeActorName(invertedName);
    actor = tryFindActor(invertedId, actorsPath);

    if (actor) {
      console.error(`[Local] Found actor with inverted name: ${actor.name}`);
      return removeEmptyFields(actor);
    }
  }

  console.error(`[Local] Actor not found in cache`);
  return null;
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('[Local] Usage: node run.js <actor_name>');
    process.exit(1);
  }

  const actorName = args[0];

  try {
    const result = await scrapeLocal(actorName);

    if (result) {
      // Output JSON to stdout
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Return empty result (no error, just not found)
      console.log(JSON.stringify(null));
    }

    process.exit(0);
  } catch (error) {
    console.error('[Local] Error:', error.message);
    console.log(JSON.stringify(null));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { scrapeLocal };
