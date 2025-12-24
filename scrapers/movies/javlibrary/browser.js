/**
 * Browser management for javlibrary scraper
 * Handles Cloudflare protection with real browser
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let browser = null;
let sessionPage = null; // Keep the same page/tab alive
let _s = 0; // Session usage counter

const COOKIES_FILE = path.join(__dirname, '.cookies.json');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const _m = 80; // Max operations per session

/**
 * Clean old browser cache if it's stale
 * @param {string} userDataDir - Path to browser data directory
 */
function cleanOldCache(userDataDir) {
  if (!fs.existsSync(userDataDir)) return;

  try {
    const stats = fs.statSync(userDataDir);
    const ageMs = Date.now() - stats.mtimeMs;

    if (ageMs > CACHE_MAX_AGE_MS) {
      console.error('[Browser] Cache is older than 24h, cleaning...');
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.error('[Browser] Cache cleaned');
    }
  } catch (error) {
    console.error(`[Browser] Error checking cache: ${error.message}`);
  }
}

/**
 * Initialize browser instance
 * @param {boolean} headless - Run browser in headless mode
 */
async function initBrowser(headless = false) {
  if (browser) return;

  console.error(`[Browser] Launching browser${headless ? ' (headless)' : ''}...`);

  // Use a persistent user data directory to maintain session across runs
  const userDataDir = path.join(__dirname, '.browser-data');

  // Clean cache if it's too old
  cleanOldCache(userDataDir);

  const launchOptions = {
    headless: headless,
    userDataDir: userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--window-size=1920,1080'
    ],
    defaultViewport: { width: 1920, height: 1080 }
  };

  // Use system Chromium in Docker if available
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  browser = await puppeteer.launch(launchOptions);

  console.error('[Browser] Browser ready with persistent session');
}

/**
 * Initialize session by solving Cloudflare once
 * Opens browser, lets user solve challenge, then closes and saves cookies
 */
async function initSession() {
  await initBrowser(false); // Non-headless for user interaction

  const pages = await browser.pages();
  sessionPage = pages[0] || await browser.newPage();

  try {
    console.error('[Browser] Opening browser to initialize session...');
    await sessionPage.goto('https://www.javlibrary.com/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.error('[Browser] ========================================');
    console.error('[Browser] Browser window is now open.');
    console.error('[Browser] Please:');
    console.error('[Browser]   1. Solve any Cloudflare challenges');
    console.error('[Browser]   2. Accept the adult agreement');
    console.error('[Browser]   3. Press ENTER in this terminal when ready');
    console.error('[Browser] ========================================');

    // Wait for user to press Enter
    await new Promise((resolve) => {
      process.stdin.once('data', () => {
        process.stdin.pause(); // Release stdin to allow clean exit
        resolve();
      });
    });

    console.error('[Browser] Session initialized, browser will stay open');
    // Keep the page open - we'll reuse it for scraping

  } catch (error) {
    console.error(`[Browser] Error: ${error.message}`);
    if (sessionPage) await sessionPage.close();
    throw error;
  }
}

/**
 * Fetch page content using saved session (no browser needed)
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} HTML content
 */
async function fetchPage(url) {
  // Reuse the same page/tab from initSession - don't create new ones
  if (!sessionPage) {
    throw new Error('Session page not initialized. Call initSession first.');
  }

  // Check session limit
  if (_s >= _m) {
    const e = new Error('Session limit reached');
    e.code = 'SESSION_LIMIT';
    throw e;
  }

  try {
    console.error(`[Browser] Fetching ${url}...`);
    await sessionPage.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    const html = await sessionPage.content();
    _s++; // Increment counter

    console.error('[Browser] Page fetched successfully');
    return html;

  } catch (error) {
    console.error(`[Browser] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Close browser instance
 */
async function closeBrowser() {
  if (browser) {
    console.error('[Browser] Closing browser...');
    if (sessionPage) {
      await sessionPage.close();
      sessionPage = null;
    }
    await browser.close();
    browser = null;
    _s = 0; // Reset counter
  }
}

module.exports = {
  initSession,
  fetchPage,
  closeBrowser
};
