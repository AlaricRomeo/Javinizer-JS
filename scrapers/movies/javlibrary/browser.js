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

const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
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
      console.error('[JavLibrary Scrape] Cache is older than 6h, cleaning...');
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.error('[JavLibrary Scrape] Cache cleaned');
    }
  } catch (error) {
    console.error(`[JavLibrary Scrape] Error checking cache: ${error.message}`);
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
  const userDataDir = path.join(__dirname, 'browser-data');

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
 * Wait for interactive user confirmation via WebSocket
 * Sends a prompt message to stdout and waits for response on stdin
 */
async function waitForUserConfirmation(message) {
  return new Promise((resolve) => {
    // Send prompt message to stdout (will be intercepted by ScraperManager)
    const promptData = {
      type: 'confirm',
      message: message
    };
    console.log(`__PROMPT__:${JSON.stringify(promptData)}`);

    // Set up stdin listener for response
    const onData = (data) => {
      try {
        const response = JSON.parse(data.toString().trim());
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(response.response === true);
      } catch (error) {
        console.error(`[Browser] Error parsing response: ${error.message}`);
        resolve(false);
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

/**
 * Initialize session by solving Cloudflare once
 * Opens browser, lets user solve challenge via WebUI
 */
async function initSession() {
  await initBrowser(false); // Non-headless for user interaction

  const pages = await browser.pages();
  sessionPage = pages[0] || await browser.newPage();

  try {
    console.error('[Browser] Opening browser to initialize session...');
    await sessionPage.goto('https://www.javlibrary.com/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Minimize the browser window (works on Linux, Windows behavior varies)
    try {
      const session = await sessionPage.target().createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' }
      });
      console.error('[Browser] Browser window minimized');
    } catch (minimizeError) {
      console.error('[Browser] Could not minimize window (not critical):', minimizeError.message);
    }

    console.error('[Browser] ========================================');
    console.error('[Browser] Browser window is now open.');
    console.error('[Browser] Please:');
    console.error('[Browser]   1. Solve any Cloudflare challenges');
    console.error('[Browser]   2. Accept the adult agreement');
    console.error('[Browser]   3. Click "Continue" when ready');
    console.error('[Browser] ========================================');

    // Wait for user confirmation via WebSocket
    // The message key will be translated by the frontend i18n system
    const confirmed = await waitForUserConfirmation(
      'javlibraryCloudflare'
    );

    if (!confirmed) {
      throw new Error('User canceled browser initialization');
    }

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
    console.error(`[JavLibrary Scrape] Fetching ${url}...`);
    await sessionPage.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    const html = await sessionPage.content();
    _s++; // Increment counter

    console.error('[JavLibrary Scrape] Page fetched successfully');
    return html;

  } catch (error) {
    console.error(`[JavLibrary Scrape] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Close browser instance
 */
async function closeBrowser() {
  if (browser) {
    console.error('[Browser] Closing browser...');
    try {
      // Force kill the browser process immediately for faster shutdown
      const browserProcess = browser.process();
      if (browserProcess && browserProcess.pid) {
        try {
          // On Windows use SIGTERM, on Unix use SIGKILL
          const signal = process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL';
          process.kill(browserProcess.pid, signal);
          console.error('[Browser] Browser process killed');
        } catch (killError) {
          console.error(`[Browser] Could not kill browser process: ${killError.message}`);
        }
      }

      // Clean up references
      if (sessionPage) {
        try {
          await sessionPage.close().catch(() => {});
        } catch (e) {}
        sessionPage = null;
      }

      // Try to close browser gracefully (but don't wait too long)
      try {
        await browser.close().catch(() => {});
      } catch (e) {}

      console.error('[Browser] Browser closed successfully');
    } catch (error) {
      console.error(`[Browser] Error closing browser: ${error.message}`);
    } finally {
      browser = null;
      sessionPage = null;
      _s = 0; // Reset counter
    }
  }
}

module.exports = {
  initSession,
  fetchPage,
  closeBrowser
};
