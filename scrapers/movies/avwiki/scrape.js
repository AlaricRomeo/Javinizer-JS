/**
 * AV-Wiki scraper
 * Site: https://av-wiki.net (WordPress, static HTML)
 *
 * Main value: real actress names behind amateur aliases (MGS / FANZA素人).
 * Lookup: search page ?s={CODE} → match メーカー品番 → detail page.
 */

const cheerio = require('cheerio');
const { createEmptyMovie, removeEmptyFields } = require('../schema');

const BASE_URL = 'https://av-wiki.net';
const REQUEST_DELAY_MS = 1500;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Placeholder tags: (≥o≤) = unknown actress, ＊＊＊ = compilation / foreign
const PLACEHOLDER_ACTORS = new Set(['(≥o≤)', '＊＊＊', '***']);

async function fetchHtml(url) {
  console.error(`[AVWiki] Fetching: ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findMovieUrl(code) {
  const html = await fetchHtml(`${BASE_URL}/?s=${encodeURIComponent(code)}`);
  if (!html) return null;

  const $ = cheerio.load(html);
  let url = null;

  $('article.archive-list').each((_, el) => {
    const itemCode = $(el).find('i.fa-circle-o').parent().text().trim();
    if (itemCode.toUpperCase() === code.toUpperCase()) {
      url = $(el).find('.read-more a').attr('href') || null;
      return false;
    }
  });

  return url;
}

// Pick the largest image from srcset, falling back to src
function pickCover($img) {
  const srcset = $img.attr('srcset') || '';
  let best = $img.attr('src') || '';
  let bestWidth = 0;

  srcset.split(',').forEach(part => {
    const [src, size] = part.trim().split(/\s+/);
    const width = parseInt(size, 10) || 0;
    if (src && width > bestWidth) {
      best = src;
      bestWidth = width;
    }
  });

  // DMM image proxy: drop resize/webp params to get the original jpg
  return best.replace(/(awsimgsrc\.dmm\.co\.jp\/[^?]+)\?.*$/, '$1');
}

function parseMovie(html, code) {
  const $ = cheerio.load(html);
  const movie = createEmptyMovie(code);

  const fields = {};
  $('dl.dltable dt').each((_, dt) => {
    fields[$(dt).text().trim()] = $(dt).next('dd');
  });
  const text = key => (fields[key] ? fields[key].text().trim() : '');

  const $img = $('.article-thumbnail img').first();
  const title = ($img.attr('alt') || '').trim();
  movie.title = title;
  movie.originalTitle = title;

  movie.studio = text('メーカー');
  movie.label = text('レーベル');
  movie.series = text('シリーズ');
  movie.contentId = text('FANZA品番');

  const date = text('配信開始日');
  movie.releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';

  if (fields['AV女優名']) {
    movie.actor = fields['AV女優名'].find('a').map((_, a) => $(a).text().trim()).get()
      .filter(name => name && !PLACEHOLDER_ACTORS.has(name))
      .map(name => ({ name, altName: '', role: 'Actress', thumb: '' }));
  }

  movie.coverUrl = $img.length ? pickCover($img) : '';
  movie.images = { poster: movie.coverUrl, fanart: [] };

  return removeEmptyFields(movie);
}

async function scrape(codes) {
  if (!Array.isArray(codes)) codes = [codes];

  const results = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    console.error(`[AVWiki] Processing ${i + 1}/${codes.length}: ${code}`);

    try {
      const url = await findMovieUrl(code);

      if (!url) {
        console.error(`[AVWiki] Not found: ${code}`);
        results.push({ code });
      } else {
        await sleep(REQUEST_DELAY_MS);
        const html = await fetchHtml(url);
        results.push(html ? parseMovie(html, code) : { code });
      }
    } catch (err) {
      console.error(`[AVWiki] Error scraping ${code}: ${err.message}`);
      results.push({ code });
    }

    if (i < codes.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
}

module.exports = { scrape };
