/**
 * Standard Output Schema for Actor Scrapers
 *
 * This schema defines the expected output format for all actor scrapers.
 * Every actor scraper MUST return data in this exact format.
 */

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
    altName: '',               // Japanese/alternative name
    otherNames: [],            // Array of name variants

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

  // Basic info
  if (actor.name) {
    xml += `  <name>${escapeXml(actor.name)}</name>\n`;
  }

  if (actor.altName) {
    xml += `  <altname>${escapeXml(actor.altName)}</altname>\n`;
  }

  // Other names
  if (actor.otherNames && Array.isArray(actor.otherNames) && actor.otherNames.length > 0) {
    actor.otherNames.forEach(name => {
      xml += `  <othername>${escapeXml(name)}</othername>\n`;
    });
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
    otherNames: [],
    birthdate: '',
    height: 0,
    bust: 0,
    waist: 0,
    hips: 0,
    thumbUrl: '',
    thumbLocal: '',
    thumb: '',
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

  // Parse basic fields
  actor.name = unescapeXml(getTagValue('name'));
  actor.altName = unescapeXml(getTagValue('altname'));
  actor.birthdate = unescapeXml(getTagValue('birthdate'));

  // Parse other names
  const otherNames = getAllTagValues('othername');
  actor.otherNames = otherNames.map(n => unescapeXml(n));

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
  actorToNFO,
  nfoToActor
};
