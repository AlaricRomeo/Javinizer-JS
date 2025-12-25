/**
 * Main scraping logic for r18dev
 * Converts r18.dev JSON format to standard movie format
 */

const { searchCode, fetchJson, closeBrowser } = require('./browser');
const { createEmptyMovie } = require('../schema');

/**
 * Convert r18.dev JSON format to standard movie format
 * @param {object} data - R18.dev raw JSON data
 * @param {string} code - Movie code
 * @returns {object} Standard format movie object
 */
function convertToStandardFormat(data, code) {
  const movie = createEmptyMovie(code);

  if (!data) return movie;

  // Basic fields - using r18.dev field names
  movie.title = data.title_en || data.title || '';
  movie.originalTitle = data.title_ja || data.originalTitle || data.japaneseTitle || '';
  movie.releaseDate = data.release_date || data.releaseDate || data.dvdReleaseDate || '';
  movie.runtime = data.runtime_mins || data.runtime || data.duration || 0;

  // Studio/Production - using r18.dev field names
  movie.studio = data.maker_name_en || data.studio || data.maker || '';
  movie.label = data.label_name_en || data.label || '';
  movie.series = data.series_name_en || data.series || '';

  // Director - r18.dev has array of directors
  if (Array.isArray(data.directors) && data.directors.length > 0) {
    movie.director = data.directors.map(d => d.name_en || d.name || '').filter(n => n).join(', ');
  } else if (data.director) {
    movie.director = data.director;
  }

  // Description - using r18.dev field names
  movie.plot = data.comment_en || data.description || data.plot || '';
  movie.tagline = data.tagline || '';
  movie.contentRating = data.contentRating || 'XXX';

  // Categories - convert genre objects to strings
  if (Array.isArray(data.genres)) {
    movie.genres = data.genres.map(g => {
      // If genre is an object with name_en, use that
      if (typeof g === 'object' && g.name_en) {
        return g.name_en;
      }
      // If genre is already a string, use it
      return typeof g === 'string' ? g : '';
    }).filter(g => g !== '');
  } else if (Array.isArray(data.categories)) {
    movie.genres = data.categories.map(c => {
      if (typeof c === 'object' && c.name_en) {
        return c.name_en;
      }
      return typeof c === 'string' ? c : '';
    }).filter(c => c !== '');
  }

  movie.tags = Array.isArray(data.tags) ? data.tags : [];

  // Rating
  if (data.rating) {
    movie.rating = {
      value: data.rating.value || data.rating || 0,
      votes: data.rating.votes || data.rating.count || 0
    };
  }

  // Actors - r18.dev uses 'actresses' field
  if (Array.isArray(data.actresses) || Array.isArray(data.actors) || Array.isArray(data.cast)) {
    const actorsList = data.actresses || data.actors || data.cast || [];
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
        name: actor.name_romaji || actor.name_en || actor.name || '',
        altName: actor.name_kanji || actor.name_ja || actor.altName || actor.japaneseName || '',
        role: actor.role || 'Actress',
        thumb: actor.image_url || actor.thumb || actor.image || ''
      };
    });
  }

  // Images - r18.dev uses specific field names
  movie.coverUrl = data.jacket_full_url || data.coverUrl || data.poster || data.thumbnail || '';
  movie.screenshotUrl = data.screenshotUrl || '';
  movie.trailerUrl = data.sample_url || data.trailerUrl || data.sampleUrl || '';

  movie.images = {
    poster: movie.coverUrl,
    fanart: Array.isArray(data.gallery) ? data.gallery :
            Array.isArray(data.screenshots) ? data.screenshots :
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

    console.error('[R18Dev Scrape] Scrape completed successfully');
    return movie;

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
