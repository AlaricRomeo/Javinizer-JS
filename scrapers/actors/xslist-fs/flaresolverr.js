/**
 * FlareSolverr client for xslist scraper
 */

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191';
// Use a persistent session so Cloudflare challenge is solved once and reused.
// The detail page ad-redirect is retried up to 3 times since it doesn't always fire.

const SESSION_ID = 'xslist';
let sessionInitialized = false;

const FETCH_TIMEOUT_MS = 90000;

async function callFlareSolverr(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`FlareSolverr HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr error: ${data.message || 'Unknown error'}`);
  }

  return data;
}

async function createSession() {
  if (sessionInitialized) return;
  try {
    await callFlareSolverr({ cmd: 'sessions.create', session: SESSION_ID });
    console.error(`[FlareSolverr/xslist] Session created: ${SESSION_ID}`);
  } catch (error) {
    console.error(`[FlareSolverr/xslist] Session create (might already exist): ${error.message}`);
  }
  sessionInitialized = true;
}

async function fetchWithFlareSolverr(url, retries = 3) {
  await createSession();
  console.error(`[FlareSolverr/xslist] Fetching ${url}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const data = await callFlareSolverr({
      cmd: 'request.get',
      url,
      session: SESSION_ID,
      maxTimeout: 60000
    });

    if (!data.solution) throw new Error('FlareSolverr returned no solution');

    const finalUrl = data.solution.url || '';
    console.error(`[FlareSolverr/xslist] Attempt ${attempt}/${retries} — Final URL: ${finalUrl}`);

    if (finalUrl.includes('xslist.org')) {
      return {
        html: data.solution.response,
        cookies: data.solution.cookies || [],
        userAgent: data.solution.userAgent || ''
      };
    }

    console.error(`[FlareSolverr/xslist] Ad redirect detected (→ ${finalUrl}), retrying...`);
    if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`All ${retries} attempts redirected away from xslist.org`);
}

async function destroySession() {
  if (!sessionInitialized) return;
  try {
    await callFlareSolverr({ cmd: 'sessions.destroy', session: SESSION_ID });
    sessionInitialized = false;
    console.error('[FlareSolverr/xslist] Session destroyed');
  } catch (error) {
    console.error(`[FlareSolverr/xslist] Session destroy failed: ${error.message}`);
  }
}

/**
 * Download an image using cookies obtained from FlareSolverr session
 * @param {string} url - Image URL
 * @param {string} destPath - Local file path to save to
 * @param {Array} cookies - Cookies from a prior fetchWithFlareSolverr call
 */
async function downloadImageWithCookies(url, destPath, cookies = [], userAgent = '') {
  const https = require('https');
  const http = require('http');
  const fs = require('fs');

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  console.error(`[FlareSolverr/xslist] Downloading image: ${url}`);
  console.error(`[FlareSolverr/xslist] Cookies (${cookies.length}): ${cookies.map(c => c.name).join(', ')}`);

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': ua,
        'Referer': 'https://xslist.org/',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImageWithCookies(res.headers.location, destPath, cookies).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', reject);
  });
}

module.exports = { fetchWithFlareSolverr, destroySession, downloadImageWithCookies };
