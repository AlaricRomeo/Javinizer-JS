#!/usr/bin/env node

/**
 * Rebuild actors-index.json from all .nfo files in cache
 *
 * This script uses the centralized rebuildIndex function from actorIndexManager
 */

const { rebuildIndex } = require('../src/core/actorIndexManager');

const result = rebuildIndex();

if (!result.success) {
  console.error(`[RebuildIndex] Failed: ${result.error}`);
  process.exit(1);
}

console.log('[RebuildIndex] Index rebuilt successfully');
console.log(`[RebuildIndex] Processed: ${result.processed} actors`);
console.log(`[RebuildIndex] Failed: ${result.failed} files`);
console.log(`[RebuildIndex] Total entries: ${result.totalEntries}`);
console.log(`[RebuildIndex] Unique actors: ${result.uniqueActors}`);
