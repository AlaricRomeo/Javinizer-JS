#!/usr/bin/env node

/**
 * Build Actor Index (one-time backfill)
 *
 * Walks externalPath (preferiti) and data/actors/ (internal cache), upserting
 * each .nfo found into the persistent actor index (data/actors-index.db) —
 * including which of the two had a photo file, so photo-priority resolution
 * has real data to work with immediately instead of warming up organically.
 * Also walks every library movie folder's actors/ subfolder to record which
 * movies each actor appears in (actor_movies) — those photos are not used
 * as a resolution source (see resolvePhotoSource()), only their presence
 * as an "appears in" signal.
 *
 * Safe to re-run: every write is an upsert.
 *
 * Usage: node bin/build-actor-index.js
 */

const fs = require('fs');
const path = require('path');
const { nfoToActor } = require('../scrapers/actors/schema');
const { getExternalActorsPath, getActorsCachePath, findLocalPhoto, loadConfig } = require('../scrapers/actors/cache-helper');
const actorDb = require('../scrapers/actors/actorDb');

function indexDirectory(dirPath, { onPhoto, onActor } = {}) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;

  let count = 0;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.nfo'));

  for (const file of files) {
    try {
      const actor = nfoToActor(fs.readFileSync(path.join(dirPath, file), 'utf-8'));
      if (!actor.id) actor.id = file.replace('.nfo', '');
      if (!actor.name) continue;

      actorDb.upsertActor(actor, { source: 'backfill' });
      if (onActor) onActor(actor.id);

      const photo = findLocalPhoto(dirPath, actor.id);
      if (photo && onPhoto) onPhoto(actor.id, photo);

      count++;
    } catch (err) {
      console.error(`  ⚠️  Failed to index ${file}: ${err.message}`);
    }
  }

  return count;
}

function main() {
  console.log('🗂️  Building actor index...');
  console.log('='.repeat(60));

  const externalPath = getExternalActorsPath();
  const cachePath = getActorsCachePath();

  console.log(`\n📁 externalPath (preferiti): ${externalPath || '(not configured)'}`);
  const externalCount = indexDirectory(externalPath, {
    onPhoto: (id, photo) => actorDb.touchExternalFile(id, photo)
  });
  console.log(`   Indexed ${externalCount} actor(s)`);

  console.log(`\n📁 internal cache: ${cachePath}`);
  const cacheCount = indexDirectory(cachePath, {
    onPhoto: (id, photo) => actorDb.touchCacheFile(id, photo)
  });
  console.log(`   Indexed ${cacheCount} actor(s)`);

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`\n⚠️  Could not load config.json, skipping library folder scan: ${err.message}`);
    config = {};
  }

  const libraryPath = config.libraryPath;
  let movieFoldersScanned = 0;
  let movieActorsIndexed = 0;

  if (libraryPath && fs.existsSync(libraryPath)) {
    console.log(`\n📁 library movie folders: ${libraryPath}`);
    const entries = fs.readdirSync(libraryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const actorsDir = path.join(libraryPath, entry.name, 'actors');
      if (!fs.existsSync(actorsDir)) continue;

      movieFoldersScanned++;
      const movieId = entry.name;
      movieActorsIndexed += indexDirectory(actorsDir, {
        onActor: (id) => actorDb.linkMovie(id, movieId)
      });
    }
    console.log(`   Scanned ${movieFoldersScanned} movie folder(s), indexed ${movieActorsIndexed} actor record(s)`);
  } else {
    console.log('\n📁 library movie folders: (libraryPath not configured or missing)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ Done.');
  console.log('='.repeat(60));
}

main();
