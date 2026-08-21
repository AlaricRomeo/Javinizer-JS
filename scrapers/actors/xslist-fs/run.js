#!/usr/bin/env node

/**
 * XSList Actor Scraper (xslist-fs, FlareSolverr-backed)
 *
 * Scrapes actor data from xslist.org (English AV model listing).
 * Site is behind aggressive Cloudflare protection, so all requests go
 * through FlareSolverr (see flaresolverr.js) instead of plain HTTP.
 *
 * Actors are looked up by name via the site's search endpoint
 * (https://xslist.org/search?query={name}&lg=en), since profile URLs use
 * numeric, non-derivable IDs (https://xslist.org/en/model/{id}.html).
 * Results are filtered down to an exact (normalized) name match, comparing
 * against the English half of each result's "English - Kanji" title.
 *
 * Extracts:
 * - Name (from itemprop="name")
 * - Kanji name (from the "(...)" suffix on the h1, e.g. "Yui Hatano (波多野結衣)")
 * - Aliases (from itemprop="additionalName", e.g. kana readings, stage name variants)
 * - Birthdate (from "Born: May 23, 1988" in the profile paragraph)
 * - Height (from itemprop="height", e.g. "163cm")
 * - Measurements: Bust-Waist-Hips (from "Measurements: B88 / W59 / H85")
 * - Photo (from img.profile_img - skipped when it's the site's anonymous placeholder)
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
const { fetchWithFlareSolverr, getClearanceHeaders } = require('./flaresolverr');

const BASE_URL = 'https://xslist.org';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PLACEHOLDER_PHOTO = 'anonymous2.png';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

/**
 * Download image from URL. xslist's image CDN sits on the same
 * Cloudflare-protected domain as the pages, so a plain request 403s unless
 * it replays the clearance cookies FlareSolverr obtained while solving the
 * page challenge.
 */
function downloadImage(url, destPath) {
  const clearanceHeaders = getClearanceHeaders();
  const headers = clearanceHeaders || { 'User-Agent': USER_AGENT };

  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (response) => {
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
 * Parse "Born: May 23, 1988" into "1988-05-23"
 */
function parseBirthdate(text) {
  const match = text.match(/Born:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return '';

  const [, monthName, day, year] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return '';

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Search xslist for an actor by name, return the profile page URL of the
 * exact (normalized) name match, or null if not found.
 */
async function findActorUrl(actorName) {
  const searchUrl = `${BASE_URL}/search?query=${encodeURIComponent(actorName)}&lg=en`;
  console.error(`[xslist-fs] Searching: ${searchUrl}`);

  const html = await fetchWithFlareSolverr(searchUrl);
  const $ = cheerio.load(html);

  const target = normalizeCompare(actorName);
  const targetInverted = normalizeCompare(invertName(actorName));

  let matchedHref = null;

  $('li.clearfix h3 a').each((_, el) => {
    if (matchedHref) return;

    const title = $(el).attr('title') || $(el).text();
    // Titles look like "Yui Hatano - 波多野結衣" - compare only the English half
    const englishName = title.split(' - ')[0];
    const candidate = normalizeCompare(englishName);

    if (candidate === target || candidate === targetInverted) {
      matchedHref = $(el).attr('href');
    }
  });

  if (!matchedHref) {
    console.error('[xslist-fs] No exact name match in search results');
    return null;
  }

  return new URL(matchedHref, `${BASE_URL}/`).href;
}

/**
 * Scrape actor profile page into standard actor schema
 */
async function scrapeDetailPage(detailUrl, actorName) {
  console.error(`[xslist-fs] Scraping: ${detailUrl}`);

  const html = await fetchWithFlareSolverr(detailUrl);
  const $ = cheerio.load(html);

  const actor = createEmptyActor(actorName);

  const siteName = $('[itemprop="name"]').first().text().trim();
  actor.name = siteName || actorName;

  // Derive id from the site's own canonical name, not the search query - the
  // same actress found via "First Last" one time and "Last First" another
  // would otherwise get two different ids for the same person.
  actor.id = normalizeActorName(actor.name);

  // Kanji/kana name lives in the h1 right after the name span, e.g.
  // "Yui Hatano (波多野結衣)" - it is not part of itemprop="additionalName".
  // When the site has no distinct kanji name it shows the kana reading with
  // an age suffix instead, e.g. "Shiho Hoshino (ほしのしほ/Age 29)" - strip
  // that suffix since it's not part of the name.
  const h1Text = $('h1').first().text().trim();
  const kanjiMatch = h1Text.match(/\(([^)]+)\)\s*$/);
  if (kanjiMatch) {
    actor.altName = kanjiMatch[1].replace(/\s*\/\s*Age\s*\d+\s*$/i, '').trim();
  }

  // Aliases (kana readings, other stage names)
  const aliases = $('[itemprop="additionalName"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  if (aliases.length > 0) {
    actor.otherNames = Array.from(new Set(aliases));
  }

  const bodyText = $('body').text();

  actor.birthdate = parseBirthdate(bodyText);

  const measurementsMatch = bodyText.match(/Measurements:\s*B(\d{2,3})\s*\/\s*W(\d{2,3})\s*\/\s*H(\d{2,3})/i);
  if (measurementsMatch) {
    actor.bust = parseInt(measurementsMatch[1], 10);
    actor.waist = parseInt(measurementsMatch[2], 10);
    actor.hips = parseInt(measurementsMatch[3], 10);
  }

  const heightText = $('[itemprop="height"]').first().text().trim();
  const heightMatch = heightText.match(/(\d+)\s*cm/i);
  if (heightMatch) {
    actor.height = parseInt(heightMatch[1], 10);
  }

  const photoSrc = $('img.profile_img').attr('src');
  const photoUrl = (photoSrc && !photoSrc.includes(PLACEHOLDER_PHOTO))
    ? new URL(photoSrc, `${BASE_URL}/`).href
    : null;

  if (photoUrl) {
    console.error(`[xslist-fs] Downloading photo: ${photoUrl}`);

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
      console.error(`[xslist-fs] Photo saved: ${photoPath}`);

      actor.thumbUrl = photoUrl;
      actor.thumbLocal = photoFilename;
      actor.thumb = `/actors/${photoFilename}`;
    } catch (error) {
      console.error(`[xslist-fs] Failed to download photo:`, error.message);
      actor.thumbUrl = photoUrl;
      actor.thumb = photoUrl;
    }
  }

  actor.meta.sources = ['xslist-fs'];
  actor.meta.lastUpdate = new Date().toISOString();

  return removeEmptyFields(actor);
}

/**
 * Scrape a single actor from xslist.org, trying inverted name on failure
 */
async function scrapeActor(actorName, tryInvertedName = false) {
  const searchName = tryInvertedName ? invertName(actorName) : actorName;

  try {
    const detailUrl = await findActorUrl(searchName);

    if (!detailUrl) {
      if (!tryInvertedName) {
        console.error('[xslist-fs] Trying inverted name...');
        return await scrapeActor(actorName, true);
      }
      return null;
    }

    return await scrapeDetailPage(detailUrl, actorName);

  } catch (error) {
    console.error('[xslist-fs] Error:', error.message);

    if (!tryInvertedName) {
      console.error('[xslist-fs] Trying inverted name after error...');
      try {
        return await scrapeActor(actorName, true);
      } catch (retryError) {
        console.error('[xslist-fs] Error on retry:', retryError.message);
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
      console.error(`[xslist-fs] Error processing ${name}:`, error.message);
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
    console.error('[xslist-fs] Usage: node run.js <NAME> [NAME2] [NAME3] ...');
    console.error('[xslist-fs] Example: node run.js "Yui Hatano"');
    console.error('[xslist-fs] Example: node run.js "Yui Hatano" "Mao Hamasaki"');
    process.exit(1);
  }

  try {
    const results = await scrapeActors(names);

    // Output ONLY valid JSON to stdout
    console.log(JSON.stringify(results, null, 2));

    const hasErrors = results.some(r => r.error);
    process.exit(hasErrors ? 1 : 0);

  } catch (error) {
    console.error('[xslist-fs] Critical error:', error.message);

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
