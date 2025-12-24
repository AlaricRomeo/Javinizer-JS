/**
 * Main scraping logic for r18dev
 * Converts r18.dev JSON format to standard movie format
 */

const { searchCode, fetchJson, closeBrowser } = require('./browser');
const { createEmptyMovie } = require('../schema');

/**
 * Clean JSON by removing null values and empty arrays
 * @param {object} obj - Object to clean
 * @returns {object} Cleaned object
 */
function cleanJson(obj) {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    const cleaned = obj.map(cleanJson).filter(item => item !== undefined);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = cleanJson(value);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  return obj;
}

/**
 * Convert r18.dev JSON format to standard movie format
 * @param {object} data - R18.dev raw JSON data
 * @param {string} code - Movie code
 * @returns {object} Standard format movie object
 */
function convertToStandardFormat(data, code) {
  const movie = createEmptyMovie(code);

  if (!data) return movie;

  // Basic fields
  movie.title = data.title || '';
  movie.originalTitle = data.originalTitle || data.japaneseTitle || '';
  movie.releaseDate = data.releaseDate || data.dvdReleaseDate || '';
  movie.runtime = data.runtime || data.duration || 0;

  // Studio/Production
  movie.studio = data.studio || data.maker || '';
  movie.label = data.label || '';
  movie.series = data.series || '';
  movie.director = data.director || '';

  // Description
  movie.plot = data.description || data.plot || '';
  movie.tagline = data.tagline || '';
  movie.contentRating = data.contentRating || 'XXX';

  // Categories
  movie.genres = Array.isArray(data.genres) ? data.genres :
                 Array.isArray(data.categories) ? data.categories : [];
  movie.tags = Array.isArray(data.tags) ? data.tags : [];

  // Rating
  if (data.rating) {
    movie.rating = {
      value: data.rating.value || data.rating || 0,
      votes: data.rating.votes || data.rating.count || 0
    };
  }

  // Actors - convert to standard format
  if (Array.isArray(data.actors) || Array.isArray(data.cast)) {
    const actorsList = data.actors || data.cast || [];
    movie.actor = actorsList.map(actor => {
      if (typeof actor === 'string') {
        return {
          name: actor,
          altName: '',
          role: 'Actress',
          thumb: ''
        };
      }
      return {
        name: actor.name || '',
        altName: actor.altName || actor.japaneseName || '',
        role: actor.role || 'Actress',
        thumb: actor.thumb || actor.image || ''
      };
    });
  }

  // Images
  movie.coverUrl = data.coverUrl || data.poster || data.thumbnail || '';
  movie.screenshotUrl = data.screenshotUrl || '';
  movie.trailerUrl = data.trailerUrl || data.sampleUrl || '';

  movie.images = {
    poster: movie.coverUrl,
    fanart: Array.isArray(data.screenshots) ? data.screenshots :
            Array.isArray(data.images) ? data.images : []
  };

  return movie;
}

/**
 * Scrape metadata for a single code
 * @param {string} code - Movie code
 * @returns {Promise<object>} Standard format movie object
 */
async function scrapeSingle(code) {
  console.error(`[R18Dev Scrape] Starting scrape for: ${code}`);

  try {
    // Search for the code to get content ID
    const contentId = await searchCode(code);

    // Fetch the JSON data
    const data = await fetchJson(contentId);

    // Convert to standard format
    const movie = convertToStandardFormat(data, code);

    // Clean empty fields
    const cleaned = cleanJson(movie);

    console.error('[R18Dev Scrape] Scrape completed successfully');
    return cleaned || createEmptyMovie(code);

  } catch (error) {
    console.error(`[R18Dev Scrape] Failed: ${error.message}`);
    // On failure, return minimal movie structure with just code
    return createEmptyMovie(code);
  }
}

/**
 * Scrape metadata for multiple codes
 * @param {string[]} codes - Array of movie codes (max 100)
 * @returns {Promise<object[]>} Array of R18dev JSON objects
 */
async function scrape(codes) {
  // Ensure codes is an array
  if (!Array.isArray(codes)) {
    codes = [codes];
  }

  // Limit to 100 codes
  if (codes.length > 100) {
    console.error(`[R18Dev Scrape] Warning: Limiting to first 100 codes (provided: ${codes.length})`);
    codes = codes.slice(0, 100);
  }

  console.error(`[R18Dev Scrape] Starting batch scrape for ${codes.length} code(s)`);

  const results = [];

  try {
    // Scrape all codes
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      console.error(`[R18Dev Scrape] Processing ${i + 1}/${codes.length}: ${code}`);

      try {
        const result = await scrapeSingle(code);
        results.push(result);
      } catch (error) {
        if (error.code === 'SESSION_LIMIT') {
          console.error('[R18Dev Scrape] Session limit reached. Please restart to continue.');
          // Add remaining codes as failed
          for (let j = i; j < codes.length; j++) {
            results.push({ code: codes[j] });
          }
          break;
        }
        // For other errors, add minimal result and continue
        results.push({ code });
      }

      // Small delay between requests to be respectful
      if (i < codes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.error(`[R18Dev Scrape] Batch scrape completed: ${results.length} results`);
    return results;

  } finally {
    await closeBrowser();
  }
}

module.exports = {
  scrape,
  scrapeSingle
};
