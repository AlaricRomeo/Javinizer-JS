/**
 * SCRAPER TEMPLATE - Main scraping logic
 *
 * Replace "TEMPLATE" with your scraper name.
 * Implement your scraping logic in this file.
 *
 * IMPORTANT: Use the schema.js file to ensure your output matches the standard format!
 */

const { createEmptyMovie, validateMovie } = require('../schema');

/**
 * Main scraping function
 * @param {string[]} codes - Array of DVD codes to scrape
 * @returns {Promise<object[]>} - Array of scraped data objects (standard format)
 */
async function scrape(codes) {
  console.error(`[TEMPLATE] Starting batch scrape for ${codes.length} code(s)`);

  const results = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    console.error(`[TEMPLATE] Processing ${i + 1}/${codes.length}: ${code}`);

    try {
      // Scrape single code (returns standard format)
      const data = await scrapeSingleCode(code);

      // Validate output format
      if (!validateMovie(data)) {
        console.error(`[TEMPLATE] Warning: ${code} output doesn't match schema`);
      }

      // Clean and add to results
      const cleaned = cleanJson(data);

      // Only add if we got more than just the code
      if (Object.keys(cleaned).length > 1) {
        results.push(cleaned);
      } else {
        console.error(`[TEMPLATE] No data found for ${code}`);
        results.push({ code });
      }

    } catch (error) {
      console.error(`[TEMPLATE] Error scraping ${code}: ${error.message}`);
      results.push({ code });
    }
  }

  console.error(`[TEMPLATE] Batch scrape completed: ${results.length} results`);
  return results;
}

/**
 * Scrape a single DVD code
 * @param {string} code - DVD code to scrape
 * @returns {Promise<object>} - Scraped data object (MUST match schema.js format)
 */
async function scrapeSingleCode(code) {
  console.error(`[TEMPLATE] Starting scrape for: ${code}`);

  // Start with empty movie structure (ensures all fields exist)
  const movie = createEmptyMovie(code);

  // ============================================
  // IMPLEMENT YOUR SCRAPING LOGIC HERE
  // ============================================
  //
  // Examples:
  // - Fetch from API: const response = await fetch(url)
  // - Scrape HTML: const html = await fetchHtml(url)
  // - Use Puppeteer: const page = await browser.newPage()
  //
  // Fill in the movie object fields:
  //
  // movie.title = "Movie Title";
  // movie.originalTitle = "オリジナルタイトル";
  // movie.plot = "Description here";
  // movie.releaseDate = "2023-01-15";
  // movie.runtime = 120;
  // movie.studio = "Studio Name";
  // movie.director = "Director Name";
  // movie.genres = ["Drama", "Romance"];
  // movie.tags = ["HD", "New"];
  // movie.coverUrl = "https://...";
  // movie.actor = [
  //   {
  //     name: "Actor Name",
  //     altName: "Alternative Name",
  //     role: "Actress",
  //     thumb: "https://..."
  //   }
  // ];
  // movie.rating = { value: 8.5, votes: 100 };
  //
  // Return the filled movie object:
  // return movie;

  // Placeholder implementation
  throw new Error('Not implemented - replace this with your scraping logic');
}

/**
 * Clean JSON object - remove null, undefined, empty strings, empty arrays
 * @param {object} obj - Object to clean
 * @returns {object} - Cleaned object
 */
function cleanJson(obj) {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    const cleaned = obj
      .map(cleanJson)
      .filter(item => item !== undefined);
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

  // Primitives: remove empty strings
  if (obj === '') {
    return undefined;
  }

  return obj;
}

module.exports = { scrape };
