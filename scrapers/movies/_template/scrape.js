/**
 * SCRAPER TEMPLATE - Main scraping logic
 *
 * Replace "TEMPLATE" with your scraper name.
 * Implement your scraping logic in this file.
 *
 * IMPORTANT: Use the schema.js file to ensure your output matches the standard format!
 */

const { createEmptyMovie, validateMovie, removeEmptyFields } = require('../schema');

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

      // Add to results (keep full schema structure)
      results.push(data);

    } catch (error) {
      console.error(`[TEMPLATE] Error scraping ${code}: ${error.message}`);
      // On failure, return only code (signals scraper failed)
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
  // Return only non-empty fields (so ScraperManager can distinguish "not available" from "empty")
  // return removeEmptyFields(movie);

  // Placeholder implementation
  throw new Error('Not implemented - replace this with your scraping logic');
}

module.exports = { scrape };
