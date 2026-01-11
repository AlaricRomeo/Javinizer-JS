#!/usr/bin/env node

/**
 * Rebuild actors-index.json from all .nfo files in cache
 *
 * This script scans all .nfo files in the actors cache directory
 * and rebuilds the actors-index.json with all name variants.
 */

const fs = require('fs');
const path = require('path');
const { getActorsCachePath } = require('../scrapers/actors/cache-helper');
const { nfoToActor } = require('../scrapers/actors/schema');

function rebuildIndex() {
  const actorsPath = getActorsCachePath();
  const indexPath = path.join(actorsPath, 'actors-index.json');

  console.log(`[RebuildIndex] Scanning actors in: ${actorsPath}`);

  if (!fs.existsSync(actorsPath)) {
    console.error('[RebuildIndex] Actors cache path does not exist');
    process.exit(1);
  }

  const index = {};
  let scanned = 0;
  let indexed = 0;

  // Read all .nfo files
  const files = fs.readdirSync(actorsPath);

  for (const filename of files) {
    if (!filename.endsWith('.nfo')) continue;

    scanned++;
    const nfoPath = path.join(actorsPath, filename);

    try {
      const nfoContent = fs.readFileSync(nfoPath, 'utf-8');
      const actor = nfoToActor(nfoContent);

      // Extract ID from filename
      const actorId = filename.replace('.nfo', '');
      actor.id = actorId;

      // Add main name
      if (actor.name) {
        index[actor.name.toLowerCase()] = actorId;
      }

      // Add alternative name
      if (actor.altName) {
        index[actor.altName.toLowerCase()] = actorId;
      }

      // Add other names
      if (actor.otherNames && Array.isArray(actor.otherNames)) {
        actor.otherNames.forEach(name => {
          if (name) {
            index[name.toLowerCase()] = actorId;
          }
        });
      }

      indexed++;
      console.log(`[RebuildIndex] Indexed: ${actorId} (${actor.name})`);

    } catch (error) {
      console.error(`[RebuildIndex] Failed to parse ${filename}:`, error.message);
    }
  }

  // Save index
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    console.log(`[RebuildIndex] Index rebuilt successfully`);
    console.log(`[RebuildIndex] Scanned: ${scanned} files`);
    console.log(`[RebuildIndex] Indexed: ${indexed} actors`);
    console.log(`[RebuildIndex] Index entries: ${Object.keys(index).length}`);
  } catch (error) {
    console.error('[RebuildIndex] Failed to save index:', error.message);
    process.exit(1);
  }
}

rebuildIndex();
