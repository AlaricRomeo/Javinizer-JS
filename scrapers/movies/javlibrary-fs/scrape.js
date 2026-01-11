/**
 * Main scraping logic for javlibrary-fs
 * Uses FlareSolverr instead of Puppeteer
 */

const { fetchWithFlareSolverr, destroySession } = require('./flaresolverr');
const { parseHTML } = require('./parse');

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
  console.error(`[JavLibrary-FS Scrape] Starting scrape for: ${code}`);

  try {
    const url = buildUrl(code);
    let html = await fetchWithFlareSolverr(url);

    console.error('[JavLibrary-FS Scrape] Parsing HTML...');
    let result = parseHTML(html, code);

    // If we got a redirect (multiple results, taking first one)
    if (result.needsRedirect) {
      console.error(`[JavLibrary-FS Scrape] Multiple results found, following first result: ${result.needsRedirect}`);
      html = await fetchWithFlareSolverr(result.needsRedirect);
      result = parseHTML(html, code);

      // If still redirecting, something is wrong
      if (result.needsRedirect) {
        console.error('[JavLibrary-FS Scrape] Redirect loop detected, aborting');
        return { code };
      }
    }

    console.error('[JavLibrary-FS Scrape] Scrape completed successfully');
    return result;

  } catch (error) {
    console.error(`[JavLibrary-FS Scrape] Failed: ${error.message}`);
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
    console.error(`[JavLibrary-FS Scrape] Warning: Limiting to first 100 codes (provided: ${codes.length})`);
    codes = codes.slice(0, 100);
  }

  console.error(`[JavLibrary-FS Scrape] Starting batch scrape for ${codes.length} code(s)`);

  const results = [];

  try {
    // Scrape all codes using FlareSolverr with persistent session
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      console.error(`[JavLibrary-FS Scrape] Processing ${i + 1}/${codes.length}: ${code}`);

      try {
        const result = await scrapeSingle(code);
        results.push(result);
      } catch (error) {
        // Don't throw - add error result and continue
        console.error(`[JavLibrary-FS Scrape] Failed: ${error.message}`);
        results.push({ code, error: error.message });
      }

      // Small delay between requests to be respectful
      if (i < codes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.error(`[JavLibrary-FS Scrape] Batch scrape completed: ${results.length} results`);
    return results;

  } finally {
    // Clean up session after scraping
    await destroySession();
  }
}

module.exports = {
  scrape,
  scrapeSingle
};
