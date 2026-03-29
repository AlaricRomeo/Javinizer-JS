#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Scans .nfo files in externalPath (user-curated library) then data/actors cache.
 * Matches against <name> and <altname> fields (both name orders: "A B" and "B A").
 * Returns null if not found (passes to next scraper).
 */

const fs = require('fs');
const path = require('path');
const { removeEmptyFields, normalizeActorName, nfoToActor } = require('../schema');
const { getExternalActorsPath, getActorsCachePath } = require('../cache-helper');

function invertName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

/**
 * Check if actorName matches any of the names in the NFO (name + all altnames),
 * trying both "Firstname Lastname" and "Lastname Firstname" for each candidate.
 */
function matchesActor(actor, actorName) {
  const needle = actorName.toLowerCase().trim();
  const needleInverted = invertName(actorName).toLowerCase();

  const namesToCheck = [];

  if (actor.name) {
    namesToCheck.push(actor.name.toLowerCase().trim());
    namesToCheck.push(invertName(actor.name).toLowerCase().trim());
  }

  if (actor.altName) {
    for (const alt of actor.altName.split(',').map(s => s.trim()).filter(Boolean)) {
      namesToCheck.push(alt.toLowerCase());
      namesToCheck.push(invertName(alt).toLowerCase());
    }
  }

  if (actor.otherNames && Array.isArray(actor.otherNames)) {
    for (const n of actor.otherNames) {
      namesToCheck.push(n.toLowerCase());
      namesToCheck.push(invertName(n).toLowerCase());
    }
  }

  return namesToCheck.some(c => c === needle || c === needleInverted);
}

/**
 * Scan all .nfo files in dirPath and return the first matching actor, or null.
 */
function searchInDirectory(dirPath, actorName) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.nfo'));
  for (const file of files) {
    try {
      const actor = nfoToActor(fs.readFileSync(path.join(dirPath, file), 'utf-8'));
      if (!actor.id) actor.id = file.replace('.nfo', '');
      if (!matchesActor(actor, actorName)) continue;
      if (actor.thumbLocal && fs.existsSync(path.join(dirPath, actor.thumbLocal))) {
        actor.thumb = `/actors/${actor.thumbLocal}`;
      }
      console.error(`[local] Found in ${path.basename(dirPath)}: ${actor.id}`);
      return removeEmptyFields(actor);
    } catch (_) {}
  }
  return null;
}

async function scrapeLocal(actorName) {
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
