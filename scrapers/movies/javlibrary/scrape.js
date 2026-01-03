/**
 * Main scraping logic for javlibrary
 */

const { initSession, fetchPage, closeBrowser } = require('./browser');
const { parseHTML } = require('./parse');

let sessionInitialized = false;

/**
 * Build javlibrary URL from code
 * @param {string} code - Movie code (e.g., "SDDM-943")
 * @returns {string} Full URL
 */
function buildUrl(code) {
  // javlibrary uses format like: https://www.javlibrary.com/en/?v=javli6qcvo
  // We need to search first or use direct code format
  // For simplicity, we'll use the search approach or direct format
  // javlibrary direct format example: https://www.javlibrary.com/en/?v=javlixxxxx

  // Most reliable: use search URL
  const searchCode = code.toUpperCase();
  return `https://www.javlibrary.com/en/vl_searchbyid.php?keyword=${searchCode}`;
}

/**
 * Scrape metadata for a single code
 * @param {string} code - Movie code
 * @returns {Promise<object>} Partial canonical object
 */
async function scrapeSingle(code) {
  console.error(`[Scrape] Starting scrape for: ${code}`);

  try {
    const url = buildUrl(code);
    let html = await fetchPage(url);

    console.error('[Scrape] Parsing HTML...');
    let result = parseHTML(html, code);

    // If we got a redirect (multiple results, taking first one)
    if (result.needsRedirect) {
      console.error(`[Scrape] Multiple results found, following first result: ${result.needsRedirect}`);
      html = await fetchPage(result.needsRedirect);
      result = parseHTML(html, code);

      // If still redirecting, something is wrong
      if (result.needsRedirect) {
        console.error('[Scrape] Redirect loop detected, aborting');
        return { code };
      }
    }

    console.error('[Scrape] Scrape completed successfully');
    return result;

  } catch (error) {
    console.error(`[Scrape] Failed: ${error.message}`);
    // On failure, return minimal object with just code
    return { code };
  }
}

/**
 * Scrape metadata for multiple codes
 * @param {string[]} codes - Array of movie codes (max 100)
 * @returns {Promise<object[]>} Array of partial canonical objects
 */
async function scrape(codes) {
  // Ensure codes is an array
  if (!Array.isArray(codes)) {
    codes = [codes];
  }

  // Limit to 100 codes
  if (codes.length > 100) {
    console.error(`[Scrape] Warning: Limiting to first 100 codes (provided: ${codes.length})`);
    codes = codes.slice(0, 100);
  }

  console.error(`[Scrape] Starting batch scrape for ${codes.length} code(s)`);

  const results = [];

  try {
    // Initialize session once if not already done
    if (!sessionInitialized) {
      console.error('[Scrape] Initializing session (solve Cloudflare challenge once)...');
      await initSession();
      sessionInitialized = true;
    }

    // Now scrape all codes using the saved session
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      console.error(`[Scrape] Processing ${i + 1}/${codes.length}: ${code}`);

      try {
        const result = await scrapeSingle(code);
        results.push(result);
      } catch (error) {
        if (error.code === 'SESSION_LIMIT') {
          console.error('[Scrape] Session limit reached. Please restart to continue.');
          // Add remaining codes as failed
          for (let j = i; j < codes.length; j++) {
            results.push({ code: codes[j], error: 'Session limit reached' });
          }
          break;
        }
        // Don't throw - add error result and continue
        console.error(`[Scrape] Failed: ${error.message}`);
        results.push({ code, error: error.message });
      }

      // Small delay between requests to be respectful
      if (i < codes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.error(`[Scrape] Batch scrape completed: ${results.length} results`);
    return results;

  } finally {
    await closeBrowser();
  }
}

module.exports = {
  scrape,
  scrapeSingle
};
