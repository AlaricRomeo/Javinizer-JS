/**
 * Browser management for r18dev scraper
 * Uses Puppeteer for search (handles JS), HTTP for JSON download
 */

const https = require('https');
const puppeteer = require('puppeteer');

let browser = null;
let page = null;
let _s = 0; // Session usage counter
const _m = 80; // Max operations per session

/**
 * Make HTTPS request with browser headers
 * @param {string} url - URL to fetch
 * @returns {Promise<object>} Parsed JSON response
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://r18.dev/',
        'Origin': 'https://r18.dev'
      }
    };

    https.get(options, (res) => {
      let data = '';

      // Check HTTP status code
      if (res.statusCode === 404) {
        reject(new Error('Video not found (404)'));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Initialize browser for search
 */
async function initBrowser() {
  if (browser) return;

  console.error('[R18Dev] Launching headless browser for search...');

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ],
    defaultViewport: { width: 1920, height: 1080 }
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  browser = await puppeteer.launch(launchOptions);
  page = await browser.newPage();
  console.error('[R18Dev] Browser ready');
}

/**
 * Search for a code and get the content ID using browser
 * @param {string} code - DVD code (e.g., "SDDM-943")
 * @returns {Promise<string>} Content ID (e.g., "jur618")
 */
async function searchCode(code) {
  console.error(`[R18Dev] Searching for: ${code}`);

  // Check session limit
  if (_s >= _m) {
    const e = new Error('Session limit reached');
    e.code = 'SESSION_LIMIT';
    throw e;
  }

  try {
    if (!browser) await initBrowser();

    // Navigate to r18.dev homepage
    await page.goto('https://r18.dev/', { waitUntil: 'networkidle0', timeout: 7500 });

    // Type code into search box
    await page.waitForSelector('#lookup', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#lookup').value = '');
    await page.type('#lookup', code);

    console.error('[R18Dev] Submitting search via browser...');

    // Click search and wait for navigation
    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 7500 }),
      page.click('input[type="submit"]')
    ]);

    // Check if we got redirected to a detail page
    const url = page.url();
    console.error(`[R18Dev] Redirected to: ${url}`);

    // Try to extract content ID from the page
    const contentId = await page.$eval('#content-id', el => el.textContent.trim());

    if (!contentId) {
      throw new Error('Video not found - no content ID on page');
    }

    console.error(`[R18Dev] Found content ID: ${contentId}`);
    _s++; // Increment counter
    return contentId;

  } catch (error) {
    console.error(`[R18Dev] Search failed: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch JSON data for a content ID using Puppeteer (avoids Cloudflare)
 * @param {string} contentId - Content ID (e.g., "jur618")
 * @returns {Promise<object>} JSON data
 */
async function fetchJson(contentId) {
  const jsonUrl = `https://r18.dev/videos/vod/movies/detail/-/combined=${contentId}/json`;
  console.error(`[R18Dev] Fetching JSON: ${jsonUrl}`);

  try {
    if (!browser) await initBrowser();

    // Navigate to JSON URL
    await page.goto(jsonUrl, { waitUntil: 'networkidle0', timeout: 7500 });

    // Extract JSON from page body
    const jsonText = await page.evaluate(() => document.body.textContent);
    const data = JSON.parse(jsonText);

    console.error('[R18Dev] JSON fetched successfully');
    return data;

  } catch (error) {
    console.error(`[R18Dev] Failed to fetch JSON: ${error.message}`);
    throw error;
  }
}

/**
 * Close browser instance
 */
async function closeBrowser() {
  if (browser) {
    console.error('[R18Dev] Closing browser...');
    await browser.close();
    browser = null;
    page = null;
    _s = 0; // Reset counter
  }
}

module.exports = {
  searchCode,
  fetchJson,
  closeBrowser
};
