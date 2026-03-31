#!/usr/bin/env node

/**
 * XSList Actor Scraper
 *
 * Scrapes actor data from xslist.org/en
 * Uses FlareSolverr to bypass Cloudflare protection
 *
 * Extracts:
 * - Name (English romanized)
 * - altName (Japanese name from h1 text)
 * - Birthdate (ISO format)
 * - Height, Bust, Waist, Hips
 * - Photo (profile_img)
 *
 * Flow:
 * 1. Search by name → https://xslist.org/en/search?name={name}&lg=en
 * 2. Follow first result link if on results page
 * 3. Parse detail page
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { createEmptyActor, removeEmptyFields, normalizeActorName } = require('../schema');
const { getActorsCachePath } = require('../cache-helper');
const { fetchWithFlareSolverr, destroySession, downloadImageWithCookies } = require('./flaresolverr');

const BASE_URL = 'https://xslist.org';

function invertName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

function normalizeStr(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}


/**
 * Parse all available data from search results page.
 * Each result contains: name, altName, photo, birthdate, measurements.
 * Returns the first result that matches actorName, or null.
 *
 * Result HTML structure:
 *   <li class="clearfix">
 *     <h3><a title="Seira Hoshisaki - 星咲せいら" href="/en/model/470.html">...</a></h3>
 *     <div class="img_c"><img src="https://xslist.org/kojav/model2/0/470.jpg"></div>
 *     <p>Seira Hoshisaki was born on 11/01/1993 in Aichi. <br>Measurements: B72 / W52 / H78, ...</p>
 *   </li>
 */
function parseSearchResult(html, actorName) {
  const $ = cheerio.load(html);
  const needle = normalizeStr(actorName);
  const needleInv = normalizeStr(invertName(actorName));

  let matched = null;

  $('li.clearfix').each((i, li) => {
    if (matched) return;
    const link = $(li).find('a[href*="/en/model/"]').first();
    const title = link.attr('title') || link.text();
    const parts = title.split(' - ');
    const engName = (parts[0] || '').trim();
    const norm = normalizeStr(engName);
    if (norm !== needle && norm !== needleInv) return;

    const actor = createEmptyActor(actorName);
    actor.id = normalizeActorName(actorName);
    actor.name = engName;
    if (parts[1]) actor.altName = parts[1].trim();

    // Photo
    const imgSrc = $(li).find('img').first().attr('src') || '';
    if (imgSrc) actor._photoUrl = imgSrc;

    // Birthdate and measurements from <p>
    const pText = $(li).find('p').first().text();

    // Birthdate: "born on MM/DD/YYYY"
    const bornMatch = pText.match(/born on (\d{2})\/(\d{2})\/(\d{4})/);
    if (bornMatch) {
      actor.birthdate = `${bornMatch[3]}-${bornMatch[1]}-${bornMatch[2]}`;
    }

    // Measurements: "B72 / W52 / H78" or "72-52-78 (cm)"
    const measMatch = pText.match(/B(\d+)\s*\/\s*W(\d+)\s*\/\s*H(\d+)/) ||
                      pText.match(/(\d+)-(\d+)-(\d+)\s*(?:cm|\(cm\))/i);
    if (measMatch) {
      actor.bust  = parseInt(measMatch[1], 10);
      actor.waist = parseInt(measMatch[2], 10);
      actor.hips  = parseInt(measMatch[3], 10);
    }

    matched = actor;
  });

  return matched;
}



/**
 * Scrape a single actor from xslist
 */
async function scrapeXslist(actorName) {
  console.error(`[xslist] Scraping: ${actorName}`);

  // xslist uses ?query= with name in Last First order
  const searchCandidates = [
    `${BASE_URL}/search?query=${encodeURIComponent(invertName(actorName))}&lg=en`,
    `${BASE_URL}/search?query=${encodeURIComponent(actorName)}&lg=en`,
  ];

  let searchHtml = null;
  let sessionCookies = [];
  let sessionUserAgent = '';
  for (const searchUrl of searchCandidates) {
    console.error(`[xslist] Trying search: ${searchUrl}`);
    try {
      const { html, cookies, userAgent } = await fetchWithFlareSolverr(searchUrl);
      if (!html.includes('404 Page Not Found')) {
        searchHtml = html;
        sessionCookies = cookies;
        sessionUserAgent = userAgent;
        console.error(`[xslist] Search HTML length: ${html.length}`);
        break;
      }
      console.error(`[xslist] 404 at: ${searchUrl}`);
    } catch (e) {
      console.error(`[xslist] Error fetching ${searchUrl}: ${e.message}`);
    }
  }

  if (!searchHtml) {
    console.error(`[xslist] All search URLs failed for: ${actorName}`);
    return null;
  }

  // All data is available directly in search results — no detail page needed
  const actor = parseSearchResult(searchHtml, actorName);
  if (!actor) {
    console.error(`[xslist] No matching result for: ${actorName}`);
    return null;
  }

  const photoUrl = actor._photoUrl || '';
  delete actor._photoUrl;

  if (photoUrl && !photoUrl.includes('anonymous')) {
    const actorsPath = getActorsCachePath();
    if (!fs.existsSync(actorsPath)) fs.mkdirSync(actorsPath, { recursive: true });

    const extMatch = photoUrl.match(/\.(webp|jpg|jpeg|png|gif)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const filename = `${actor.id}.${ext}`;
    const destPath = path.join(actorsPath, filename);

    try {
      await downloadImageWithCookies(photoUrl, destPath, sessionCookies, sessionUserAgent);
      actor.thumbUrl = photoUrl;
      actor.thumbLocal = filename;
      actor.thumb = `/actors/${filename}`;
      console.error(`[xslist] Photo saved: ${filename}`);
    } catch (err) {
      console.error(`[xslist] Photo download failed: ${err.message}`);
      actor.thumbUrl = photoUrl;
      actor.thumb = photoUrl;
    }
  }

  console.error(`[xslist] Done: ${actor.name}`);
  return removeEmptyFields(actor);
}

/**
 * Scrape multiple actors (batch)
 */
async function scrapeActors(names) {
  const results = [];
  try {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      try {
        const result = await scrapeXslist(name);
        results.push(result || { id: normalizeActorName(name), name, error: 'Not found' });
      } catch (error) {
        console.error(`[xslist] Error for "${name}": ${error.message}`);
        results.push({ id: normalizeActorName(name), name, error: error.message });
      }
      if (i < names.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } finally {
    await destroySession();
  }
  return results;
}

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('[xslist] Usage: node run.js <NAME> [NAME2] ...');
    console.error('[xslist] Example: node run.js "Yui Hatano"');
    process.exit(1);
  }
  try {
    const results = await scrapeActors(names);
    console.log(JSON.stringify(results, null, 2));
    setTimeout(() => process.exit(results.some(r => r.error) ? 1 : 0), 1000);
  } catch (error) {
    console.error('[xslist] Critical error:', error.message);
    const errorResults = names.map(name => ({ id: normalizeActorName(name), name, error: error.message }));
    console.log(JSON.stringify(errorResults, null, 2));
    setTimeout(() => process.exit(1), 1000);
  }
}

if (require.main === module) main();

module.exports = { scrapeXslist, scrapeActors, scrapeActor: scrapeXslist };
