#!/usr/bin/env node

/**
 * ScraperManager
 *
 * Orchestrates multiple video scrapers and merges their JSON outputs.
 * - Reads DVD IDs from library path (file names up to first space)
 * - Executes enabled scrapers sequentially
 * - Merges results based on priority rules
 * - Saves individual JSON files to data/scrape/{id}.json
 * - Emits events for real-time progress updates and interactive prompts
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { loadConfig, getScrapePath } = require('./config');

// ─────────────────────────────
// Configuration Loading
// ─────────────────────────────
// Using centralized config from config.js
// getScrapePath() is now imported from config.js and always returns data/scrape

// ─────────────────────────────
// Library Reading
// ─────────────────────────────

/**
 * Extract DVD codes from library path
 * - Reads ONLY video files in the root of libraryPath (NOT recursive)
 * - Extracts ID from filename (everything before first space or entire name if no space)
 * - Supported video extensions: .mp4, .mkv, .avi, .wmv, .mov, .flv, .m4v, .ts
 * - Used to find video files that need to be scraped
 *
 * @param {string} libraryPath - Path to library directory containing video files
 * @returns {string[]} - Array of unique DVD codes
 */
function extractCodesFromLibrary(libraryPath) {
  if (!fs.existsSync(libraryPath)) {
    throw new Error(`Library path not found: ${libraryPath}`);
  }

  const items = fs.readdirSync(libraryPath);
  const codes = new Set();

  // Video file extensions to look for
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.m4v', '.ts', '.mpg', '.mpeg'];

  items.forEach(item => {
    // Skip hidden files and directories
    if (item.startsWith('.')) {
      return;
    }

    const itemPath = path.join(libraryPath, item);
    const stats = fs.statSync(itemPath);

    // Skip directories - we only want video files in the root
    if (stats.isDirectory()) {
      return;
    }

    // Check if it's a video file
    const ext = path.extname(item).toLowerCase();
    if (!videoExtensions.includes(ext)) {
      return;
    }

    // Extract code from filename (up to first space)
    const spaceIndex = item.indexOf(' ');
    const code = spaceIndex === -1 ? item : item.substring(0, spaceIndex);

    // Remove file extension
    const codeWithoutExt = code.replace(/\.[^.]+$/, '');

    if (codeWithoutExt) {
      codes.add(codeWithoutExt);
    }
  });

  return Array.from(codes);
}

// ─────────────────────────────
// Scraper Execution
// ─────────────────────────────

/**
 * Execute a single scraper for given codes
 * Returns the JSON output from stdout
 *
 * INTERACTIVE SCRAPER SUPPORT:
 * - Scrapers can be interactive (e.g., require user input, open browser)
 * - stderr is captured and emitted as progress events
 * - stdout is captured for JSON parsing
 * - Emits 'progress' events for real-time feedback
 * - Emits 'scraperError' events when scraper fails
 * - Supports interactive prompts via 'prompt' events
 *
 * @param {string} scraperName - Name of the scraper
 * @param {string[]} codes - Array of DVD codes to scrape
 * @param {EventEmitter} emitter - Event emitter for progress updates (optional)
 * @returns {Promise<object[]>} - Parsed JSON array from scraper stdout
 */
function executeScraper(scraperName, codes, emitter = null) {
  return new Promise((resolve, reject) => {
    // Scrapers are now in scrapers/movies/ subdirectory
    const scraperPath = path.join(__dirname, '../../scrapers/movies', scraperName, 'run.js');

    // Check if scraper exists
    if (!fs.existsSync(scraperPath)) {
      const message = `Scraper not found: ${scraperPath}`;
      console.error(`[ScraperManager] ${message}`);
      if (emitter) emitter.emit('scraperError', { scraperName, message });
      // Return minimal results for all codes
      resolve(codes.map(code => ({ code })));
      return;
    }

    const message = `Executing scraper: ${scraperName}`;
    console.error(`[ScraperManager] ${message}`);
    console.error(`[ScraperManager] Codes: ${codes.join(', ')}`);
    if (emitter) emitter.emit('progress', { message: `${message} for ${codes.join(', ')}` });

    // Spawn scraper process
    // - stdin: 'pipe' -> can send interactive responses
    // - stdout: 'pipe' -> capture JSON output for parsing
    // - stderr: 'pipe' -> capture progress messages and emit them
    const child = spawn('node', [scraperPath, ...codes], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stdoutBuffer = '';

    // Collect stdout and handle interactive prompts
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdoutBuffer += chunk;

      // Check for interactive prompt messages (format: __PROMPT__:{"type":"confirm","message":"..."})
      let promptMatch;
      while ((promptMatch = stdoutBuffer.match(/__PROMPT__:(.+)\n/)) !== null) {
        try {
          const promptData = JSON.parse(promptMatch[1]);

          // Remove prompt from buffer
          stdoutBuffer = stdoutBuffer.replace(/__PROMPT__:.+\n/, '');

          // Emit prompt event and wait for response
          if (emitter) {
            emitter.emit('prompt', {
              scraperName,
              promptType: promptData.type || 'confirm',
              message: promptData.message || 'Waiting for user action...',
              callback: (response) => {
                // Send response to scraper via stdin
                if (child.stdin.writable) {
                  child.stdin.write(JSON.stringify({ response }) + '\n');
                }
              }
            });
          } else {
            // No emitter - send automatic confirmation (for CLI mode)
            if (child.stdin.writable) {
              child.stdin.write(JSON.stringify({ response: true }) + '\n');
            }
          }
        } catch (error) {
          console.error(`[ScraperManager] Error parsing prompt: ${error.message}`);
          break;
        }
      }

      // Accumulate non-prompt content for final JSON parsing
      // (stdoutBuffer now only contains non-prompt data after the while loop)
      stdout = stdoutBuffer;
    });

    // Capture stderr (progress logs) and emit as events
    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        console.error(line);
        if (emitter) emitter.emit('progress', { message: line });
      });
    });

    // Handle process exit
    child.on('close', async (code) => {
      if (code !== 0) {
        const message = `Scraper ${scraperName} exited with code ${code}`;
        console.error(`[ScraperManager] ${message}`);

        // Ask user if they want to continue (via emitter callback)
        if (emitter) {
          const shouldContinue = await new Promise((resolvePrompt) => {
            emitter.emit('scraperError', {
              scraperName,
              exitCode: code,
              message,
              callback: resolvePrompt  // Callback per ricevere risposta utente
            });
          });

          if (!shouldContinue) {
            // User chose to stop - reject to stop scraping
            reject(new Error(`Scraping stopped by user after ${scraperName} failed`));
            return;
          }
        }

        // Return minimal results if user chose to continue
        resolve(codes.map(c => ({ code: c })));
        return;
      }

      // Parse JSON output
      try {
        const results = JSON.parse(stdout);
        const message = `Scraper ${scraperName} completed successfully`;
        console.error(`[ScraperManager] ${message}`);
        if (emitter) emitter.emit('progress', { message });
        resolve(Array.isArray(results) ? results : [results]);
      } catch (error) {
        const message = `Failed to parse JSON from ${scraperName}: ${error.message}`;
        console.error(`[ScraperManager] ${message}`);

        // Ask user if they want to continue
        if (emitter) {
          const shouldContinue = await new Promise((resolvePrompt) => {
            emitter.emit('scraperError', {
              scraperName,
              message,
              callback: resolvePrompt
            });
          });

          if (!shouldContinue) {
            reject(new Error(`Scraping stopped by user after ${scraperName} failed to parse JSON`));
            return;
          }
        }

        resolve(codes.map(c => ({ code: c })));
      }
    });

    // Handle process error
    child.on('error', async (error) => {
      const message = `Failed to execute ${scraperName}: ${error.message}`;
      console.error(`[ScraperManager] ${message}`);

      // Ask user if they want to continue
      if (emitter) {
        const shouldContinue = await new Promise((resolvePrompt) => {
          emitter.emit('scraperError', {
            scraperName,
            message,
            callback: resolvePrompt
          });
        });

        if (!shouldContinue) {
          reject(new Error(`Scraping stopped by user after ${scraperName} failed to execute`));
          return;
        }
      }

      resolve(codes.map(c => ({ code: c })));
    });
  });
}

// ─────────────────────────────
// Data Merging
// ─────────────────────────────
//
// NOTE: Scrapers return data in standard format (see schema.js).
// ScraperManager keeps all fields (even empty ones) to match WebUI expectations.

/**
 * Get priority order for a specific field
 *
 * @param {string} fieldName - Name of the field
 * @param {object} config - Configuration object
 * @returns {string[]} - Ordered list of scraper names for this field
 */
function getFieldPriority(fieldName, config) {
  // Check if field has explicit priority
  if (config.fieldPriorities && config.fieldPriorities[fieldName]) {
    return config.fieldPriorities[fieldName];
  }

  // Use global scraper order as fallback (new structure: config.scrapers.video)
  return (config.scrapers && config.scrapers.video) ? config.scrapers.video : [];
}

/**
 * Merge data from multiple scrapers for a single DVD code
 *
 * For each field, uses priority order from fieldPriorities (if configured)
 * or default scraper order. Picks the first non-empty value from scrapers
 * in priority order.
 *
 * @param {string} code - DVD code
 * @param {object[]} scraperResults - Array of {scraperName, data} objects
 * @param {object} config - Configuration object
 * @returns {object} - Merged object with all schema fields
 */
function mergeResults(code, scraperResults, config) {
  // Import schema to ensure all fields are present
  const { createEmptyMovie } = require('../../scrapers/movies/schema');

  // Start with empty movie structure (all fields present with defaults)
  const merged = createEmptyMovie(code);

  // Collect all available fields from all scrapers
  const allFields = new Set();
  scraperResults.forEach(({ data }) => {
    Object.keys(data).forEach(field => {
      // Skip internal fields and error field (but keep contentId)
      if (field !== 'code' && field !== 'dvd_id' && field !== 'id' && field !== 'error') {
        allFields.add(field);
      }
    });
  });

  // For each field, select value based on priority
  allFields.forEach(fieldName => {
    const priority = getFieldPriority(fieldName, config);

    // Find first scraper in priority order that provides a non-empty value
    for (const scraperName of priority) {
      const scraperResult = scraperResults.find(r => r.scraperName === scraperName);

      if (scraperResult && scraperResult.data[fieldName] !== undefined) {
        const value = scraperResult.data[fieldName];

        // Check if value is non-empty
        const isEmpty = value === null ||
                       value === '' ||
                       (Array.isArray(value) && value.length === 0) ||
                       (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

        if (!isEmpty) {
          merged[fieldName] = value;
          break; // Found non-empty value, stop looking
        }
      }
    }
  });

  // Ensure 'id' matches 'code' (schema requirement)
  merged.id = code;

  // Return merged result with full schema (all fields present)
  return merged;
}

// ─────────────────────────────
// File Saving
// ─────────────────────────────
//
// NOTE: Scrapers are now responsible for returning data in standard format.
// See scrapers/movies/schema.js for the expected format.
// ScraperManager no longer performs field name normalization.

/**
 * Save scraped data to data/scrape/{code}.json with wrapper structure
 *
 * @param {string} code - DVD code
 * @param {object} data - Scraped and merged data
 * @param {string[]} sources - List of scraper names used
 * @param {string} libraryPath - Path to library directory
 */
function saveToFile(code, data, sources, libraryPath) {
  const outputDir = getScrapePath();

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Find video file in library (recursively search subdirectories)
  let videoFile = '';
  if (libraryPath && fs.existsSync(libraryPath)) {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.m4v', '.ts', '.mpg', '.mpeg'];

    function findVideoRecursive(dirPath) {
      let items;
      try {
        items = fs.readdirSync(dirPath);
      } catch (error) {
        console.error(`[ScraperManager] Cannot read directory ${dirPath}: ${error.message}`);
        return null;
      }

      for (const item of items) {
        if (item.startsWith('.')) continue;

        const itemPath = path.join(dirPath, item);
        let stats;

        try {
          stats = fs.statSync(itemPath);
        } catch (error) {
          // Skip files we can't access (Windows permissions/locks)
          continue;
        }

        if (stats.isDirectory()) {
          const found = findVideoRecursive(itemPath);
          if (found) return found;
        } else {
          const ext = path.extname(item).toLowerCase();
          if (videoExtensions.includes(ext)) {
            const fileCode = item.split(' ')[0].replace(/\.[^.]+$/, '');
            if (fileCode.toLowerCase() === code.toLowerCase()) {
              return itemPath;
            }
          }
        }
      }
      return null;
    }

    videoFile = findVideoRecursive(libraryPath) || '';
  }

  // Create wrapper structure matching WebUI expected format
  // Scrapers already return data in standard format (see schema.js)
  const wrappedData = {
    scrapedAt: new Date().toISOString(),
    sources: sources || [],
    videoFile: videoFile,
    data: data
  };

  const outputPath = path.join(outputDir, `${code}.json`);

  try {
    fs.writeFileSync(outputPath, JSON.stringify(wrappedData, null, 2), 'utf-8');
    console.error(`[ScraperManager] Saved: ${outputPath}`);
  } catch (error) {
    console.error(`[ScraperManager] ERROR saving ${code}.json: ${error.message}`);
    console.error(`[ScraperManager] Error details:`, error);
    throw error; // Re-throw to make the error visible
  }
}

// ─────────────────────────────
// Main Orchestration
// ─────────────────────────────

/**
 * Main scraping function
 *
 * @param {string[]} codes - Array of DVD codes to scrape
 * @param {EventEmitter} emitter - Event emitter for progress updates (optional)
 * @returns {Promise<object[]>} - Array of merged results
 */
async function scrapeAll(codes, emitter = null) {
  const config = loadConfig();

  // Get list of enabled scrapers (new structure: config.scrapers.video)
  const enabledScrapers = (config.scrapers && config.scrapers.video) ? config.scrapers.video : [];

  if (enabledScrapers.length === 0) {
    const message = 'No scrapers enabled in config.json';
    console.error(`[ScraperManager] ${message}`);
    if (emitter) emitter.emit('error', { message });
    return codes.map(code => ({ code }));
  }

  const message = `Enabled scrapers: ${enabledScrapers.join(', ')}`;
  console.error(`[ScraperManager] ${message}`);
  console.error(`[ScraperManager] Scraping ${codes.length} code(s): ${codes.join(', ')}`);
  if (emitter) emitter.emit('start', {
    message: `Starting scrape for ${codes.length} code(s)`,
    scrapers: enabledScrapers,
    codes
  });

  // Execute all enabled scrapers sequentially
  const scraperOutputs = [];

  for (const scraperName of enabledScrapers) {
    const results = await executeScraper(scraperName, codes, emitter);
    scraperOutputs.push({
      scraperName,
      results
    });
  }

  // Group results by code
  const resultsByCode = {};

  codes.forEach(code => {
    resultsByCode[code] = [];
  });

  // Collect data from each scraper for each code
  scraperOutputs.forEach(({ scraperName, results }) => {
    results.forEach(data => {
      // Match by code or dvd_id field
      const code = data.code || data.dvd_id;

      // Normalize: ensure data has 'code' field
      if (!data.code && data.dvd_id) {
        data.code = data.dvd_id;
      }

      // Find matching code (case-insensitive)
      const matchingCode = codes.find(c => c.toUpperCase() === (code || '').toUpperCase());

      if (matchingCode && resultsByCode[matchingCode]) {
        resultsByCode[matchingCode].push({
          scraperName,
          data
        });
      }
    });
  });

  // Merge results for each code and save to files
  const finalResults = [];

  for (const code of codes) {
    const scraperResults = resultsByCode[code] || [];
    const merged = mergeResults(code, scraperResults, config);

    // Only save if we have valid data (not just code/id fields)
    // Check for meaningful data beyond just id/code
    const hasValidData = merged.title || merged.studio || merged.releaseDate ||
                         (merged.actor && merged.actor.length > 0) ||
                         (merged.genres && merged.genres.length > 0);

    if (hasValidData) {
      // Collect which scrapers provided data for this code
      const usedScrapers = scraperResults.map(r => r.scraperName);

      // Save to file with wrapper structure
      saveToFile(code, merged, usedScrapers, config.libraryPath);
    } else {
      console.error(`[ScraperManager] Skipping save for ${code}: no valid data`);
    }

    finalResults.push(merged);
  }

  // Note: Actor scraping is now handled in routes.js, not here
  // This allows better control over the completion flow
  return finalResults;
}

// ─────────────────────────────
// CLI Entry Point
// ─────────────────────────────

async function main() {
  try {
    const config = loadConfig();

    // Extract codes from library path
    const libraryPath = config.libraryPath;

    if (!libraryPath) {
      throw new Error('libraryPath not specified in config.json');
    }

    console.error(`[ScraperManager] Reading library: ${libraryPath}`);

    const codes = extractCodesFromLibrary(libraryPath);

    if (codes.length === 0) {
      console.error('[ScraperManager] No files found in library');
      process.exit(0);
    }

    console.error(`[ScraperManager] Found ${codes.length} file(s) to scrape`);

    // Filter out already scraped codes
    const outputDir = getScrapePath();
    const codesToScrape = codes.filter(code => {
      const jsonPath = path.join(outputDir, `${code}.json`);
      const exists = fs.existsSync(jsonPath);
      if (exists) {
        console.error(`[ScraperManager] Skipping ${code} - already scraped`);
      }
      return !exists;
    });

    if (codesToScrape.length === 0) {
      console.error('[ScraperManager] All files already scraped. Nothing to do.');
      process.exit(0);
    }

    console.error(`[ScraperManager] Scraping ${codesToScrape.length} new file(s), skipped ${codes.length - codesToScrape.length}`);

    // Execute scraping
    const results = await scrapeAll(codesToScrape);

    console.error(`[ScraperManager] Completed. Saved ${results.length} JSON file(s) to data/scrape/`);

  } catch (error) {
    console.error(`[ScraperManager] Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = { scrapeAll, extractCodesFromLibrary, executeScraper, mergeResults };
