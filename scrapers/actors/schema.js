/**
 * Standard Output Schema for Actor Scrapers
 *
 * This schema defines the expected output format for all actor scrapers.
 * Every actor scraper MUST return data in this exact format.
 */

/**
 * Title-case a name: first letter of each word uppercase, rest lowercase
 * (e.g. "RISA tachibana" -> "Risa Tachibana"). No-op on non-Latin scripts
 * (kanji/kana aren't \w, so this only ever touches ASCII words).
 *
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return str ? str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : str;
}

// Placeholder values a source (an NFO from another tool, a scraper gap, a
// stray manual edit) might put in a name field instead of leaving it empty.
const PLACEHOLDER_ACTOR_NAMES = new Set(['unknown', 'n/a', 'na']);

// Generic "no photo" images some sources serve instead of a real photo.
// Caught by URL when the URL itself gives it away, otherwise by the MD5 of
// the downloaded file (e.g. xcity's per-actor-looking thumb_<ts>.jpg).
const PLACEHOLDER_PHOTO_URL_PATTERNS = [
  /\/noimage\.gif$/i,                 // xcity
  /\/anonymous2\.png$/i,              // xslist
  /\/idolimages\/full\/unknown\.\w+$/i // javdatabase (javdb scraper)
];
const PLACEHOLDER_PHOTO_HASHES = new Set([
  'e3404d8210f013180ae8535372ecf44c', // xcity "No Image" thumb_<ts>.jpg
  '5d6c3ca9ec2dbab40a91eff0b6484a82'  // xcity noimage.gif
]);

function isPlaceholderPhotoUrl(url) {
  return !!url && PLACEHOLDER_PHOTO_URL_PATTERNS.some(re => re.test(url.split('?')[0]));
}

function isPlaceholderPhotoFile(filePath) {
  const fs = require('fs');
  const crypto = require('crypto');
  try {
    const hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
    return PLACEHOLDER_PHOTO_HASHES.has(hash);
  } catch (_) {
    return false;
  }
}

/**
 * Split a "Name (Alias)" style name (DMM/r18dev format, also full-width
 * brackets) into the base name and its bracketed aliases:
 * "A (B, C) (D)" -> { name: "A", aliases: ["B", "C", "D"] }.
 *
 * @param {string} raw
 * @returns {{name: string, aliases: string[]}}
 */
function splitParenAliases(raw) {
  const str = (raw || '').trim();
  const aliases = [];
  const name = str.replace(/\s*[(（]([^)）]*)[)）]/g, (_, inner) => {
    inner.split(/[,、，]/).map(s => s.trim()).filter(Boolean).forEach(a => aliases.push(a));
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return { name: name || str, aliases };
}

/**
 * True for a name that isn't real actor data — empty/whitespace, or one of
 * PLACEHOLDER_ACTOR_NAMES (case-insensitive). Such an actor should never be
 * searched/scraped, saved into the actor cache, or kept in a movie's own
 * cast list.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isPlaceholderActorName(name) {
  const key = (name || '').trim().toLowerCase();
  return !key || PLACEHOLDER_ACTOR_NAMES.has(key);
}

/**
 * Title-case an actor's name and each comma-separated alt name (no-op on
 * non-Latin scripts — see toTitleCase()). The central actor cache already
 * does this on every save (setPrimaryName()/insertNameIfNew() in
 * actorDb.js); this is for the OTHER place a name gets written — a
 * movie's own NFO — which would otherwise keep whatever casing a scraper
 * or manual edit happened to use, out of step with the cache. Returns a
 * new object; does not mutate the one passed in.
 *
 * @param {object} actor
 * @returns {object}
 */
function normalizeActorDisplayName(actor) {
  return {
    ...actor,
    name: toTitleCase(actor.name),
    altName: (actor.altName || '')
      .split(',')
      .map(s => toTitleCase(s.trim()))
      .filter(Boolean)
      .join(', ')
  };
}

/**
 * Remove any alt-name entry that's just the primary name again — case-,
 * whitespace-, and word-order-insensitive (a 2-word name reordered
 * "Family Given" vs "Given Family" is still the same name) — and dedupe
 * the remaining entries against each other the same way. Used wherever
 * alt names get merged/persisted, so the primary name never ends up
 * listed among its own aliases.
 *
 * @param {string} name - Primary name
 * @param {string[]} altNames - Candidate alt names
 * @returns {string[]}
 */
function dedupeAltNames(name, altNames) {
  const normalize = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const invert = s => {
    const parts = normalize(s).split(' ');
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : normalize(s);
  };
  const primaryKey = normalize(name);
  const primaryInverted = invert(name);
  const seen = new Set();
  return (altNames || []).filter(n => {
    const key = normalize(n);
    const keyInverted = invert(n);
    if (!key || key === primaryKey || key === primaryInverted || seen.has(key) || seen.has(keyInverted)) return false;
    seen.add(key);
    seen.add(keyInverted);
    return true;
  });
}

/**
 * Normalize actor name to slug ID format
 * - Converts to lowercase
 * - Removes special characters
 * - Converts spaces to hyphens
 * - Handles Japanese characters
 *
 * @param {string} name - Actor name
 * @returns {string} - Normalized slug ID
 */
function normalizeActorName(name) {
  if (!name) return '';

  // Convert to lowercase
  let normalized = name.toLowerCase();

  // Remove common Japanese characters and symbols
  normalized = normalized
    .replace(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g, '')
    .trim();

  // Remove special characters except spaces and hyphens
  normalized = normalized.replace(/[^\w\s-]/g, '');

  // Convert spaces to hyphens
  normalized = normalized.replace(/\s+/g, '-');

  // Remove multiple consecutive hyphens
  normalized = normalized.replace(/-+/g, '-');

  // Remove leading/trailing hyphens
  normalized = normalized.replace(/^-+|-+$/g, '');

  // Fallback for names with no latin characters (e.g. pure Japanese)
  // Generate a deterministic short hash from the original name
  if (!normalized) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) {
      h = (((h << 5) + h) ^ name.charCodeAt(i)) >>> 0;
    }
    normalized = 'actor-' + h.toString(16).padStart(8, '0');
  }

  return normalized;
}

/**
 * Create an empty actor data object with all required fields
 * Use this as a starting point in your scraper
 *
 * @param {string} name - Actor name
 * @returns {object} - Empty actor data structure
 */
function createEmptyActor(name) {
  const id = normalizeActorName(name);

  return {
    // ─────────────────────────────
    // Basic identification
    // ─────────────────────────────
    id: id,                    // Slug normalized ID (e.g., "hayami-remu")
    name: name,                // Main name (English or romanized)
    altName: '',               // Comma-separated alternate names/aliases (Japanese name, former stage names, etc.)

    // ─────────────────────────────
    // Physical attributes
    // ─────────────────────────────
    birthdate: '',             // Format: YYYY-MM-DD
    height: 0,                 // Height in cm (number)
    bust: 0,                   // Bust in cm (number)
    waist: 0,                  // Waist in cm (number)
    hips: 0,                   // Hips in cm (number)

    // ─────────────────────────────
    // Photo URLs and paths
    // ─────────────────────────────
    thumbUrl: '',              // Original URL from scraper (always preserved)
    thumbLocal: '',            // Local path if actorsPath configured (e.g., "hayami-remu.jpg")
    thumb: '',                 // Final thumb to use in NFO (URL or relative path)

    // ─────────────────────────────
    // User curation
    // ─────────────────────────────
    favorite: false,           // Manually starred by the user; never set by a scraper

    // ─────────────────────────────
    // Metadata
    // ─────────────────────────────
    meta: {
      sources: [],             // Array of scraper names that provided data
      lastUpdate: ''           // ISO timestamp
    }
  };
}

/**
 * Validate that a scraper output matches the schema
 *
 * @param {object} data - Scraper output to validate
 * @returns {boolean} - True if valid
 */
function validateActor(data) {
  // Required fields
  if (!data.id || typeof data.id !== 'string') {
    console.error('Missing or invalid field: id');
    return false;
  }

  if (!data.name || typeof data.name !== 'string') {
    console.error('Missing or invalid field: name');
    return false;
  }

  // Type checks
  const typeChecks = [
    ['altName', 'string'],
    ['otherNames', 'object'], // array
    ['birthdate', 'string'],
    ['height', 'number'],
    ['bust', 'number'],
    ['waist', 'number'],
    ['hips', 'number'],
    ['thumbUrl', 'string'],
    ['thumbLocal', 'string'],
    ['thumb', 'string']
  ];

  for (const [field, expectedType] of typeChecks) {
    if (data[field] !== undefined && typeof data[field] !== expectedType) {
      console.error(`Invalid type for field ${field}: expected ${expectedType}, got ${typeof data[field]}`);
      return false;
    }
  }

  // Array checks
  if (data.otherNames && !Array.isArray(data.otherNames)) {
    console.error('Field "otherNames" must be an array');
    return false;
  }

  // Meta object check
  if (data.meta && typeof data.meta !== 'object') {
    console.error('Field "meta" must be an object');
    return false;
  }

  return true;
}

/**
 * Remove empty fields from actor object
 *
 * @param {object} actor - Actor object to clean
 * @returns {object} - Actor object with only non-empty fields
 */
function removeEmptyFields(actor) {
  const cleaned = {};

  Object.keys(actor).forEach(key => {
    const value = actor[key];

    // Always keep id and name
    if (key === 'id' || key === 'name') {
      cleaned[key] = value;
      return;
    }

    // Skip empty values
    if (value === null || value === undefined || value === '') {
      return;
    }

    // Skip zero numbers (except they might be valid)
    if (typeof value === 'number' && value === 0) {
      return;
    }

    // Skip empty arrays
    if (Array.isArray(value) && value.length === 0) {
      return;
    }

    // Skip empty objects
    if (typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return;
      }

      // For meta object, check if it has any non-empty values
      if (key === 'meta') {
        const hasContent = Object.values(value).some(v => {
          if (Array.isArray(v)) return v.length > 0;
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

/**
 * Convert actor data to Kodi NFO format (XML)
 *
 * @param {object} actor - Actor data object
 * @returns {string} - XML string in Kodi NFO format
 */
function actorToNFO(actor) {
  const escapeXml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<actor>\n';

  // ID (canonical, stable)
  if (actor.id) {
    xml += `  <id>${escapeXml(actor.id)}</id>\n`;
  }

  // Basic info
  if (actor.name) {
    xml += `  <name>${escapeXml(toTitleCase(actor.name))}</name>\n`;
  }

  if (actor.altName) {
    xml += `  <altname>${escapeXml(toTitleCase(actor.altName))}</altname>\n`;
  }

  // Physical attributes
  if (actor.birthdate) {
    xml += `  <birthdate>${escapeXml(actor.birthdate)}</birthdate>\n`;
  }

  if (actor.height && actor.height > 0) {
    xml += `  <height>${actor.height}</height>\n`;
  }

  if (actor.bust && actor.bust > 0) {
    xml += `  <bust>${actor.bust}</bust>\n`;
  }

  if (actor.waist && actor.waist > 0) {
    xml += `  <waist>${actor.waist}</waist>\n`;
  }

  if (actor.hips && actor.hips > 0) {
    xml += `  <hips>${actor.hips}</hips>\n`;
  }

  // Thumbnails
  if (actor.thumbUrl) {
    xml += `  <thumburl>${escapeXml(actor.thumbUrl)}</thumburl>\n`;
  }

  if (actor.thumbLocal) {
    xml += `  <thumblocal>${escapeXml(actor.thumbLocal)}</thumblocal>\n`;
  }

  if (actor.thumb) {
    xml += `  <thumb>${escapeXml(actor.thumb)}</thumb>\n`;
  }

  if (actor.favorite) {
    xml += `  <favorite>true</favorite>\n`;
  }

  // Metadata
  if (actor.meta) {
    if (actor.meta.sources && Array.isArray(actor.meta.sources) && actor.meta.sources.length > 0) {
      xml += '  <sources>\n';
      actor.meta.sources.forEach(source => {
        xml += `    <source>${escapeXml(source)}</source>\n`;
      });
      xml += '  </sources>\n';
    }

    if (actor.meta.lastUpdate) {
      xml += `  <lastupdate>${escapeXml(actor.meta.lastUpdate)}</lastupdate>\n`;
    }
  }

  xml += '</actor>\n';

  return xml;
}

/**
 * Parse Kodi NFO format (XML) to actor data object
 *
 * @param {string} nfoContent - XML string content
 * @returns {object} - Actor data object
 */
function nfoToActor(nfoContent) {
  const actor = {
    id: '',
    name: '',
    altName: '',
    birthdate: '',
    height: 0,
    bust: 0,
    waist: 0,
    hips: 0,
    thumbUrl: '',
    thumbLocal: '',
    thumb: '',
    favorite: false,
    meta: {
      sources: [],
      lastUpdate: ''
    }
  };

  // Simple XML parsing (no external dependencies)
  const getTagValue = (tag) => {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
    const match = nfoContent.match(regex);
    return match ? match[1].trim() : '';
  };

  const getAllTagValues = (tag) => {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gi');
    const matches = [];
    let match;
    while ((match = regex.exec(nfoContent)) !== null) {
      matches.push(match[1].trim());
    }
    return matches;
  };

  const unescapeXml = (str) => {
    if (!str) return '';
    return str
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  };

  // Parse ID (canonical)
  const storedId = getTagValue('id');
  if (storedId) actor.id = unescapeXml(storedId);

  // Parse basic fields
  actor.name = unescapeXml(getTagValue('name'));
  actor.altName = unescapeXml(getTagValue('altname'));
  actor.birthdate = unescapeXml(getTagValue('birthdate'));

  // Parse numeric fields
  const height = getTagValue('height');
  actor.height = height ? parseInt(height, 10) : 0;

  const bust = getTagValue('bust');
  actor.bust = bust ? parseInt(bust, 10) : 0;

  const waist = getTagValue('waist');
  actor.waist = waist ? parseInt(waist, 10) : 0;

  const hips = getTagValue('hips');
  actor.hips = hips ? parseInt(hips, 10) : 0;

  // Parse thumb fields
  actor.thumbUrl = unescapeXml(getTagValue('thumburl'));
  actor.thumbLocal = unescapeXml(getTagValue('thumblocal'));
  actor.thumb = unescapeXml(getTagValue('thumb'));

  actor.favorite = getTagValue('favorite').toLowerCase() === 'true';

  // Parse metadata
  const sources = getAllTagValues('source');
  actor.meta.sources = sources.map(s => unescapeXml(s));
  actor.meta.lastUpdate = unescapeXml(getTagValue('lastupdate'));

  return actor;
}

module.exports = {
  createEmptyActor,
  validateActor,
  removeEmptyFields,
  normalizeActorName,
  toTitleCase,
  dedupeAltNames,
  isPlaceholderActorName,
  splitParenAliases,
  isPlaceholderPhotoUrl,
  isPlaceholderPhotoFile,
  normalizeActorDisplayName,
  actorToNFO,
  nfoToActor
};
