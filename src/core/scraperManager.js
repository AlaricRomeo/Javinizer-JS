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
const { loadConfig, getScrapePath, getLibraryPaths } = require('./config');
const { applyGenreRules } = require('./genreFilter');

// Sentinel value for "scraper" params/dropdowns meaning "run every scraper
// configured in scrapers.video, in priority order, and merge like a normal
// scrape" instead of a single named scraper.
const MULTI_SCRAPER_VALUE = '__all__';

// ─────────────────────────────
// Configuration Loading
// ─────────────────────────────
// Using centralized config from config.js
// getScrapePath() is now imported from config.js and always returns data/scrape

// ─────────────────────────────
// Library Reading
// ─────────────────────────────

// IDs found anywhere in a filename: "ABP-420", "T28-587", "IBW-1010Z"...
const HYPHENATED_ID = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,5})-(\d{2,6}[A-Za-z]?)(?![A-Za-z0-9])/;
// ...or without the hyphen: "abp420" (letters only before the number)
const COMPACT_ID = /(?<![A-Za-z0-9])([A-Za-z]{2,6})(\d{2,6})(?![A-Za-z0-9])/;

/**
 * Movie ID from a video filename.
 * - A filename that starts with something ID-like (letters/digits/hyphens,
 *   with at least one digit) keeps it as-is, up to the first space — any ID
 *   format works there ("ABP-420 1080p.mp4", "010214-514.mp4").
 * - Otherwise the ID is searched anywhere in the name and normalized to
 *   PREFIX-NUMBER: "[site] ABP-420 1080p.mkv", "site.com@ABP-420.mp4",
 *   "[site] abp420.mp4" -> "ABP-420". A hyphenated match wins over a compact
 *   one (in "hhd800.com@ABP-420" the site name "hhd800" is not the ID).
 *
 * @param {string} filename - Video filename (with extension)
 * @returns {string} - Movie ID, or '' if none was found
 */
function extractMovieId(filename) {
  const name = filename.replace(/\.[^.]+$/, '');
  const firstToken = name.split(' ')[0];
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(firstToken) && /\d/.test(firstToken)) {
    return firstToken;
  }

  const match = name.match(HYPHENATED_ID) || name.match(COMPACT_ID);
  return match ? `${match[1]}-${match[2]}`.toUpperCase() : '';
}

/**
 * Extract DVD codes from the library roots
 * - Reads ONLY video files in the root of each library path (NOT recursive)
 * - Extracts the ID from the filename (see extractMovieId)
 * - Supported video extensions: .mp4, .mkv, .avi, .wmv, .mov, .flv, .m4v, .ts
 * - Used to find video files that need to be scraped
 *
 * @param {string[]} libraryPaths - Library roots containing video files
 * @returns {string[]} - Array of unique DVD codes
 */
function extractCodesFromLibrary(libraryPaths) {
  const roots = libraryPaths.filter(root => fs.existsSync(root));
  if (roots.length === 0) {
    throw new Error(`Library path not found: ${libraryPaths.join(', ')}`);
  }

  const codes = new Set();

  // Video file extensions to look for
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.m4v', '.ts', '.mpg', '.mpeg'];

  for (const libraryPath of roots) {
    fs.readdirSync(libraryPath).forEach(item => {
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

      const code = extractMovieId(item);
      if (code) {
        codes.add(code);
      } else {
        console.error(`[ScraperManager] No movie ID found in filename: ${item}`);
      }
    });
  }

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

      // Scraper resolved the prompt on its own: let the UI close the dialog
      if (stdoutBuffer.includes('__PROMPT_DONE__\n')) {
        stdoutBuffer = stdoutBuffer.replace(/__PROMPT_DONE__\n/g, '');
        if (emitter) emitter.emit('promptDone', { scraperName });
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
        const parsed = JSON.parse(stdout);
        const results = Array.isArray(parsed) ? parsed : [parsed];
        const message = `Scraper ${scraperName} completed successfully`;
        console.error(`[ScraperManager] ${message}`);
        if (emitter) emitter.emit('progress', { message });

        // A scraper that fails on a single code still exits 0 and returns
        // just { code } — surface it, or it silently looks like a success.
        codes.forEach(c => {
          const r = results.find(x => x && (x.code || x.dvd_id || '').toUpperCase() === c.toUpperCase());
          if (r && (r.title || r.coverUrl || (Array.isArray(r.actor) && r.actor.length > 0))) return;
          const reason = (r && r.error) || 'no data returned';
          console.error(`[ScraperManager] ${scraperName} found no data for ${c}: ${reason}`);
          if (emitter) emitter.emit('scraperWarning', { scraperName, code: c, reason });
        });

        resolve(results);
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
/**
 * Formats the movie title using the configured pattern (e.g. "{id} {title}")
 * Applied after merge so it's independent of which scraper provided the title.
 */
function formatTitle(item, config) {
  const pattern = (config.scrapeTitlePattern || "{title}").trim() || "{title}";

  const year = item.releaseDate ? item.releaseDate.split("-")[0] : "";
  const values = {
    id: item.id || "",
    contentid: item.contentId || "",
    title: item.title || "",
    alternatetitle: item.alternateTitle || "",
    label: item.label || "",
    maker: item.studio || "",
    year: year
  };

  return pattern.replace(/\{(\w+)\}/g, (match, key) => {
    const lowerKey = key.toLowerCase();
    return values.hasOwnProperty(lowerKey) ? values[lowerKey] : match;
  }).trim();
}

function isEmptyValue(value) {
  return value === null ||
         value === undefined ||
         value === '' ||
         (Array.isArray(value) && value.length === 0) ||
         (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

/**
 * Union of several actor lists, in priority order: one site may know more of
 * the cast than another, so actors are summed, never dropped. Two entries are
 * the same actor when any of their names/alt names match (case-, whitespace-
 * and 2-word-order-insensitive); the first occurrence wins, later ones only
 * fill its empty fields and add alt names.
 *
 * @param {Array<object[]|undefined>} lists - Actor arrays, highest priority first
 * @returns {object[]}
 */
function mergeActors(lists) {
  const { dedupeAltNames } = require('../../scrapers/actors/schema');
  const normalize = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const keysOf = actor => {
    const names = [actor.name, ...(actor.altName || '').split(',')].map(normalize).filter(Boolean);
    const keys = new Set();
    if (actor.id) keys.add(`id:${actor.id}`);
    names.forEach(n => {
      keys.add(n);
      const parts = n.split(' ');
      if (parts.length === 2) keys.add(`${parts[1]} ${parts[0]}`);
    });
    return keys;
  };

  const result = [];
  const resultKeys = [];

  lists.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(actor => {
      if (!actor || !actor.name) return;
      const keys = keysOf(actor);
      const idx = resultKeys.findIndex(existing => [...keys].some(k => existing.has(k)));

      if (idx === -1) {
        result.push({ ...actor });
        resultKeys.push(keys);
        return;
      }

      const target = result[idx];
      Object.keys(actor).forEach(field => {
        if (field !== 'altName' && isEmptyValue(target[field]) && !isEmptyValue(actor[field])) {
          target[field] = actor[field];
        }
      });
      const altNames = [...(target.altName || '').split(','), ...(actor.altName || '').split(','), actor.name]
        .map(s => s.trim()).filter(Boolean);
      target.altName = dedupeAltNames(target.name, altNames).join(', ');
      keys.forEach(k => resultKeys[idx].add(k));
    });
  });

  return result;
}

function mergeResults(code, scraperResults, config) {
  const { createEmptyMovie } = require('../../scrapers/movies/schema');
  const merged = createEmptyMovie(code);

  const globalOrder = (config.scrapers && config.scrapers.video) ? config.scrapers.video : [];

  // Primary scraper = first in global order that actually returned results
  const primaryName = globalOrder.find(name => scraperResults.some(r => r.scraperName === name));
  const primaryResult = primaryName ? scraperResults.find(r => r.scraperName === primaryName) : null;

  // Actors are summed across scrapers (primary, then fieldPriorities, then the rest)
  const actorPriority = getFieldPriority('actor', config).filter(n => n !== primaryName);
  const actorOrder = [
    ...(primaryResult ? [primaryResult] : []),
    ...actorPriority.map(name => scraperResults.find(r => r.scraperName === name)).filter(Boolean),
    ...scraperResults.filter(r => r.scraperName !== primaryName && !actorPriority.includes(r.scraperName))
  ];

  // Collect all available fields
  const allFields = new Set();
  scraperResults.forEach(({ data }) => {
    Object.keys(data).forEach(field => {
      if (field !== 'code' && field !== 'dvd_id' && field !== 'id' && field !== 'error') {
        allFields.add(field);
      }
    });
  });

  allFields.forEach(fieldName => {
    if (fieldName === 'actor') {
      merged.actor = mergeActors(actorOrder.map(r => r.data.actor));
      return;
    }

    // Step 1: primary scraper always wins for fields it found
    if (primaryResult && primaryResult.data[fieldName] !== undefined) {
      const value = primaryResult.data[fieldName];
      if (!isEmptyValue(value)) {
        merged[fieldName] = value;
        return;
      }
    }

    // Step 2: primary didn't have it — use fieldPriorities for remaining scrapers
    const priority = getFieldPriority(fieldName, config).filter(n => n !== primaryName);
    let foundValue = false;

    for (const scraperName of priority) {
      const scraperResult = scraperResults.find(r => r.scraperName === scraperName);
      if (scraperResult && scraperResult.data[fieldName] !== undefined) {
        const value = scraperResult.data[fieldName];
        if (!isEmptyValue(value)) {
          merged[fieldName] = value;
          foundValue = true;
          break;
        }
      }
    }

    // Step 3: fallback — any remaining scraper not yet tried
    if (!foundValue) {
      for (const scraperResult of scraperResults) {
        if (scraperResult.scraperName === primaryName) continue;
        if (priority.includes(scraperResult.scraperName)) continue;
        if (scraperResult.data[fieldName] !== undefined) {
          const value = scraperResult.data[fieldName];
          if (!isEmptyValue(value)) {
            merged[fieldName] = value;
            break;
          }
        }
      }
    }
  });

  merged.id = code;
  if (merged.title) {
    merged.title = formatTitle(merged, config);
  }
  return merged;
}

/**
 * Re-scrape helper for a single code: runs either one named scraper, or —
 * when scraperOrAll is MULTI_SCRAPER_VALUE — every scraper configured in
 * scrapers.video (priority order), merged with the same mergeResults()
 * logic as a normal multi-scraper scrape.
 *
 * @param {string} scraperOrAll - Scraper name, or MULTI_SCRAPER_VALUE
 * @param {string} code - Single DVD code to re-scrape
 * @param {EventEmitter} emitter - Event emitter for progress updates (optional)
 * @param {object} config - Loaded config (scrapers.video used for the "all" case)
 * @returns {Promise<{data: object, usedScrapers: string[]}>}
 */
async function executeScraperOrAll(scraperOrAll, code, emitter, config) {
  if (scraperOrAll !== MULTI_SCRAPER_VALUE) {
    const results = await executeScraper(scraperOrAll, [code], emitter);
    if (!results || results.length === 0) {
      throw new Error(`No results from scraper ${scraperOrAll}`);
    }
    return { data: results[0], usedScrapers: [scraperOrAll] };
  }

  const scrapersToRun = (config.scrapers && config.scrapers.video) || [];
  if (scrapersToRun.length === 0) {
    throw new Error('No scrapers configured in scrapers.video');
  }

  const scraperResults = [];
  for (const scraperName of scrapersToRun) {
    const results = await executeScraper(scraperName, [code], emitter);
    if (results && results[0]) {
      scraperResults.push({ scraperName, data: results[0] });
    }
  }

  if (scraperResults.length === 0) {
    throw new Error(`No results from any configured scraper (${scrapersToRun.join(', ')})`);
  }

  return {
    data: mergeResults(code, scraperResults, config),
    usedScrapers: scraperResults.map(r => r.scraperName)
  };
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
 * @param {string[]} libraryPaths - Library roots (searched in order for the video)
 */
function saveToFile(code, data, sources, libraryPaths) {
  const outputDir = getScrapePath();

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Find the video file in the root of a library path (NOT recursive): that's
  // the only place extractCodesFromLibrary() takes codes from. A recursive search
  // would match the video of an already organized movie with the same code (e.g.
  // a re-scrape of a better quality copy), and ScrapeSaver would then create the
  // new folder inside the existing one. Its directory is where ScrapeSaver creates
  // the movie folder, so each movie lands in the root its video came from.
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.flv', '.m4v', '.ts', '.mpg', '.mpeg'];

  let videoFile = '';
  for (const libraryPath of libraryPaths) {
    let items;
    try {
      items = fs.readdirSync(libraryPath, { withFileTypes: true });
    } catch (error) {
      console.error(`[ScraperManager] Cannot read directory ${libraryPath}: ${error.message}`);
      continue;
    }

    const match = items.find(entry => {
      if (!entry.isFile() || entry.name.startsWith('.')) return false;
      if (!videoExtensions.includes(path.extname(entry.name).toLowerCase())) return false;
      return extractMovieId(entry.name).toLowerCase() === code.toLowerCase();
    });
    if (match) {
      videoFile = path.join(libraryPath, match.name);
      break;
    }
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

    if (merged.genres && config.genreRules) {
      merged.genres = applyGenreRules(merged.genres, config.genreRules);
    }

    // Only save if we have valid data (not just code/id fields)
    // Check for meaningful data beyond just id/code
    const hasValidData = merged.title || merged.studio || merged.releaseDate ||
                         (merged.actor && merged.actor.length > 0) ||
                         (merged.genres && merged.genres.length > 0);

    if (hasValidData) {
      // Collect which scrapers provided data for this code
      const usedScrapers = scraperResults.map(r => r.scraperName);

      // Save to file with wrapper structure
      saveToFile(code, merged, usedScrapers, getLibraryPaths(config));
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
    const libraryPaths = getLibraryPaths(config);

    if (libraryPaths.length === 0) {
      throw new Error('libraryPaths not specified in config.json');
    }

    console.error(`[ScraperManager] Reading library: ${libraryPaths.join(', ')}`);

    const codes = extractCodesFromLibrary(libraryPaths);

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
module.exports = { scrapeAll, extractCodesFromLibrary, extractMovieId, executeScraper, executeScraperOrAll, mergeResults, mergeActors, isEmptyValue, formatTitle, MULTI_SCRAPER_VALUE };
