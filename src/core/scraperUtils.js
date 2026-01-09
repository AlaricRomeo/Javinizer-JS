/**
 * Scraper Utilities
 *
 * Common utilities for scraper error handling and user interactions
 */

/**
 * Handle scraper error with optional user interaction
 *
 * @param {string} scraperName - Name of the scraper
 * @param {string} message - Error message
 * @param {EventEmitter} emitter - Event emitter for progress updates (optional)
 * @returns {Promise<boolean>} - True if user wants to continue, false to stop
 */
async function handleScraperError(scraperName, message, emitter = null) {
  console.error(`[ScraperManager] ${message}`);

  if (emitter) {
    return await new Promise((resolve) => {
      emitter.emit('scraperError', {
        scraperName,
        message,
        callback: resolve
      });
    });
  }

  // No emitter - default to not continuing
  return false;
}

/**
 * Handle process exit with error checking
 *
 * @param {number} code - Exit code
 * @param {string} scraperName - Name of the scraper
 * @param {EventEmitter} emitter - Event emitter (optional)
 * @returns {Promise<boolean>} - True if should continue, false to stop
 */
async function handleProcessExit(code, scraperName, emitter = null) {
  if (code !== 0) {
    const message = `Scraper ${scraperName} exited with code ${code}`;
    return await handleScraperError(scraperName, message, emitter);
  }
  return true;
}

/**
 * Parse JSON output with error handling
 *
 * @param {string} stdout - Standard output to parse
 * @param {string} scraperName - Name of the scraper
 * @param {EventEmitter} emitter - Event emitter (optional)
 * @returns {Promise<{success: boolean, data: Array|null}>}
 */
async function parseScraperOutput(stdout, scraperName, emitter = null) {
  try {
    const results = JSON.parse(stdout);
    const message = `Scraper ${scraperName} completed successfully`;
    console.error(`[ScraperManager] ${message}`);

    if (emitter) {
      emitter.emit('progress', { message });
    }

    return {
      success: true,
      data: Array.isArray(results) ? results : [results]
    };
  } catch (error) {
    const message = `Failed to parse JSON from ${scraperName}: ${error.message}`;
    const shouldContinue = await handleScraperError(scraperName, message, emitter);

    return {
      success: false,
      data: null,
      shouldContinue
    };
  }
}

/**
 * Create minimal result for failed scraping
 *
 * @param {string|Array<string>} codes - DVD code(s)
 * @returns {Array<Object>} - Minimal results
 */
function createMinimalResults(codes) {
  const codeArray = Array.isArray(codes) ? codes : [codes];
  return codeArray.map(code => ({ code }));
}

module.exports = {
  handleScraperError,
  handleProcessExit,
  parseScraperOutput,
  createMinimalResults
};
