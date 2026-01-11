#!/usr/bin/env node

/**
 * JAVDB Actor Scraper (renamed from javdatabase)
 *
 * Scrapes actor data from javdatabase.com
 * URL pattern: https://www.javdatabase.com/idols/{slug}/
 *
 * Extracts:
 * - Name (from h1.idol-name, removes " - JAV Profile" suffix)
 * - Birthdate (from DOB: field in bold tags)
 * - Measurements: Bust-Waist-Hips (from "Measurements:" field)
 * - Height (from "Height:" field)
 * - Photo (from idolimages/full/)
 *
 * Fallback Strategy:
 * - If actor not found with original name, tries inverting name parts
 *   Example: "Mao Hamasaki" → "Hamasaki Mao"
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createEmptyActor, removeEmptyFields, normalizeActorName } = require('../schema');
const { getActorsCachePath } = require('../cache-helper');


/**
 * Download image from URL
 */
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
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

/**
 * Scrape actor from javdatabase.com with single URL
 */
async function scrapeJavDB(actorName, tryInvertedName = false, browser = null) {
  // On second attempt, invert the name
  const searchName = tryInvertedName ? invertName(actorName) : actorName;
  const slug = normalizeActorName(searchName);
  const url = `https://www.javdatabase.com/idols/${slug}/`;

  console.error(`[javdb] ${tryInvertedName ? 'Retry with inverted name' : 'Scraping'}: ${url}`);

  const shouldCloseBrowser = !browser;

  try {
    // Launch browser (headless) if not provided
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });
    }

    const page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Navigate to page and capture response
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Prefer HTTP status code for existence checks (more reliable)
    const status = response ? response.status() : null;
    console.error(`[javdb] HTTP status: ${status}`);

    if (!response || (status >= 400 && status !== 301 && status !== 302)) {
      console.error('[javdb] Actor not found (HTTP)');

      // On first attempt, try inverted name
      if (!tryInvertedName) {
        console.error('[javdb] Trying inverted name...');
        const result = await scrapeJavDB(actorName, true, browser);
        if (shouldCloseBrowser) await browser.close();
        return result;
      }

      if (shouldCloseBrowser) await browser.close();
      return null;
    }

    // Fall back to DOM checks if status looks OK but page still might be a block
    const pageContent = await page.content();
    const hasName = await page.$('h1.idol-name');
    if (!hasName && (pageContent.includes('404') || pageContent.includes('Not Found'))) {
      console.error('[javdb] Actor not found (DOM)');

      if (!tryInvertedName) {
        console.error('[javdb] Trying inverted name...');
        const result = await scrapeJavDB(actorName, true, browser);
        if (shouldCloseBrowser) await browser.close();
        return result;
      }

      if (shouldCloseBrowser) await browser.close();
      return null;
    }

    // Create actor object
    const actor = createEmptyActor(actorName);
    actor.id = normalizeActorName(actorName); // Use original name for ID

    // Extract name from h1.idol-name (remove " - JAV Profile" suffix)
    const nameElement = await page.$('h1.idol-name');
    if (nameElement) {
      const fullName = await page.evaluate(el => el.textContent.trim(), nameElement);
      actor.name = fullName.replace(/ - JAV Profile$/i, '').trim();
    }

    // Extract data from the bold tags section
    // Pattern: <b>DOB:</b> <a>1993-10-20</a>
    // Pattern: <b>Measurements:</b> 88-59-84
    // Pattern: <b>Height:</b> <a>165 cm</a>

    const pageText = await page.evaluate(() => document.body.textContent);

    // Extract birthdate (DOB: YYYY-MM-DD)
    const dobMatch = pageText.match(/DOB:\s*(\d{4}-\d{2}-\d{2})/);
    if (dobMatch) {
      actor.birthdate = dobMatch[1];
    }

    // Extract measurements (Measurements: 88-59-84)
    const measurementsMatch = pageText.match(/Measurements:\s*(\d+)-(\d+)-(\d+)/);
    if (measurementsMatch) {
      actor.bust = parseInt(measurementsMatch[1], 10);
      actor.waist = parseInt(measurementsMatch[2], 10);
      actor.hips = parseInt(measurementsMatch[3], 10);
    }

    // Extract height (Height: 165 cm)
    const heightMatch = pageText.match(/Height:\s*(\d+)\s*cm/i);
    if (heightMatch) {
      actor.height = parseInt(heightMatch[1], 10);
    }

    // Extract Japanese name (JP: 浜崎真緒)
    const jpNameMatch = pageText.match(/JP:\s*([ぁ-んァ-ヶー一-龯]+)/);
    if (jpNameMatch) {
      actor.altName = jpNameMatch[1].trim();
    }

    // Extract photo URL from meta tags (og:image)
    const photoUrl = await page.evaluate(() => {
      const ogImage = document.querySelector('meta[property="og:image"]');
      return ogImage ? ogImage.getAttribute('content') : null;
    });

    // Close page
    await page.close();

    // Close browser if we created it
    if (shouldCloseBrowser) {
      await browser.close();
    }

    // Download photo if available
    if (photoUrl) {
      console.error(`[javdb] Downloading photo: ${photoUrl}`);

      const actorsPath = getActorsCachePath();

      // Extract file extension from URL (support webp, jpg, png, etc.)
      const urlExtension = photoUrl.match(/\.(webp|jpg|jpeg|png|gif)(\?|$)/i);
      const extension = urlExtension ? urlExtension[1].toLowerCase() : 'jpg';

      const photoFilename = `${actor.id}.${extension}`;
      const photoPath = path.join(actorsPath, photoFilename);

      // Ensure actors directory exists
      if (!fs.existsSync(actorsPath)) {
        fs.mkdirSync(actorsPath, { recursive: true });
      }

      try {
        await downloadImage(photoUrl, photoPath);
        console.error(`[javdb] Photo saved: ${photoPath}`);

        // Always preserve original URL
        actor.thumbUrl = photoUrl;

        // Set local path (filename only)
        actor.thumbLocal = photoFilename;

        // Set thumb to use /actors/ endpoint (works with both local and external actorsPath)
        actor.thumb = `/actors/${photoFilename}`;
      } catch (error) {
        console.error(`[javdb] Failed to download photo:`, error.message);
        // Still preserve URL even if download fails
        actor.thumbUrl = photoUrl;
        actor.thumb = photoUrl;
      }
    }

    // Return cleaned result
    return removeEmptyFields(actor);

  } catch (error) {
    console.error('[javdb] Error:', error.message);

    if (shouldCloseBrowser && browser) {
      await browser.close();
    }

    return null;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('[javdb] Usage: node run.js <actor_name>');
    process.exit(1);
  }

  const actorName = args[0];

  try {
    const scrapedActor = await scrapeJavDB(actorName);

    if (scrapedActor) {
      console.log(JSON.stringify(scrapedActor, null, 2));
      process.exit(0);
    } else {
      console.error('[javdb] Scraping failed, no data found');
      console.log(JSON.stringify(null));
      process.exit(0);
    }

  } catch (error) {
    console.error('[javdb] Error:', error.message);
    console.log(JSON.stringify(null));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { scrapeJavDB };
