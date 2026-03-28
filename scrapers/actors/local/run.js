#!/usr/bin/env node

/**
 * Local Actor Scraper
 *
 * Reads ONLY from externalPath (user-curated library).
 * Searches by: index, normalized name, name/altName fields (including comma-separated altnames).
 * Returns null if not found (passes to next scraper).
 */

const fs = require('fs');
const path = require('path');
const { removeEmptyFields, normalizeActorName, nfoToActor } = require('../schema');
const { getExternalActorsPath } = require('../cache-helper');

function invertName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

function loadDirIndex(dirPath) {
  for (const name of ['actors-index.json', '.index.json']) {
    const p = path.join(dirPath, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
    }
  }
  return {};
}

/**
 * Check if actorName matches any of the names in the NFO (name + all altnames).
 */
function matchesActor(actor, actorName) {
  const needle = actorName.toLowerCase().trim();
  const candidates = [actor.name, invertName(actorName)];

  if (actor.altName) {
    const altNames = actor.altName.split(',').map(s => s.trim()).filter(Boolean);
    candidates.push(...altNames);
  }
  if (actor.otherNames && Array.isArray(actor.otherNames)) {
    candidates.push(...actor.otherNames);
  }

  return candidates.some(c => c && c.toLowerCase().trim() === needle);
}

async function scrapeLocal(actorName) {
  const externalPath = getExternalActorsPath();

  if (!externalPath || !fs.existsSync(externalPath)) {
    console.error('[local] No externalPath configured, skipping');
    return null;
  }

  console.error(`[local] Searching for: ${actorName}`);

  const namesToTry = [actorName];
  const inverted = invertName(actorName);
  if (inverted !== actorName) namesToTry.push(inverted);

  // 1. Try index lookup
  const index = loadDirIndex(externalPath);
  for (const name of namesToTry) {
    const id = index[name.toLowerCase()];
    if (!id) continue;
    const nfoPath = path.join(externalPath, `${id}.nfo`);
    if (!fs.existsSync(nfoPath)) continue;
    try {
      const actor = nfoToActor(fs.readFileSync(nfoPath, 'utf-8'));
      // Use ID from NFO if present, otherwise use filename-derived ID
      actor.id = actor.id || id;
      if (actor.thumbLocal && fs.existsSync(path.join(externalPath, actor.thumbLocal))) {
        actor.thumb = `/actors/${actor.thumbLocal}`;
      }
      console.error(`[local] Found via index: ${actor.id}`);
      return removeEmptyFields(actor);
    } catch (_) {}
  }

  // 2. Scan all NFOs — match name, inverted name, or any altname
  const files = fs.readdirSync(externalPath).filter(f => f.endsWith('.nfo'));
  for (const file of files) {
    try {
      const actor = nfoToActor(fs.readFileSync(path.join(externalPath, file), 'utf-8'));
      // Use ID from NFO if present, otherwise use filename-derived ID
      if (!actor.id) actor.id = file.replace('.nfo', '');

      if (!matchesActor(actor, actorName)) continue;

      if (actor.thumbLocal && fs.existsSync(path.join(externalPath, actor.thumbLocal))) {
        actor.thumb = `/actors/${actor.thumbLocal}`;
      }
      console.error(`[local] Found via full scan: ${actor.id}`);
      return removeEmptyFields(actor);
    } catch (_) {}
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

module.exports = { scrapeLocal, scrapeActors };
