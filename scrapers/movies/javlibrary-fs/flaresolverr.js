/**
 * FlareSolverr client for javlibrary-fs scraper
 * Handles Cloudflare protection via FlareSolverr with persistent session
 */

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191';
const SESSION_ID = 'javlibrary-fs';

// Minimum gap between two page loads (+ random jitter): bursts
// (search -> movie -> Japanese page) get us Cloudflare 1015.
const MIN_GAP_MS = 3000;
const JITTER_MS = 1500;
const RATE_LIMIT_WAIT_MS = 10000; // Pause before retrying a 1015-blocked page

let sessionInitialized = false;
let lastFetch = 0;

async function throttle() {
  const wait = lastFetch + MIN_GAP_MS + Math.random() * JITTER_MS - Date.now();
  if (wait > 0) {
    console.error(`[FlareSolverr] Waiting ${(wait / 1000).toFixed(1)}s before next request...`);
    await new Promise(res => setTimeout(res, wait));
  }
  lastFetch = Date.now();
}

/**
 * Make a request to FlareSolverr
 * @param {object} payload - FlareSolverr request payload
 * @returns {Promise<object>} FlareSolverr response
 */
async function callFlareSolverr(payload) {
  try {
    const response = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`FlareSolverr HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`FlareSolverr error: ${data.message || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    console.error(`[FlareSolverr] Request failed: ${error.message}`);
    throw error;
  }
}

/**
 * Create a persistent session for javlibrary
 * @returns {Promise<void>}
 */
async function createSession() {
  if (sessionInitialized) {
    return;
  }

  console.error('[FlareSolverr] Creating persistent session...');

  try {
    await callFlareSolverr({
      cmd: 'sessions.create',
      session: SESSION_ID
    });

    sessionInitialized = true;
    console.error(`[FlareSolverr] Session created: ${SESSION_ID}`);
  } catch (error) {
    // Session might already exist, try to reuse it
    console.error(`[FlareSolverr] Session creation failed (might already exist): ${error.message}`);
    sessionInitialized = true;
  }
}

/**
 * Fetch a page using FlareSolverr with persistent session
 * @param {string} url - URL to fetch
 * @param {object} headers - Optional headers
 * @param {boolean} retried - Already retried after a 1015 block
 * @returns {Promise<string>} HTML content
 */
async function fetchWithFlareSolverr(url, headers = {}, retried = false) {
  // Ensure session exists
  await createSession();
  await throttle();

  console.error(`[FlareSolverr] Fetching ${url}...`);

  const payload = {
    cmd: 'request.get',
    url: url,
    session: SESSION_ID,
    maxTimeout: 60000
  };

  // Add headers if provided
  if (headers && Object.keys(headers).length > 0) {
    payload.headers = headers;
  }

  try {
    const data = await callFlareSolverr(payload);

    if (!data.solution) {
      throw new Error('FlareSolverr returned no solution');
    }

    // Cloudflare 1015: the site banned us for a while. Wait and retry once,
    // then stop the batch instead of reading every page as "not found".
    const html = data.solution.response || '';
    if (/error 1015|you are being rate limited/i.test(html)) {
      if (!retried) {
        console.error(`[FlareSolverr] Rate limited (Cloudflare 1015), retrying in ${RATE_LIMIT_WAIT_MS / 1000}s...`);
        await new Promise(res => setTimeout(res, RATE_LIMIT_WAIT_MS));
        return await fetchWithFlareSolverr(url, headers, true);
      }
      const e = new Error('Rate limited by JavLibrary (Cloudflare 1015)');
      e.code = 'RATE_LIMITED';
      throw e;
    }

    console.error('[FlareSolverr] Page fetched successfully');
    return html;
  } catch (error) {
    console.error(`[FlareSolverr] Fetch failed: ${error.message}`);
    throw error;
  }
}

/**
 * Destroy the persistent session
 * @returns {Promise<void>}
 */
async function destroySession() {
  if (!sessionInitialized) {
    return;
  }

  console.error('[FlareSolverr] Destroying session...');

  try {
    await callFlareSolverr({
      cmd: 'sessions.destroy',
      session: SESSION_ID
    });

    sessionInitialized = false;
    console.error('[FlareSolverr] Session destroyed');
  } catch (error) {
    console.error(`[FlareSolverr] Session destruction failed: ${error.message}`);
  }
}

module.exports = {
  fetchWithFlareSolverr,
  createSession,
  destroySession
};
