/**
 * LibreDMM scraper
 * API: https://libredmm.com/movies/{CODE}.json
 */

const { createEmptyMovie, removeEmptyFields } = require('../schema');

const BASE_URL = 'https://libredmm.com/movies';
const REQUEST_DELAY_MS = 1500;

async function fetchMovie(code) {
  const url = `${BASE_URL}/${encodeURIComponent(code)}.json`;
  console.error(`[LibreDMM] Fetching: ${url}`);

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'javinizer-js/1.0' }
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return res.json();
}

function convertToStandardFormat(data, code) {
  const movie = createEmptyMovie(code);

  movie.title = data.title || '';
  movie.releaseDate = data.date ? data.date.substring(0, 10) : '';

  if (Array.isArray(data.makers) && data.makers.length > 0) {
    movie.studio = data.makers[0];
  }
  if (Array.isArray(data.labels) && data.labels.length > 0) {
    movie.label = data.labels[0];
  }
  if (Array.isArray(data.directors) && data.directors.length > 0) {
    movie.director = data.directors[0];
  }

  movie.plot = data.description || '';
  movie.genres = Array.isArray(data.genres) ? data.genres : [];

  if (data.review) {
    movie.rating = { value: parseFloat(data.review) || 0, votes: 0 };
  }

  if (Array.isArray(data.actresses)) {
    movie.actor = data.actresses.map(a => ({
      name: typeof a === 'string' ? a : (a.name || ''),
      altName: '',
      role: 'Actress',
      thumb: typeof a === 'object' ? (a.image_url || '') : ''
    })).filter(a => a.name);
  }

  movie.coverUrl = data.cover_image_url || data.thumbnail_image_url || '';

  const screenshots = Array.isArray(data.sample_image_urls) ? data.sample_image_urls : [];
  movie.images = {
    poster: movie.coverUrl,
    fanart: screenshots
  };

  return removeEmptyFields(movie);
}

async function scrape(codes) {
  if (!Array.isArray(codes)) codes = [codes];

  const results = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    console.error(`[LibreDMM] Processing ${i + 1}/${codes.length}: ${code}`);

    try {
      const data = await fetchMovie(code);

      if (!data) {
        console.error(`[LibreDMM] Not found: ${code}`);
        results.push({ code });
      } else {
        results.push(convertToStandardFormat(data, code));
      }
    } catch (err) {
      console.error(`[LibreDMM] Error scraping ${code}: ${err.message}`);
      results.push({ code });
    }

    if (i < codes.length - 1) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  return results;
}

module.exports = { scrape };
