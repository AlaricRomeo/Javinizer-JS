#!/usr/bin/env node

/**
 * XCITY Actor Scraper
 *
 * Scrapes actor data from xxx.xcity.jp (English AV idol listing).
 * URL pattern: https://xxx.xcity.jp/idol/detail/{id}/
 *
 * Actors are looked up by name via the site's search endpoint
 * (https://xxx.xcity.jp/idol/?q={name}) since IDs are numeric and not
 * derivable from the name. The search matches tokens regardless of order,
 * so results are filtered down to an exact (normalized) name match.
 *
 * Extracts:
 * - Name (from h1)
 * - Birthdate (from "Date of birth" profile row, e.g. "1988 May 24")
 * - Height (from "Height" profile row, e.g. "163cm")
 * - Measurements: Bust(cup)-Waist-Hips (from "Size" profile row, e.g. "B88(D) W59 H85")
 * - Photo (from .actressThumb)
 *
 * No FlareSolverr/Cloudflare challenge encountered - plain HTTP works.
 *
 * Fallback Strategy:
 * - If actor not found with original name, tries inverting name parts
 *   Example: "Mao Hamasaki" → "Hamasaki Mao"
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createEmptyActor, removeEmptyFields, normalizeActorName } = require('../schema');
const { getActorsCachePath } = require('../cache-helper');

const BASE_URL = 'https://xxx.xcity.jp';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

/**
 * Download image from URL
 */
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
      if (response.statusCode !== 200) {
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
 * Invert name parts (e.g., "Mao Hamasaki" → "Hamasaki Mao")
 */
function invertName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name;
}

function normalizeCompare(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Parse "1988 May 24" into "1988-05-24"
 */
function parseBirthdate(text) {
  const match = text.match(/(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})/);
  if (!match) return '';

  const [, year, monthName, day] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return '';

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Search xcity for an actor by name, return the detail page URL of the
 * exact (normalized) name match, or null if not found.
 */
async function findActorUrl(actorName) {
  const searchUrl = `${BASE_URL}/idol/?q=${encodeURIComponent(actorName)}&num=30`;
  console.error(`[xcity] Searching: ${searchUrl}`);

  const response = await fetch(searchUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.error(`[xcity] Search request failed: HTTP ${response.status}`);
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const target = normalizeCompare(actorName);
  const targetInverted = normalizeCompare(invertName(actorName));

  let matchedHref = null;

  $('#avidol .itemBox .name a').each((_, el) => {
    if (matchedHref) return;

    const title = $(el).attr('title') || $(el).text();
    const candidate = normalizeCompare(title);

    if (candidate === target || candidate === targetInverted) {
      matchedHref = $(el).attr('href');
    }
  });

  if (!matchedHref) {
    console.error('[xcity] No exact name match in search results');
    return null;
  }

  return new URL(matchedHref, `${BASE_URL}/idol/`).href;
}

/**
 * Scrape actor detail page into standard actor schema
 */
async function scrapeDetailPage(detailUrl, actorName) {
  console.error(`[xcity] Scraping: ${detailUrl}`);

  const response = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.error(`[xcity] Detail request failed: HTTP ${response.status}`);
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const actor = createEmptyActor(actorName);
  actor.id = normalizeActorName(actorName); // Use original name for ID

  actor.name = $('h1').first().text().trim() || actorName;

  $('dl.profile dd').each((_, el) => {
    const $dd = $(el);
    const label = $dd.find('.koumoku').text().trim();
    if (!label) return;

    const value = $dd.text().slice(label.length).trim();
    if (!value) return;

    if (label === 'Date of birth') {
      actor.birthdate = parseBirthdate(value);
    } else if (label === 'Height') {
      const heightMatch = value.match(/(\d+)\s*cm/i);
      if (heightMatch) actor.height = parseInt(heightMatch[1], 10);
    } else if (label === 'Size') {
      const sizeMatch = value.match(/B(\d+)(?:\([^)]*\))?\s*W(\d+)\s*H(\d+)/i);
      if (sizeMatch) {
        actor.bust = parseInt(sizeMatch[1], 10);
        actor.waist = parseInt(sizeMatch[2], 10);
        actor.hips = parseInt(sizeMatch[3], 10);
      }
    }
  });

  const photoSrc = $('.photo .actressThumb').attr('src');
  const photoUrl = photoSrc ? new URL(photoSrc, `${BASE_URL}/`).href : null;

  if (photoUrl) {
    console.error(`[xcity] Downloading photo: ${photoUrl}`);

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
      console.error(`[xcity] Photo saved: ${photoPath}`);

      actor.thumbUrl = photoUrl;
      actor.thumbLocal = photoFilename;
      actor.thumb = `/actors/${photoFilename}`;
    } catch (error) {
      console.error(`[xcity] Failed to download photo:`, error.message);
      actor.thumbUrl = photoUrl;
      actor.thumb = photoUrl;
    }
  }

  actor.meta.sources = ['xcity'];
  actor.meta.lastUpdate = new Date().toISOString();

  return removeEmptyFields(actor);
}

/**
 * Scrape a single actor from xcity.jp, trying inverted name on failure
 */
async function scrapeActor(actorName, tryInvertedName = false) {
  const searchName = tryInvertedName ? invertName(actorName) : actorName;

  try {
    const detailUrl = await findActorUrl(searchName);

    if (!detailUrl) {
      if (!tryInvertedName) {
        console.error('[xcity] Trying inverted name...');
        return await scrapeActor(actorName, true);
      }
      return null;
    }

    const actor = await scrapeDetailPage(detailUrl, actorName);
    return actor;

  } catch (error) {
    console.error('[xcity] Error:', error.message);

    if (!tryInvertedName) {
      console.error('[xcity] Trying inverted name after error...');
      try {
        return await scrapeActor(actorName, true);
      } catch (retryError) {
        console.error('[xcity] Error on retry:', retryError.message);
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
      console.error(`[xcity] Error processing ${name}:`, error.message);
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
    console.error('[xcity] Usage: node run.js <NAME> [NAME2] [NAME3] ...');
    console.error('[xcity] Example: node run.js "Yuzuka Miyoshi"');
    console.error('[xcity] Example: node run.js "Yuzuka Miyoshi" "Yui Hatano"');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

    const hasErrors = results.some(r => r.error);
    process.exit(hasErrors ? 1 : 0);

  } catch (error) {
    console.error('[xcity] Critical error:', error.message);

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
