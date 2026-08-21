/**
 * FlareSolverr client for the xslist-fs actor scraper
 * Handles Cloudflare protection via FlareSolverr with a persistent session
 */

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191';
const SESSION_ID = 'xslist-fs';

let sessionInitialized = false;

// Cloudflare clearance cookies + the User-Agent FlareSolverr solved the
// challenge with. The image CDN lives on the same domain and is behind the
// same Cloudflare check, so plain https.get() downloads need to replay
// these to avoid a 403 - only the HTML page requests go through the /v1
// proxy itself.
let lastCookies = null;
let lastUserAgent = null;

/**
 * Make a request to FlareSolverr
 * @param {object} payload - FlareSolverr request payload
 * @returns {Promise<object>} FlareSolverr response
 */
async function callFlareSolverr(payload) {
  const response = await fetch(`${FLARESOLVERR_URL}/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
}

/**
 * Create the persistent session for xslist-fs (idempotent - reuses an existing one)
 */
async function createSession() {
  if (sessionInitialized) return;

  console.error('[xslist-fs:FlareSolverr] Creating persistent session...');

  try {
    await callFlareSolverr({ cmd: 'sessions.create', session: SESSION_ID });
    console.error(`[xslist-fs:FlareSolverr] Session created: ${SESSION_ID}`);
  } catch (error) {
    // Session might already exist from a previous run - reuse it
    console.error(`[xslist-fs:FlareSolverr] Session creation failed (might already exist): ${error.message}`);
  }

  sessionInitialized = true;
}

/**
 * Fetch a page using FlareSolverr with the persistent session
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} HTML content
 */
async function fetchWithFlareSolverr(url) {
  await createSession();

  console.error(`[xslist-fs:FlareSolverr] Fetching ${url}...`);

  const data = await callFlareSolverr({
    cmd: 'request.get',
    url,
    session: SESSION_ID,
    maxTimeout: 60000
  });

  if (!data.solution) {
    throw new Error('FlareSolverr returned no solution');
  }

  if (data.solution.cookies) lastCookies = data.solution.cookies;
  if (data.solution.userAgent) lastUserAgent = data.solution.userAgent;

  return data.solution.response;
}

/**
 * Headers to replay Cloudflare clearance on a plain https request to the
 * same domain (e.g. downloading an image). Only meaningful after at least
 * one fetchWithFlareSolverr() call has completed.
 */
function getClearanceHeaders() {
  if (!lastCookies || !lastUserAgent) return null;
  return {
    'User-Agent': lastUserAgent,
    'Cookie': lastCookies.map(c => `${c.name}=${c.value}`).join('; ')
  };
}

/**
 * Destroy the persistent session
 */
async function destroySession() {
  if (!sessionInitialized) return;

  console.error('[xslist-fs:FlareSolverr] Destroying session...');

  try {
    await callFlareSolverr({ cmd: 'sessions.destroy', session: SESSION_ID });
  } catch (error) {
    console.error(`[xslist-fs:FlareSolverr] Session destruction failed: ${error.message}`);
  }

  sessionInitialized = false;
}

module.exports = {
  fetchWithFlareSolverr,
  createSession,
  destroySession,
  getClearanceHeaders
};
