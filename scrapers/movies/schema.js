/**
 * Standard Output Schema for Movie Scrapers
 *
 * This schema defines the expected output format for all movie scrapers.
 * Every scraper MUST return data in this exact format.
 *
 * Benefits:
 * - ScraperManager remains simple (no field mapping logic)
 * - Easy testing (validate scraper output against schema)
 * - Clear contract between scrapers and manager
 * - Field names match WebUI expectations
 */

/**
 * Create an empty movie data object with all required fields
 * Use this as a starting point in your scraper
 *
 * @param {string} code - DVD code (e.g., "SDDM-943")
 * @returns {object} - Empty movie data structure
 */
function createEmptyMovie(code) {
  return {
    // ─────────────────────────────
    // Basic identification
    // ─────────────────────────────
    id: code,           // DVD ID (same as code)
    code: code,         // DVD code (e.g., "SDDM-943")
    contentId: '',      // Content ID (optional, some items use this instead of id)

    // ─────────────────────────────
    // Titles
    // ─────────────────────────────
    title: '',          // Main title (English or romanized)
    originalTitle: '',  // Original title (Japanese, Chinese, etc.)

    // ─────────────────────────────
    // Release info
    // ─────────────────────────────
    releaseDate: '',    // Format: YYYY-MM-DD
    runtime: 0,         // Duration in minutes (number)

    // ─────────────────────────────
    // Studio/Production
    // ─────────────────────────────
    studio: '',         // Studio/Maker name
    label: '',          // Label name
    series: '',         // Series name
    director: '',       // Director name

    // ─────────────────────────────
    // Descriptions
    // ─────────────────────────────
    plot: '',           // Full description/plot
    tagline: '',        // Short tagline/summary

    // ─────────────────────────────
    // Rating and classification
    // ─────────────────────────────
    contentRating: '',  // Age rating (e.g., "XXX", "R18")
    rating: {           // User rating
      value: 0,         // Rating value (e.g., 8.5)
      votes: 0          // Number of votes
    },

    // ─────────────────────────────
    // Categories (arrays)
    // ─────────────────────────────
    genres: [],         // Array of genre strings
    tags: [],           // Array of tag strings

    // ─────────────────────────────
    // Cast
    // ─────────────────────────────
    actor: [],          // Array of actor objects:
                        // {
                        //   name: "Actor Name",
                        //   altName: "Alternative Name",
                        //   role: "Actress",
                        //   thumb: "https://..."
                        // }

    // ─────────────────────────────
    // Media URLs
    // ─────────────────────────────
    coverUrl: '',       // Cover/poster image URL
    screenshotUrl: '',  // Screenshots URL (or empty)
    trailerUrl: '',     // Trailer video URL (or empty)

    // ─────────────────────────────
    // Images (structured)
    // ─────────────────────────────
    images: {
      poster: '',       // Main poster URL
      fanart: []        // Array of fanart/background URLs
    },

    // ─────────────────────────────
    // Local files (managed by system)
    // ─────────────────────────────
    local: {
      path: '',         // Local directory path
      files: [],        // Array of local file paths
      video: ''         // Main video file path
    },

    // ─────────────────────────────
    // Metadata (managed by system)
    // ─────────────────────────────
    meta: {
      createdAt: '',    // ISO timestamp
      updatedAt: '',    // ISO timestamp
      locked: false     // Lock status
    }
  };
}

/**
 * Validate that a scraper output matches the schema
 * Use this to test your scraper implementation
 *
 * @param {object} data - Scraper output to validate
 * @returns {boolean} - True if valid
 */
function validateMovie(data) {
  // Required fields
  if (!data.code || typeof data.code !== 'string') {
    console.error('Missing or invalid field: code');
    return false;
  }

  // Type checks
  const typeChecks = [
    ['id', 'string'],
    ['title', 'string'],
    ['originalTitle', 'string'],
    ['releaseDate', 'string'],
    ['runtime', 'number'],
    ['studio', 'string'],
    ['label', 'string'],
    ['series', 'string'],
    ['director', 'string'],
    ['plot', 'string'],
    ['tagline', 'string'],
    ['contentRating', 'string'],
    ['genres', 'object'],  // array
    ['tags', 'object'],    // array
    ['actor', 'object'],   // array
    ['coverUrl', 'string'],
    ['screenshotUrl', 'string'],
    ['trailerUrl', 'string']
  ];

  for (const [field, expectedType] of typeChecks) {
    if (data[field] !== undefined && typeof data[field] !== expectedType) {
      console.error(`Invalid type for field ${field}: expected ${expectedType}, got ${typeof data[field]}`);
      return false;
    }
  }

  // Array checks
  if (data.genres && !Array.isArray(data.genres)) {
    console.error('Field "genres" must be an array');
    return false;
  }

  if (data.tags && !Array.isArray(data.tags)) {
    console.error('Field "tags" must be an array');
    return false;
  }

  if (data.actor && !Array.isArray(data.actor)) {
    console.error('Field "actor" must be an array');
    return false;
  }

  // Object checks
  if (data.rating && typeof data.rating !== 'object') {
    console.error('Field "rating" must be an object');
    return false;
  }

  if (data.images && typeof data.images !== 'object') {
    console.error('Field "images" must be an object');
    return false;
  }

  return true;
}

/**
 * Remove empty fields from movie object
 * Scrapers should return only populated fields (not empty schema)
 * This allows ScraperManager to distinguish between "field not available" and "field empty"
 *
 * @param {object} movie - Movie object to clean
 * @returns {object} - Movie object with only non-empty fields
 */
function removeEmptyFields(movie) {
  const cleaned = {};

  Object.keys(movie).forEach(key => {
    const value = movie[key];

    // Always keep code and id
    if (key === 'code' || key === 'id') {
      cleaned[key] = value;
      return;
    }

    // Skip empty values
    if (value === null || value === undefined || value === '') {
      return;
    }

    // Skip empty arrays
    if (Array.isArray(value) && value.length === 0) {
      return;
    }

    // Skip empty objects (but keep objects with properties)
    if (typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return;
      }
      // For rating object, check if it has meaningful values
      if (key === 'rating' && value.value === 0 && value.votes === 0) {
        return;
      }
      // For images object, check if it has any non-empty values
      if (key === 'images') {
        const hasContent = value.poster || (Array.isArray(value.fanart) && value.fanart.length > 0);
        if (!hasContent) {
          return;
        }
      }
      // For local/meta objects, check if they have any non-empty values
      if (key === 'local' || key === 'meta') {
        const hasContent = Object.values(value).some(v => {
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === 'boolean') return true;
          return v !== '' && v !== null && v !== undefined;
        });
        if (!hasContent) {
          return;
        }
      }
    }

    // Keep non-empty value
    cleaned[key] = value;
  });

  return cleaned;
}

module.exports = {
  createEmptyMovie,
  validateMovie,
  removeEmptyFields
};
