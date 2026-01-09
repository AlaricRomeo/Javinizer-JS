/**
 * Actor Index Manager
 *
 * Centralized management for actor index (name variants mapping)
 * This module provides a single source of truth for index operations
 */

const fs = require('fs');
const path = require('path');
const { getActorsCachePath } = require('../../scrapers/actors/cache-helper');

const INDEX_FILENAME = 'actors-index.json';

/**
 * Get path to index file
 * @returns {string} - Full path to index file
 */
function getIndexPath() {
  return path.join(getActorsCachePath(), INDEX_FILENAME);
}

/**
 * Load actor index from disk
 * @returns {Object} - Index mapping (name variants -> actor ID)
 */
function loadIndex() {
  const indexPath = getIndexPath();
  const actorsPath = getActorsCachePath();
  const oldIndexPath = path.join(actorsPath, '.index.json');

  // Auto-migrate from old .index.json to actors-index.json (Windows compatibility)
  if (!fs.existsSync(indexPath) && fs.existsSync(oldIndexPath)) {
    try {
      fs.renameSync(oldIndexPath, indexPath);
      console.log('[ActorIndexManager] Migrated index from .index.json to actors-index.json');
    } catch (error) {
      console.error('[ActorIndexManager] Failed to migrate index:', error.message);
    }
  }

  if (!fs.existsSync(indexPath)) {
    return {};
  }

  try {
    const data = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[ActorIndexManager] Failed to load index:', error.message);
    return {};
  }
}

/**
 * Save actor index to disk
 * @param {Object} index - Index mapping to save
 */
function saveIndex(index) {
  const indexPath = getIndexPath();
  const actorsPath = getActorsCachePath();

  // Ensure actors directory exists
  if (!fs.existsSync(actorsPath)) {
    fs.mkdirSync(actorsPath, { recursive: true });
  }

  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error('[ActorIndexManager] Failed to save index:', error.message);
    throw error;
  }
}

/**
 * Add name variant to index
 * @param {string} name - Name variant
 * @param {string} actorId - Actor ID
 * @param {boolean} autoSave - Auto-save index after update (default: true)
 * @returns {Object} - Updated index
 */
function addNameVariant(name, actorId, autoSave = true) {
  if (!name || !actorId) return;

  const index = loadIndex();
  const nameLower = name.toLowerCase().trim();

  // Add only the exact name - no automatic inversion
  index[nameLower] = actorId;

  if (autoSave) {
    saveIndex(index);
  }

  return index;
}

/**
 * Update index with all name variants for an actor
 * @param {Object} actor - Actor data with name, altName, otherNames
 */
function updateActorInIndex(actor) {
  if (!actor || !actor.id) {
    throw new Error('Actor must have an ID');
  }

  const index = loadIndex();
  const actorId = actor.id;

  // Helper to add name and its variants
  function addVariants(name) {
    if (!name) return;
    addNameVariant(name, actorId, false);
  }

  // Add main name
  addVariants(actor.name);

  // Split altName by comma and add each part
  if (actor.altName) {
    const altNames = actor.altName.split(',').map(n => n.trim()).filter(n => n);
    altNames.forEach(addVariants);
  }

  // Add other names array
  if (actor.otherNames && Array.isArray(actor.otherNames)) {
    actor.otherNames.forEach(addVariants);
  }

  // Save once after all updates
  saveIndex(index);
}

/**
 * Remove actor from index
 * @param {string} actorId - Actor ID to remove
 */
function removeActorFromIndex(actorId) {
  const index = loadIndex();
  let modified = false;

  // Remove all entries pointing to this actor ID
  Object.keys(index).forEach(key => {
    if (index[key] === actorId) {
      delete index[key];
      modified = true;
    }
  });

  if (modified) {
    saveIndex(index);
  }

  return modified;
}

/**
 * Resolve actor name to ID using index
 * @param {string} name - Actor name (any variant)
 * @returns {string|null} - Actor ID or null if not found
 */
function resolveActorId(name) {
  const index = loadIndex();
  const nameLower = name.toLowerCase().trim();

  // Only exact match - no inversion, no fuzzy matching
  // Name inversion logic should be handled by the scraper
  return index[nameLower] || null;
}

/**
 * Get all actors in index
 * @returns {Set<string>} - Set of unique actor IDs
 */
function getAllActorIds() {
  const index = loadIndex();
  return new Set(Object.values(index));
}

/**
 * Rebuild index from all actor NFO files
 * @returns {Object} - Statistics about rebuild
 */
function rebuildIndex() {
  const actorsPath = getActorsCachePath();

  if (!fs.existsSync(actorsPath)) {
    return { success: false, error: 'Actors path not found' };
  }

  const { nfoToActor } = require('../../scrapers/actors/schema');
  const newIndex = {};
  let processed = 0;
  let failed = 0;

  try {
    const files = fs.readdirSync(actorsPath);

    for (const file of files) {
      if (!file.endsWith('.nfo')) continue;

      const actorId = file.replace('.nfo', '');
      const actorPath = path.join(actorsPath, file);

      try {
        const nfoContent = fs.readFileSync(actorPath, 'utf-8');
        const actor = nfoToActor(nfoContent);
        actor.id = actorId;

        // Add all name variants to new index (exact names only)
        const addToIndex = (name) => {
          if (!name) return;
          const nameLower = name.toLowerCase().trim();
          newIndex[nameLower] = actorId;
        };

        // Add main name
        addToIndex(actor.name);

        // Split altName by comma and add each part
        if (actor.altName) {
          const altNames = actor.altName.split(',').map(n => n.trim()).filter(n => n);
          altNames.forEach(addToIndex);
        }

        // Add other names array
        if (actor.otherNames && Array.isArray(actor.otherNames)) {
          actor.otherNames.forEach(addToIndex);
        }

        processed++;
      } catch (error) {
        console.error(`[ActorIndexManager] Failed to process ${file}:`, error.message);
        failed++;
      }
    }

    // Save rebuilt index
    saveIndex(newIndex);

    return {
      success: true,
      processed,
      failed,
      totalEntries: Object.keys(newIndex).length,
      uniqueActors: new Set(Object.values(newIndex)).size
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  loadIndex,
  saveIndex,
  addNameVariant,
  updateActorInIndex,
  removeActorFromIndex,
  resolveActorId,
  getAllActorIds,
  rebuildIndex
};
