#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Scans .nfo files in externalPath (user-curated library), then data/actors cache,
 * then (if "Copy actors to movie folder" is enabled) each library movie folder's
 * actors/ subfolder, as a last resort.
 * Matches against <name> and <altname> fields (both name orders: "A B" and "B A").
 * Returns null if not found (passes to next scraper).
 */

const fs = require('fs');
const path = require('path');
const { removeEmptyFields, normalizeActorName, nfoToActor } = require('../schema');
const { getExternalActorsPath, getActorsCachePath, findLocalPhoto, loadConfig } = require('../cache-helper');

const _cachePath = getActorsCachePath();

function invertName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

/**
 * Match tiers, in priority order:
 *   1 = primary name
 *   2 = alternate name (altName may hold multiple comma-separated candidates)
 *   3 = other names (typically Japanese-script variants recorded by scrapers)
 * Each candidate is tried both as-is and name-inverted ("Firstname Lastname" /
 * "Lastname Firstname").
 */
function matchTier(actor, actorName) {
  const needle = actorName.toLowerCase().trim();
  const needleInverted = invertName(actorName).toLowerCase().trim();

  const isMatch = (name) => {
    const n = name.toLowerCase().trim();
    if (n === needle || n === needleInverted) return true;
    const nInverted = invertName(name).toLowerCase().trim();
    return nInverted === needle || nInverted === needleInverted;
  };

  if (actor.name && isMatch(actor.name)) return 1;

  if (actor.altName) {
    const altNames = actor.altName.split(',').map(s => s.trim()).filter(Boolean);
    if (altNames.some(isMatch)) return 2;
  }

  if (actor.otherNames && Array.isArray(actor.otherNames) && actor.otherNames.some(n => n && isMatch(n))) {
    return 3;
  }

  return 0;
}

/**
 * Resolve/self-heal thumbLocal against what's actually on disk, mutating actor in place.
 */
function resolveThumbLocal(actor, dirPath) {
  if (!actor.thumbLocal) return;

  const inCache = fs.existsSync(path.join(_cachePath, actor.thumbLocal));
  // Also check in the directory being scanned (may be externalPath)
  const inDir = dirPath !== _cachePath && fs.existsSync(path.join(dirPath, actor.thumbLocal));

  if (!inCache && inDir) {
    // Photo exists in externalPath but not in cache — copy to cache
    try {
      if (!fs.existsSync(_cachePath)) fs.mkdirSync(_cachePath, { recursive: true });
      fs.copyFileSync(path.join(dirPath, actor.thumbLocal), path.join(_cachePath, actor.thumbLocal));
    } catch (_) {}
  } else if (!inCache && !inDir) {
    // Named file missing (e.g. extension changed after a re-upload) —
    // before giving up on the local photo, check if a file for this
    // actor id exists under a different extension.
    const found = findLocalPhoto(dirPath, actor.id) || findLocalPhoto(_cachePath, actor.id);
    if (found) {
      actor.thumbLocal = found;
      if (!fs.existsSync(path.join(_cachePath, found))) {
        try {
          if (!fs.existsSync(_cachePath)) fs.mkdirSync(_cachePath, { recursive: true });
          fs.copyFileSync(path.join(dirPath, found), path.join(_cachePath, found));
        } catch (_) {}
      }
    } else {
      // Truly not found anywhere — fall back to remote URL
      actor.thumbLocal = '';
      actor.thumb = actor.thumbUrl || '';
    }
  }
  // thumb stays as remote URL (or empty); /actors/{id}.ext is resolved by the web UI
}

/**
 * Scan all .nfo files in dirPath and return the best-priority matching actor, or null.
 * Priority (see matchTier) is enforced across the whole directory, not just
 * first-file-found, so a name match always wins over an altName/otherNames
 * match regardless of filesystem scan order.
 */
function searchInDirectory(dirPath, actorName) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.nfo'));

  let best = null; // { actor, tier }

  for (const file of files) {
    try {
      const actor = nfoToActor(fs.readFileSync(path.join(dirPath, file), 'utf-8'));
      if (!actor.id) actor.id = file.replace('.nfo', '');

      const tier = matchTier(actor, actorName);
      if (tier === 0) continue;

      if (tier === 1) { best = { actor, tier }; break; } // top priority, no need to keep scanning
      if (!best || tier < best.tier) best = { actor, tier };
    } catch (_) {}
  }

  if (!best) return null;

  const { actor, tier } = best;
  resolveThumbLocal(actor, dirPath);

  console.error(`[local] Found in ${path.basename(dirPath)}: ${actor.id} (tier ${tier})`);
  return removeEmptyFields(actor);
}

/**
 * Search each library movie folder's actors/ subfolder for a matching actor .nfo.
 * Only runs when "Copy actors to movie folder" is enabled, since that's the only
 * feature that populates those subfolders. Only invoked as a last-resort fallback
 * (externalPath and cache already missed), so the per-folder scan cost is not paid
 * on the common path.
 */
function searchLibraryActorFolders(actorName) {
  let config;
  try {
    config = loadConfig();
  } catch (_) {
    return null;
  }

  if (!(config.scrapers && config.scrapers.actors && config.scrapers.actors.copyToMovieFolder)) return null;

  const libraryPath = config.libraryPath;
  if (!libraryPath || !fs.existsSync(libraryPath)) return null;

  let entries;
  try {
    entries = fs.readdirSync(libraryPath, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const actorsDir = path.join(libraryPath, entry.name, 'actors');
    if (!fs.existsSync(actorsDir)) continue;
    const actor = searchInDirectory(actorsDir, actorName);
    if (actor) return actor;
  }

  return null;
}

async function scrapeLocal(actorName, options = {}) {
  const { includeLibraryFallback = true } = options;
  console.error(`[local] Searching for: ${actorName}`);

  const externalPath = getExternalActorsPath();
  const cachePath = getActorsCachePath();

  // 1. Search externalPath first
  if (externalPath && fs.existsSync(externalPath)) {
    const actor = searchInDirectory(externalPath, actorName);
    if (actor) return actor;
  } else {
    console.error('[local] No externalPath configured, skipping external search');
  }

  // 2. Fallback to internal cache
  if (fs.existsSync(cachePath)) {
    const actor = searchInDirectory(cachePath, actorName);
    if (actor) return actor;
  }

  // 3. Fallback to library movie folders' actors/ subfolder (only if "Copy actors
  // to movie folder" is enabled — that's what populates those subfolders).
  // Skipped when scrapeLocal is only used to preload name variants ahead of a
  // forced remote re-scrape (forceOverwrite): copying a possibly stale photo
  // back into the cache there would fight the user's "get fresh data" intent.
  if (!includeLibraryFallback) {
    console.error(`[local] ✗ Not found: ${actorName}`);
    return null;
  }
  const libraryActor = searchLibraryActorFolders(actorName);
  if (libraryActor) {
    console.error(`[local] Found in library actors folder`);
    return libraryActor;
  }

  console.error(`[local] ✗ Not found: ${actorName}`);
  return null;
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

module.exports = { scrapeLocal, scrapeActors, searchInDirectory };
