#!/usr/bin/env node

/**
 * CLI Tool: Batch Actor Processing
 *
 * This script:
 * 1. Extracts all actor names from scraped movie JSON files (data/scrape/*.json)
 * 2. Scrapes each actor using configured scrapers
 * 3. Saves actor data to cache as .nfo files
 * 4. Updates all movie JSON files with enriched actor data
 *
 * Usage:
 *   node bin/batch-actors.js
 *
 * Note: This should be run AFTER movie scraping is complete
 */

const { batchProcessActors } = require('../src/core/actorScraperManager');

async function main() {
  console.error('========================================');
  console.error('  Batch Actor Processing');
  console.error('========================================');
  console.error('');

  try {
    const summary = await batchProcessActors();

    console.error('');
    console.error('========================================');
    console.error('  Summary');
    console.error('========================================');
    console.error('');

    // Scraping summary
    console.error('Scraping Results:');
    console.error(`  Total actors: ${summary.scraping.total}`);
    console.error(`  Scraped: ${summary.scraping.scraped}`);
    console.error(`  Cached (already exists): ${summary.scraping.cached}`);
    console.error(`  Failed: ${summary.scraping.failed}`);
    console.error('');

    // Update summary
    console.error('Movie Update Results:');
    console.error(`  Total movies: ${summary.updating.total}`);
    console.error(`  Updated: ${summary.updating.updated}`);
    console.error(`  Failed: ${summary.updating.failed}`);
    console.error('');

    if (summary.success) {
      console.error('✅ Batch processing completed successfully!');
      process.exit(0);
    } else {
      console.error('⚠️  Batch processing completed with errors');
      process.exit(1);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
