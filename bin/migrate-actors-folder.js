#!/usr/bin/env node

/**
 * Migrate per-movie actor folders to the Kodi layout (one-time, idempotent)
 *
 * For every movie folder directly under each library path:
 *  1. actors/ -> .actors/ (files already in .actors/ win over actors/)
 *  2. photos renamed to the NFO <name> with spaces -> "_"; jpg/png kept,
 *     .jpeg -> .jpg, webp/gif/... converted to jpg (Kodi reads jpg/png only)
 *  3. actor .nfo files renamed the same way, <thumblocal> updated
 *  4. movie NFO: actor <thumb> holding a javinizer-js internal path
 *     (e.g. "/actors/x.webp") replaced with the actor's remote URL
 *  5. actors/ removed only if empty afterwards
 *  6. with --prune: .actors/ files of actors not in the movie NFO cast removed
 *     (reported in any case)
 * Then rebuilds the actor index (bin/build-actor-index.js).
 *
 * Dry run by default: nothing is changed without --apply.
 *
 * Usage:
 *   node bin/migrate-actors-folder.js                 # dry run, whole library
 *   node bin/migrate-actors-folder.js --apply         # apply changes
 *   node bin/migrate-actors-folder.js --path <movie folder> [--apply]
 *   node bin/migrate-actors-folder.js --apply --prune # also remove orphans
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const { loadConfig, getLibraryPaths } = require('../src/core/config');
const { ACTORS_DIR, actorFileBase } = require('../src/core/kodiActors');
const { nfoActorThumb } = require('../src/core/saveNfo');

const LEGACY_DIR = 'actors';
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRUNE = args.includes('--prune');
const pathIdx = args.indexOf('--path');
const singlePath = pathIdx !== -1 ? args[pathIdx + 1] : null;

const stats = { folders: 0, photosMoved: 0, photosConverted: 0, nfosMoved: 0, movieNfos: 0, thumbs: 0, legacyRemoved: 0, orphans: 0, errors: 0 };

const splitName = file => {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? { base: file, ext: '' } : { base: file.slice(0, dot), ext: file.slice(dot + 1).toLowerCase() };
};

const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function log(msg) {
  console.log(`   ${APPLY ? '' : '[dry-run] '}${msg}`);
}

/**
 * Lists photo/nfo entries of a dir, grouped by Kodi target base name.
 * @returns {Map<string, Array<{full: string, file: string, ext: string, mtime: number, preferred: boolean}>>}
 */
function collect(dir, kind, groups, preferred) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const { base, ext } = splitName(entry.name);
    const isPhoto = IMAGE_EXTENSIONS.includes(ext);
    if ((kind === 'photo' && !isPhoto) || (kind === 'nfo' && ext !== 'nfo')) continue;
    const full = path.join(dir, entry.name);
    const target = actorFileBase(base);
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push({ full, file: entry.name, ext, mtime: fs.statSync(full).mtimeMs, preferred });
  }
}

// Most recently written file wins (old .actors/ folders from other tools
// must not override newer javinizer-js copies); ties go to .actors/
const pickWinner = list => [...list].sort((a, b) => (b.mtime - a.mtime) || (b.preferred - a.preferred))[0];

async function migrateActorsDir(movieDir) {
  const legacyDir = path.join(movieDir, LEGACY_DIR);
  const newDir = path.join(movieDir, ACTORS_DIR);
  if (!fs.existsSync(legacyDir) && !fs.existsSync(newDir)) return false;

  let changed = false;
  if (APPLY && !fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

  // Photos
  const photos = new Map();
  collect(newDir, 'photo', photos, true);
  collect(legacyDir, 'photo', photos, false);
  const savedExt = new Map(); // target base -> saved extension

  for (const [target, list] of photos) {
    const winner = pickWinner(list);
    const ext = winner.ext === 'png' ? 'png' : 'jpg';
    const dest = path.join(newDir, `${target}.${ext}`);
    savedExt.set(target, ext);

    try {
      if (winner.full !== dest) {
        changed = true;
        if (winner.ext === 'png' || winner.ext === 'jpg' || winner.ext === 'jpeg') {
          log(`move    ${path.relative(movieDir, winner.full)} -> ${path.relative(movieDir, dest)}`);
          if (APPLY) fs.copyFileSync(winner.full, dest);
          stats.photosMoved++;
        } else {
          log(`convert ${path.relative(movieDir, winner.full)} -> ${path.relative(movieDir, dest)}`);
          if (APPLY) await sharp(winner.full).jpeg({ quality: 92 }).toFile(dest);
          stats.photosConverted++;
        }
      }
      for (const e of list) {
        if (e.full === dest) continue;
        changed = true;
        if (e !== winner) log(`remove  ${path.relative(movieDir, e.full)} (duplicate)`);
        if (APPLY) fs.unlinkSync(e.full);
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ⚠️  ${winner.full}: ${err.message}`);
    }
  }

  // Actor .nfo files
  const nfos = new Map();
  collect(newDir, 'nfo', nfos, true);
  collect(legacyDir, 'nfo', nfos, false);

  for (const [target, list] of nfos) {
    const winner = pickWinner(list);
    const dest = path.join(newDir, `${target}.nfo`);
    try {
      const content = fs.readFileSync(winner.full, 'utf-8');
      const ext = savedExt.get(target);
      const updated = ext
        ? content.replace(/<thumblocal>[\s\S]*?<\/thumblocal>/, `<thumblocal>${escapeXml(`${target}.${ext}`)}</thumblocal>`)
        : content;

      if (winner.full !== dest || updated !== content) {
        changed = true;
        log(`nfo     ${path.relative(movieDir, winner.full)} -> ${path.relative(movieDir, dest)}`);
        if (APPLY) fs.writeFileSync(dest, updated, 'utf-8');
        stats.nfosMoved++;
      }
      for (const e of list) {
        if (e.full === dest) continue;
        changed = true;
        if (APPLY) fs.unlinkSync(e.full);
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ⚠️  ${winner.full}: ${err.message}`);
    }
  }

  // Orphans: files of actors no longer in the movie cast
  const cast = movieCast(movieDir);
  if (cast) {
    const targets = new Set([...photos.keys(), ...nfos.keys()]);
    for (const target of targets) {
      if (cast.has(target)) continue;
      const ext = savedExt.get(target);
      const files = [ext && `${target}.${ext}`, nfos.has(target) && `${target}.nfo`].filter(Boolean);
      for (const f of files) {
        stats.orphans++;
        console.log(`   ${PRUNE && APPLY ? '' : '[keep] '}orphan  ${ACTORS_DIR}/${f}${PRUNE ? '' : ' (use --prune to remove)'}`);
        if (PRUNE) {
          changed = true;
          if (APPLY) { try { fs.unlinkSync(path.join(newDir, f)); } catch (_) {} }
        }
      }
    }
  }

  // Legacy folder cleanup
  if (fs.existsSync(legacyDir)) {
    const left = APPLY ? fs.readdirSync(legacyDir) : fs.readdirSync(legacyDir).filter(f => {
      const { ext } = splitName(f);
      return !IMAGE_EXTENSIONS.includes(ext) && ext !== 'nfo';
    });
    if (left.length === 0) {
      changed = true;
      log(`rmdir   ${LEGACY_DIR}/`);
      if (APPLY) fs.rmdirSync(legacyDir);
      stats.legacyRemoved++;
    } else {
      console.log(`   ℹ️  ${LEGACY_DIR}/ kept, unexpected files left: ${left.join(', ')}`);
    }
  }

  return changed;
}

/**
 * Kodi file bases of the actors in the movie NFO(s), or null if no NFO cast.
 * @returns {Set<string>|null}
 */
function movieCast(movieDir) {
  const names = new Set();
  for (const file of fs.readdirSync(movieDir).filter(f => f.toLowerCase().endsWith('.nfo'))) {
    const content = fs.readFileSync(path.join(movieDir, file), 'utf-8');
    for (const m of content.matchAll(/<actor>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/actor>/g)) {
      names.add(actorFileBase(unescapeXml(m[1].trim())));
    }
  }
  return names.size > 0 ? names : null;
}

function migrateMovieNfos(movieDir) {
  let changed = false;
  const nfoFiles = fs.readdirSync(movieDir).filter(f => f.toLowerCase().endsWith('.nfo'));

  for (const file of nfoFiles) {
    const full = path.join(movieDir, file);
    try {
      const content = fs.readFileSync(full, 'utf-8');
      let count = 0;
      const updated = content.replace(/<actor>([\s\S]*?)<\/actor>/g, (block, inner) => {
        const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/);
        const thumbMatch = inner.match(/<thumb>([\s\S]*?)<\/thumb>/);
        if (!nameMatch || !thumbMatch) return block;
        const thumb = unescapeXml(thumbMatch[1].trim());
        if (!thumb || /^https?:\/\//i.test(thumb)) return block;
        const remote = nfoActorThumb({ name: unescapeXml(nameMatch[1].trim()), thumb });
        if (remote === thumb) return block;
        count++;
        return block.replace(thumbMatch[0], `<thumb>${escapeXml(remote)}</thumb>`);
      });

      if (count > 0) {
        changed = true;
        log(`thumbs  ${file}: ${count} actor thumb(s) -> remote URL`);
        if (APPLY) fs.writeFileSync(full, updated, 'utf-8');
        stats.movieNfos++;
        stats.thumbs += count;
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ⚠️  ${full}: ${err.message}`);
    }
  }
  return changed;
}

function listMovieFolders() {
  if (singlePath) {
    if (!fs.existsSync(singlePath)) {
      console.error(`Path not found: ${singlePath}`);
      process.exit(1);
    }
    return [path.resolve(singlePath)];
  }
  const roots = getLibraryPaths(loadConfig()).filter(root => fs.existsSync(root));
  if (roots.length === 0) {
    console.error('No library paths configured or reachable.');
    process.exit(1);
  }
  const folders = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) folders.push(path.join(root, entry.name));
    }
  }
  return folders;
}

async function main() {
  console.log(`🎭 Migrating actor folders to Kodi layout (${APPLY ? 'APPLY' : 'dry run'})`);
  console.log('='.repeat(60));

  const folders = listMovieFolders();
  for (const movieDir of folders) {
    try {
      const header = `\n📁 ${movieDir}`;
      // Buffer output per folder so untouched folders stay silent
      const originalLog = console.log;
      const lines = [];
      console.log = (...a) => lines.push(a.join(' '));
      let changed;
      try {
        changed = (await migrateActorsDir(movieDir)) | migrateMovieNfos(movieDir);
      } finally {
        console.log = originalLog;
      }
      if (lines.length > 0) {
        console.log(header);
        lines.forEach(l => console.log(l));
      }
      if (changed) stats.folders++;
    } catch (err) {
      stats.errors++;
      console.error(`⚠️  ${movieDir}: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Movie folders scanned:  ${folders.length}`);
  console.log(`Movie folders changed:  ${stats.folders}`);
  console.log(`Photos moved/renamed:   ${stats.photosMoved}`);
  console.log(`Photos converted (jpg): ${stats.photosConverted}`);
  console.log(`Actor .nfo moved:       ${stats.nfosMoved}`);
  console.log(`Movie NFOs updated:     ${stats.movieNfos} (${stats.thumbs} thumb(s))`);
  console.log(`Legacy actors/ removed: ${stats.legacyRemoved}`);
  console.log(`Orphan files:           ${stats.orphans}${PRUNE ? (APPLY ? ' (removed)' : ' (would be removed)') : ' (kept, use --prune)'}`);
  console.log(`Errors:                 ${stats.errors}`);

  if (!APPLY) {
    console.log('\nDry run: nothing was changed. Re-run with --apply to migrate.');
    return;
  }

  if (singlePath) {
    console.log('\nSingle folder mode: actor index not rebuilt (run node bin/build-actor-index.js if needed).');
  } else if (stats.folders > 0) {
    console.log('\nRebuilding actor index...');
    spawnSync(process.execPath, [path.join(__dirname, 'build-actor-index.js')], { stdio: 'inherit' });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
