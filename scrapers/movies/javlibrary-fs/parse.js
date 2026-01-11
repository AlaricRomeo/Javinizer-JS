/**
 * HTML parsing for javlibrary
 * Extracts metadata into standard format (see ../schema.js)
 */

const cheerio = require('cheerio');
const { createEmptyMovie, removeEmptyFields } = require('../schema');

/**
 * Extract first result URL from search results page
 * @param {string} html - HTML content from search results
 * @returns {string|null} URL to first result detail page, or null if not a search results page
 */
function extractFirstResultUrl(html) {
  const $ = cheerio.load(html);

  // Check if this is a search results page by looking for the results list
  const firstResult = $('.video a[href*="?v="]').first();

  if (firstResult.length) {
    let url = firstResult.attr('href');
    if (url) {
      // Convert relative to absolute if needed
      if (url.startsWith('/')) {
        url = 'https://www.javlibrary.com' + url;
      } else if (!url.startsWith('http')) {
        url = 'https://www.javlibrary.com/en/' + url;
      }
      return url;
    }
  }

  return null;
}

/**
 * Parse javlibrary HTML page
 * @param {string} html - HTML content
 * @param {string} code - Movie code
 * @returns {object} Standard format movie object or { needsRedirect: url } if on search results
 */
function parseHTML(html, code) {
  const $ = cheerio.load(html);

  // Check if we're on a search results page instead of a detail page
  const firstResultUrl = extractFirstResultUrl(html);
  if (firstResultUrl) {
    // Return redirect instruction
    return { needsRedirect: firstResultUrl };
  }

  // Start with standard format
  const movie = createEmptyMovie(code);

  try {
    // Title (Japanese)
    const titleElem = $('#video_title a');
    if (titleElem.length) {
      const title = titleElem.text().trim();
      if (title) movie.title = title;
    }

    // Release Date
    const releaseDateRow = $('#video_date .text');
    if (releaseDateRow.length) {
      const dateText = releaseDateRow.text().trim();
      if (dateText) movie.releaseDate = dateText;
    }

    // Runtime
    const runtimeRow = $('#video_length .text');
    if (runtimeRow.length) {
      const runtimeText = runtimeRow.text().trim();
      const match = runtimeText.match(/(\d+)/);
      if (match) {
        movie.runtime = parseInt(match[1], 10);
      }
    }

    // Studio
    const studioRow = $('#video_maker .text a');
    if (studioRow.length) {
      const studio = studioRow.text().trim();
      if (studio) movie.studio = studio;
    }

    // Director
    const directorRow = $('#video_director .text a');
    if (directorRow.length) {
      const director = directorRow.text().trim();
      if (director) movie.director = director;
    }

    // Label
    const labelRow = $('#video_label .text a');
    if (labelRow.length) {
      const label = labelRow.text().trim();
      if (label) movie.label = label;
    }

    // Genres
    const genres = [];
    $('#video_genres .genre').each((i, el) => {
      const genre = $(el).text().trim();
      if (genre) genres.push(genre);
    });
    if (genres.length > 0) movie.genres = genres;

    // Actors - convert to standard format with actor objects
    const actors = [];
    $('.star a[href*="vl_star.php"]').each((i, el) => {
      const name = $(el).text().trim();
      if (name) {
        actors.push({
          name: name,
          altName: '',
          role: 'Actress',
          thumb: ''
        });
      }
    });
    if (actors.length > 0) movie.actor = actors;

    // Cover/Thumbnail
    const thumbImg = $('#video_jacket_img');
    if (thumbImg.length) {
      let thumbUrl = thumbImg.attr('src');
      if (thumbUrl) {
        // Convert relative to absolute if needed
        if (thumbUrl.startsWith('//')) {
          thumbUrl = 'https:' + thumbUrl;
        } else if (thumbUrl.startsWith('/')) {
          thumbUrl = 'https://www.javlibrary.com' + thumbUrl;
        }
        movie.coverUrl = thumbUrl;
        movie.images.poster = thumbUrl;
      }
    }

  } catch (error) {
    console.error(`[Parse] Error parsing HTML: ${error.message}`);
    // Return at least the basic movie structure with code
    return { code };
  }

  // Return only non-empty fields (so ScraperManager can distinguish "not available" from "empty")
  return removeEmptyFields(movie);
}

module.exports = {
  parseHTML
};
