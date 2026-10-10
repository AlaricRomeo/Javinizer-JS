#!/usr/bin/env node

/**
 * Jav Guru Actor Scraper
 *
 * Scrapes actor data from jav.guru actress profile cards.
 * URL pattern: https://jav.guru/actress/{slug}/ (e.g. /actress/sakura-china/)
 *
 * The slug is the romanized name, lowercased and hyphenated (Family Given
 * order on the site), so it's derived straight from the name — no search.
 *
 * Extracts:
 * - Name (from h1.profile-h1)
 * - Aliases (from .cp-alias-row: first Japanese one → altName, rest → otherNames)
 * - Birth year only (from "Age: N" pill — the site has no full birthdate)
 * - Height (from "151 cm" pill)
 * - Photo (from img.cp-avatar — absent when the site has none; fetched from jav.guru, not the CDN)
 *
 * The cup-size pill (e.g. "A-Cup") is ignored: the schema has bust in cm only.
 *
 * No FlareSolverr/Cloudflare challenge encountered - plain HTTP works.
 *
 * Fallback Strategy:
 * - If actor not found with original name, tries inverting name parts
 *   Example: "China Sakura" → "Sakura China"
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createEmptyActor, removeEmptyFields, normalizeActorName, isPlaceholderPhotoFile } = require('../schema');
const { getActorsCachePath } = require('../cache-helper');

const BASE_URL = 'https://jav.guru';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const JAPANESE_RE = /[぀-ヿ一-龯㐀-䶿]/;

/**
 * Download image from URL
 */
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Invert name parts (e.g., "China Sakura" → "Sakura China")
 */
function invertName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name;
}

/**
 * Fetch and parse the profile page for a name, or null if there's none.
 */
async function scrapeProfile(searchName, actorName) {
  // Pure-Japanese names would only produce the hash fallback slug.
  if (!/[a-z]/i.test(searchName)) return null;

  const url = `${BASE_URL}/actress/${normalizeActorName(searchName)}/`;
  console.error(`[javguru] Fetching: ${url}`);

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.error(`[javguru] Request failed: HTTP ${response.status}`);
    return null;
  }

  const $ = cheerio.load(await response.text());
  const $card = $('.clean-profile-card').first();
  const siteName = $card.find('h1.profile-h1').text().replace(/\s+/g, ' ').trim();

  // An actress tag page without a profile card carries no data worth saving.
  if (!$card.length || !siteName) {
    console.error('[javguru] No profile card on page');
    return null;
  }

  const actor = createEmptyActor(siteName);

  // Derive id from the site's own canonical name, not the search query.
  actor.id = normalizeActorName(actor.name);

  const aliasText = $card.find('.cp-alias-row').text().replace(/^\s*Alias:\s*/i, '');
  const aliases = Array.from(new Set(aliasText.split(',').map(s => s.trim()).filter(Boolean)));
  const jpIndex = aliases.findIndex(a => JAPANESE_RE.test(a));
  if (jpIndex >= 0) actor.altName = aliases.splice(jpIndex, 1)[0];
  if (aliases.length > 0) actor.otherNames = aliases;

  $card.find('.cp-stat-pill').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    const ageMatch = text.match(/^Age:\s*(\d{1,3})$/i);
    if (ageMatch) {
      // Only the age is published: store the (approximate, ±1) birth year.
      // Other scrapers' full dates always take precedence (see isPartialBirthdate).
      const age = parseInt(ageMatch[1], 10);
      if (age >= 18 && age < 100) actor.birthdate = String(new Date().getFullYear() - age);
      return;
    }

    const heightMatch = text.match(/^(\d{3})\s*cm$/i);
    if (heightMatch) actor.height = parseInt(heightMatch[1], 10);
  });

  // The image CDN (cdn.javmiku.com) sits behind a Cloudflare challenge, but
  // jav.guru itself serves the same /wp-content/uploads path directly.
  const photoSrc = $card.find('img.cp-avatar').attr('src');
  const photoUrl = photoSrc ? new URL(new URL(photoSrc, `${BASE_URL}/`).pathname, `${BASE_URL}/`).href : null;

  if (photoUrl) {
    console.error(`[javguru] Downloading photo: ${photoUrl}`);

    const actorsPath = getActorsCachePath();
    const urlExtension = photoUrl.match(/\.(webp|jpg|jpeg|png|gif)(\?|$)/i);
    const extension = urlExtension ? urlExtension[1].toLowerCase() : 'jpg';

    const photoFilename = `${actor.id}.${extension}`;
    const photoPath = path.join(actorsPath, photoFilename);

    if (!fs.existsSync(actorsPath)) {
      fs.mkdirSync(actorsPath, { recursive: true });
    }

    try {
      await downloadImage(photoUrl, photoPath);

      if (isPlaceholderPhotoFile(photoPath)) {
        console.error('[javguru] Photo is a generic placeholder, skipping');
        fs.unlinkSync(photoPath);
      } else {
        console.error(`[javguru] Photo saved: ${photoPath}`);

        actor.thumbUrl = photoUrl;
        actor.thumbLocal = photoFilename;
        actor.thumb = `/actors/${photoFilename}`;
      }
    } catch (error) {
      console.error('[javguru] Failed to download photo:', error.message);
      actor.thumbUrl = photoUrl;
      actor.thumb = photoUrl;
    }
  }

  actor.meta.sources = ['javguru'];
  actor.meta.lastUpdate = new Date().toISOString();

  return removeEmptyFields(actor);
}

/**
 * Scrape a single actor from jav.guru, trying inverted name on failure
 */
async function scrapeActor(actorName, tryInvertedName = false) {
  const searchName = tryInvertedName ? invertName(actorName) : actorName;

  try {
    const actor = await scrapeProfile(searchName, actorName);

    if (!actor && !tryInvertedName && invertName(actorName) !== actorName) {
      console.error('[javguru] Trying inverted name...');
      return await scrapeActor(actorName, true);
    }

    return actor;

  } catch (error) {
    console.error('[javguru] Error:', error.message);

    if (!tryInvertedName && invertName(actorName) !== actorName) {
      console.error('[javguru] Trying inverted name after error...');
      try {
        return await scrapeActor(actorName, true);
      } catch (retryError) {
        console.error('[javguru] Error on retry:', retryError.message);
        return null;
      }
    }

    return null;
  }
}

/**
 * Scrape multiple actors (batch processing)
 */
async function scrapeActors(names) {
  const results = [];

  for (const name of names) {
    try {
      const result = await scrapeActor(name);

      if (result) {
        results.push(result);
      } else {
        results.push({
          id: normalizeActorName(name),
          name,
          error: 'Not found'
        });
      }
    } catch (error) {
      console.error(`[javguru] Error processing ${name}:`, error.message);
      results.push({
        id: normalizeActorName(name),
        name,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Main entry point
 */
async function main() {
  const names = process.argv.slice(2);

  if (names.length === 0) {
    console.error('[javguru] Usage: node run.js <NAME> [NAME2] [NAME3] ...');
    console.error('[javguru] Example: node run.js "Sakura China"');
    console.error('[javguru] Example: node run.js "Sakura China" "Hatano Yui"');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

    const hasErrors = results.some(r => r.error);
    process.exit(hasErrors ? 1 : 0);

  } catch (error) {
    console.error('[javguru] Critical error:', error.message);

    const errorResults = names.map(name => ({
      id: normalizeActorName(name),
      name,
      error: error.message
    }));
    console.log(JSON.stringify(errorResults, null, 2));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { scrapeActor, scrapeActors };
