#!/usr/bin/env node

/**
 * Build Actor Index (one-time backfill)
 *
 * Walks externalPath (preferiti) and data/actors/ (internal cache), upserting
 * each .nfo found into the persistent actor index (data/actors-index.db) —
 * including which of the two had a photo file, so photo-priority resolution
 * has real data to work with immediately instead of warming up organically.
 * Also walks every library movie folder's .actors/ subfolder to record which
 * movies each actor appears in (actor_movies). Those actor NFOs are stale
 * snapshots taken when they were copied (old ids, old names), so they are
 * NEVER upserted: each one is only matched by name to an already indexed
 * actor and linked — upserting them recreated merged-away actors and
 * auto-merged real ones into them (setPrimaryName -> mergeActors).
 *
 * Meant for a first backfill: re-running it on a curated index re-upserts
 * every NFO in externalPath/data/actors, including leftovers of past merges.
 * To refresh movie links only, use bin/rebuild-actor-movies.js.
 *
 * Usage: node bin/build-actor-index.js
 */

const fs = require('fs');
const path = require('path');
const { nfoToActor } = require('../scrapers/actors/schema');
const { getExternalActorsPath, getActorsCachePath, findLocalPhoto, loadConfig } = require('../scrapers/actors/cache-helper');
const { getLibraryPaths } = require('../src/core/config');
const actorDb = require('../scrapers/actors/actorDb');
const { ACTORS_DIR } = require('../src/core/kodiActors');

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

  const libraryPaths = getLibraryPaths(config).filter(root => fs.existsSync(root));
  let movieFoldersScanned = 0;
  let movieActorsIndexed = 0;

  if (libraryPaths.length > 0) {
    for (const libraryPath of libraryPaths) {
      console.log(`\n📁 library movie folders: ${libraryPath}`);
      const entries = fs.readdirSync(libraryPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const actorsDir = path.join(libraryPath, entry.name, ACTORS_DIR);
        if (!fs.existsSync(actorsDir)) continue;

        movieFoldersScanned++;
        const movieId = path.join(libraryPath, entry.name); // = LibraryReader item id
        for (const file of fs.readdirSync(actorsDir).filter(f => f.endsWith('.nfo'))) {
          try {
            const { name } = nfoToActor(fs.readFileSync(path.join(actorsDir, file), 'utf-8'));
            const known = name && actorDb.findActorByName(name);
            if (!known) continue;
            actorDb.linkMovie(known.id, movieId);
            movieActorsIndexed++;
          } catch (err) {
            console.error(`  ⚠️  Failed to read ${path.join(actorsDir, file)}: ${err.message}`);
          }
        }
      }
    }
    console.log(`   Scanned ${movieFoldersScanned} movie folder(s), linked ${movieActorsIndexed} known actor(s)`);
  } else {
    console.log('\n📁 library movie folders: (libraryPaths not configured or missing)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ Done.');
  console.log('='.repeat(60));
}

main();
