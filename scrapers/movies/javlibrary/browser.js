/**
 * Browser management for javlibrary scraper
 * Handles Cloudflare protection with real browser
 *
 * The scraper runs as a short-lived child process (one per scrape), but the
 * browser outlives it: Chrome is spawned detached with a DevTools port, and
 * its endpoint is saved in browser-state.json so the next scrape reconnects
 * to the same, already-past-Cloudflare window instead of launching a new
 * one. A detached watchdog (browser-watchdog.js) kills it after IDLE_MS of
 * inactivity — past that, Cloudflare would challenge again anyway.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('../../../src/core/config');

let browser = null;
let sessionPage = null; // Keep the same page/tab alive
let _s = 0; // Session usage counter

const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const STATE_FILE = path.join(__dirname, 'browser-state.json');
const WATCHDOG_SCRIPT = path.join(__dirname, 'browser-watchdog.js');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const IDLE_MS = 10 * 60 * 1000; // Close the shared browser after 10 min unused
const _m = 80; // Max operations per session

/**
 * Clean stale lock files that prevent browser from starting
 * @param {string} userDataDir - Path to browser data directory
 */
function cleanStaleLocks(userDataDir) {
  if (!fs.existsSync(userDataDir)) return;

  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

  for (const lockFile of lockFiles) {
    const lockPath = path.join(userDataDir, lockFile);
    try {
      if (fs.existsSync(lockPath)) {
        fs.rmSync(lockPath, { force: true });
        console.error(`[JavLibrary Scrape] Removed stale lock: ${lockFile}`);
      }
    } catch (e) {
      // Ignore errors - file might already be deleted
    }
  }
}

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

      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        console.error('[JavLibrary Scrape] Cache cleaned');
      } catch (rmError) {
        console.error(`[JavLibrary Scrape] Could not remove cache: ${rmError.message}`);
        // If we can't delete the whole directory, at least clean the locks
        cleanStaleLocks(userDataDir);
      }
    } else {
      // Cache is fresh but might have stale locks from crashed browser
      cleanStaleLocks(userDataDir);
    }
  } catch (error) {
    console.error(`[JavLibrary Scrape] Error checking cache: ${error.message}`);
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function killPid(pid) {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid, process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
    console.error('[Browser] Browser process killed');
  } catch (e) {
    console.error(`[Browser] Could not kill browser process: ${e.message}`);
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writeState(patch) {
  const next = { ...(readState() || {}), ...patch };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(next), 'utf-8');
  } catch (e) {
    console.error(`[Browser] Could not write browser state: ${e.message}`);
  }
}

function removeState() {
  try { fs.rmSync(STATE_FILE, { force: true }); } catch (_) {}
}

function getExecutablePath() {
  try {
    const cfg = loadConfig();
    if (cfg.browserPath) return cfg.browserPath;
  } catch (_) {}
  return process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Spawn a detached Chrome with a DevTools port, independent from this
 * process's lifetime (puppeteer.launch() would kill it on exit).
 * @returns {Promise<{pid: number, wsEndpoint: string}>}
 */
async function launchDetachedChrome() {
  const portFile = path.join(USER_DATA_DIR, 'DevToolsActivePort');
  try { fs.rmSync(portFile, { force: true }); } catch (_) {}

  const args = [
    `--user-data-dir=${USER_DATA_DIR}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
    '--window-size=1920,1080',
    'about:blank'
  ];

  const child = spawn(getExecutablePath(), args, { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Browser exited during launch (code ${child.exitCode})`);
    try {
      const [port, wsPath] = fs.readFileSync(portFile, 'utf-8').split('\n').map(l => l.trim());
      if (port && wsPath) return { pid: child.pid, wsEndpoint: `ws://127.0.0.1:${port}${wsPath}` };
    } catch (_) {}
    await new Promise(res => setTimeout(res, 200));
  }

  killPid(child.pid);
  throw new Error('Browser launch timeout after 30s');
}

function startWatchdog(pid) {
  const child = spawn(process.execPath, [WATCHDOG_SCRIPT, String(pid), STATE_FILE, String(IDLE_MS)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

/**
 * Connect to the shared browser, reusing the running one when it's still
 * within IDLE_MS, otherwise launching a fresh one.
 * @returns {Promise<boolean>} true if a new browser was launched
 */
async function initBrowser() {
  if (browser && browser.isConnected()) return false;

  let launched = false;
  const state = readState();

  if (state && isAlive(state.pid)) {
    if (Date.now() - (state.lastUsed || 0) < IDLE_MS) {
      try {
        browser = await withTimeout(
          puppeteer.connect({ browserWSEndpoint: state.wsEndpoint, defaultViewport: null }),
          10000,
          'Connect timeout'
        );
        console.error('[Browser] Reusing already open browser');
      } catch (e) {
        console.error(`[Browser] Could not reuse open browser (${e.message}), relaunching...`);
        killPid(state.pid);
      }
    } else {
      console.error('[Browser] Open browser idle too long, relaunching...');
      killPid(state.pid);
    }
  }

  if (!browser) {
    removeState();
    cleanOldCache(USER_DATA_DIR);

    console.error('[Browser] Launching browser...');
    const { pid, wsEndpoint } = await launchDetachedChrome();
    browser = await withTimeout(
      puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null }),
      10000,
      'Connect timeout'
    );
    writeState({ pid, wsEndpoint });
    startWatchdog(pid);
    launched = true;
  }

  writeState({ lastUsed: Date.now(), busyPid: process.pid });

  // Handle browser disconnection
  browser.on('disconnected', () => {
    console.error('[Browser] Browser disconnected unexpectedly');
    browser = null;
    sessionPage = null;
    _s = 0;
  });

  console.error('[Browser] Browser ready with persistent session');
  return launched;
}

/**
 * What's blocking the javlibrary page, if anything: 'cloudflare',
 * 'adult' (age agreement), 'unknown' (not a recognizable javlibrary page)
 * or null when the page is usable as-is.
 */
async function detectBlocker(page) {
  try {
    return await page.evaluate(() => {
      if (/just a moment|attention required/i.test(document.title || '')) return 'cloudflare';
      if (document.querySelector('#challenge-form, #challenge-running, .cf-turnstile, iframe[src*="challenges.cloudflare.com"]')) return 'cloudflare';
      const adult = document.querySelector('#adultwarningprompt, .btnAdultAgree, #btnAdultAgree');
      if (adult && adult.offsetParent !== null) return 'adult';
      if (!document.querySelector('#idsearchbox, form[action*="vl_searchbyid"], a[href*="vl_searchbyid"]')) return 'unknown';
      return null;
    });
  } catch (_) {
    return 'unknown';
  }
}

async function askUserToUnblock() {
  console.error('[Browser] ========================================');
  console.error('[Browser] Browser window is now open.');
  console.error('[Browser] Please:');
  console.error('[Browser]   1. Solve any Cloudflare challenges');
  console.error('[Browser]   2. Accept the adult agreement');
  console.error('[Browser]   3. Click "Continue" when ready');
  console.error('[Browser] ========================================');

  // Wait for user confirmation via WebSocket
  // The message key will be translated by the frontend i18n system
  const confirmed = await waitForUserConfirmation('javlibraryCloudflare');
  if (!confirmed) {
    throw new Error('User canceled browser initialization');
  }
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
        cleanup();
        resolve(response.response === true);
      } catch (error) {
        console.error(`[Browser] Error parsing response: ${error.message}`);
        cleanup();
        resolve(false);
      }
    };

    // Poll the page: as soon as the usable javlibrary page shows up, go on
    // without waiting for the click and tell the UI to close the dialog.
    const poll = setInterval(async () => {
      if (!sessionPage || await detectBlocker(sessionPage) !== null) return;
      cleanup();
      console.error('[Browser] JavLibrary page detected, continuing automatically');
      console.log('__PROMPT_DONE__');
      resolve(true);
    }, 2000);

    const cleanup = () => {
      clearInterval(poll);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

/**
 * Initialize session: reuse/launch the browser and ask the user to solve
 * Cloudflare only when the homepage is actually blocked.
 */
async function initSession() {
  const launched = await initBrowser();

  const pages = await browser.pages();
  sessionPage = pages[0] || await browser.newPage();

  // Disable the HTTP cache for this page's whole lifetime so every navigation
  // reflects the real Cloudflare state (equivalent to always doing ctrl+F5),
  // instead of a stale cached page making it look like the challenge already passed.
  // Per-connection setting, so it's re-applied on every reconnect.
  try {
    await sessionPage.setCacheEnabled(false);
  } catch (cacheError) {
    console.error('[Browser] Could not disable cache (not critical):', cacheError.message);
  }

  console.error('[Browser] Opening javlibrary homepage...');
  await sessionPage.goto('https://www.javlibrary.com/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (launched) {
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
  }

  const blocker = await detectBlocker(sessionPage);
  if (!blocker) {
    console.error('[Browser] Session still valid, no confirmation needed');
    return;
  }

  console.error(`[Browser] Page blocked (${blocker}), waiting for user...`);
  await askUserToUnblock();
  console.error('[Browser] Session initialized, browser will stay open');
}

/**
 * Fetch page content using the shared session page
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} HTML content
 */
async function fetchPage(url) {
  // Reuse the same page/tab from initSession - don't create new ones
  if (!sessionPage || !browser || !browser.isConnected()) {
    console.error('[JavLibrary Scrape] Browser disconnected, reinitializing...');
    await initSession();
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

    // Cloudflare can come back mid-session: let the user solve it, then retry once.
    if (await detectBlocker(sessionPage) === 'cloudflare') {
      console.error('[JavLibrary Scrape] Cloudflare challenge detected, waiting for user...');
      await askUserToUnblock();
      await sessionPage.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    }

    const html = await sessionPage.content();
    _s++; // Increment counter
    writeState({ lastUsed: Date.now() });

    console.error('[JavLibrary Scrape] Page fetched successfully');
    return html;

  } catch (error) {
    // Check for browser disconnection errors
    const isDisconnected = error.message.includes('Target closed') ||
                          error.message.includes('Session closed') ||
                          error.message.includes('Protocol error') ||
                          error.message.includes('Connection closed') ||
                          !browser ||
                          !browser.isConnected();

    if (isDisconnected) {
      console.error('[JavLibrary Scrape] Browser disconnected during fetch, attempting recovery...');
      try {
        // Reset state
        browser = null;
        sessionPage = null;
        _s = 0;

        // Reinitialize
        await initSession();
        console.error('[JavLibrary Scrape] Recovery successful, retrying fetch...');
        return await fetchPage(url); // Retry once
      } catch (retryError) {
        console.error(`[JavLibrary Scrape] Recovery failed: ${retryError.message}`);
        throw retryError;
      }
    }

    console.error(`[JavLibrary Scrape] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Detach from the shared browser without closing it, so the next scrape
 * can reuse it. The watchdog closes it after IDLE_MS of inactivity.
 */
async function releaseBrowser() {
  if (!browser) return;
  writeState({ lastUsed: Date.now(), busyPid: null });
  try {
    browser.removeAllListeners('disconnected');
    await browser.disconnect();
    console.error('[Browser] Detached from browser (left open for reuse)');
  } catch (error) {
    console.error(`[Browser] Error detaching from browser: ${error.message}`);
  } finally {
    browser = null;
    sessionPage = null;
    _s = 0;
  }
}

/**
 * Close the shared browser for good
 */
async function closeBrowser() {
  const state = readState();
  if (browser) {
    browser.removeAllListeners('disconnected');
    try { await browser.disconnect(); } catch (_) {}
  }
  if (state) killPid(state.pid);
  removeState();
  browser = null;
  sessionPage = null;
  _s = 0;
}

module.exports = {
  initSession,
  fetchPage,
  releaseBrowser,
  closeBrowser
};
