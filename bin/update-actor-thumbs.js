#!/usr/bin/env node

/**
 * Update Actor Thumbs in Movie JSONs
 *
 * This script updates all movie JSON files in data/scrape/ with corrected
 * actor thumb URLs using the resolveActorThumb() logic.
 *
 * Run this after implementing the new thumb resolution system to fix
 * existing movie files.
 */

const fs = require('fs');
const path = require('path');
const {
  loadActorLocal,
  resolveActorId
} = require('../src/core/actorScraperManager');

// Get scrape path
function getScrapePath() {
  return path.join(__dirname, '../data/scrape');
}

// Load config
function loadConfig() {
  const configPath = path.join(__dirname, '../config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// Resolve actor thumb URL (same logic as actorScraperManager.js)
function resolveActorThumb(actorData) {
  const config = loadConfig();

  // Priority 1: Use original URL if available
  if (actorData.thumbUrl && actorData.thumbUrl.startsWith('http')) {
    return actorData.thumbUrl;
  }

  // Priority 2: Use absolute path if actorsPath is configured
  if (config.actorsPath && actorData.thumbLocal) {
    const absolutePath = path.join(config.actorsPath, actorData.thumbLocal);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  // Priority 3: Fallback to relative path (for WebUI)
  if (actorData.thumbLocal) {
    return `/actors/${path.basename(actorData.thumbLocal)}`;
  }

  // Final fallback: use whatever thumb value exists
  return actorData.thumb || '';
}

/**
 * Update all movie JSON files with corrected actor thumbs
 */
async function updateAllMovieThumbs() {
  const scrapePath = getScrapePath();

  if (!fs.existsSync(scrapePath)) {
    console.error('❌ Scrape directory not found:', scrapePath);
    process.exit(1);
  }

  console.log('🔍 Scanning movie files in:', scrapePath);

  let total = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const files = fs.readdirSync(scrapePath);

    for (const filename of files) {
      // Skip non-JSON files
      if (!filename.endsWith('.json')) continue;

      total++;
      const filePath = path.join(scrapePath, filename);

      try {
        console.log(`\n📄 Processing: ${filename}`);

        const content = fs.readFileSync(filePath, 'utf-8');
        const fileData = JSON.parse(content);

        // Handle wrapped format (with 'data' property)
        const hasWrapper = fileData.data && typeof fileData.data === 'object';
        const movieData = hasWrapper ? fileData.data : fileData;

        // Check if movie has actors
        if (!movieData.actor || !Array.isArray(movieData.actor) || movieData.actor.length === 0) {
          console.log('  ⏭️  No actors, skipping');
          skipped++;
          continue;
        }

        let movieUpdated = false;
        let actorCount = 0;

        // Update each actor in the movie
        for (const actor of movieData.actor) {
          if (!actor.name) continue;

          // Resolve actor ID
          const actorId = resolveActorId(actor.name);
          if (!actorId) {
            console.log(`  ⚠️  No actor ID found for: ${actor.name}`);
            continue;
          }

          // Load actor data from cache
          const actorData = loadActorLocal(actorId);
          if (!actorData) {
            console.log(`  ⚠️  Actor not in cache: ${actor.name}`);
            continue;
          }

          // Get old thumb value
          const oldThumb = actor.thumb;

          // Update actor fields in movie JSON
          actor.altName = actorData.altName || actor.altName;
          actor.birthdate = actorData.birthdate || actor.birthdate;
          actor.height = actorData.height || actor.height;
          actor.bust = actorData.bust || actor.bust;
          actor.waist = actorData.waist || actor.waist;
          actor.hips = actorData.hips || actor.hips;
          actor.thumb = resolveActorThumb(actorData);

          console.log(`  ✅ ${actor.name}`);
          console.log(`     Old: ${oldThumb}`);
          console.log(`     New: ${actor.thumb}`);

          movieUpdated = true;
          actorCount++;
        }

        // Save updated movie JSON (preserve wrapper if it exists)
        if (movieUpdated) {
          const dataToSave = hasWrapper ? fileData : movieData;
          fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
          updated++;
          console.log(`  💾 Updated ${actorCount} actor(s) in ${filename}`);
        } else {
          skipped++;
          console.log(`  ⏭️  No changes needed`);
        }
      } catch (error) {
        failed++;
        console.error(`  ❌ Failed to update ${filename}:`, error.message);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('✨ Update Summary');
    console.log('='.repeat(60));
    console.log(`Total files:    ${total}`);
    console.log(`Updated:        ${updated}`);
    console.log(`Skipped:        ${skipped}`);
    console.log(`Failed:         ${failed}`);
    console.log('='.repeat(60));

    if (failed > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run
console.log('🎬 Actor Thumb URL Update Tool');
console.log('='.repeat(60));
updateAllMovieThumbs();
