#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Looks up actors purely from the persistent index (actorDb) — no NFO
 * directory scanning. The index is fed by every save/scrape/upload path
 * (see actorScraperManager.js, src/server/routes.js), so a name only needs
 * to be seen once (locally or online) to be found instantly afterwards.
 * A fresh install with pre-existing NFOs on disk can seed the index in one
 * shot via bin/build-actor-index.js.
 * Returns null if not indexed (passes to the next scraper).
 */

const { removeEmptyFields, normalizeActorName } = require('../schema');
const { getActorsCachePath } = require('../cache-helper');
const actorDb = require('../actorDb');

async function scrapeLocal(actorName) {
  console.error(`[local] Searching for: ${actorName}`);

  const dbActor = actorDb.findActorByName(actorName);
  if (!dbActor) {
    console.error(`[local] ✗ Not found: ${actorName}`);
    return null;
  }

  // Self-heal a stale cache photo pointer as we go (cache is the single
  // source of truth for the scraper — see resolvePhotoSource()).
  actorDb.resolvePhotoSource(dbActor.id, { cachePath: getActorsCachePath() });

  const healed = actorDb.getActor(dbActor.id);
  console.error(`[local] Found in index: ${healed.id}`);
  return removeEmptyFields(healed);
}

async function scrapeActors(names) {
  const results = [];
  for (const name of names) {
    try {
      const actor = await scrapeLocal(name);
      results.push(actor || { id: normalizeActorName(name), name, error: 'Not found' });
    } catch (error) {
      results.push({ id: normalizeActorName(name), name, error: error.message });
    }
  }
  return results;
}

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('[local] Usage: node run.js <NAME> [NAME2] ...');
    process.exit(1);
  }
  try {
    const results = await scrapeActors(names);
    console.log(JSON.stringify(results, null, 2));
    setTimeout(() => process.exit(results.some(r => r.error) ? 1 : 0), 100);
  } catch (error) {
    console.error('[local] Critical error:', error.message);
    console.log(JSON.stringify(names.map(name => ({ id: normalizeActorName(name), name, error: error.message }))));
    setTimeout(() => process.exit(1), 100);
  }
}

if (require.main === module) main();

module.exports = { scrapeLocal, scrapeActors };
