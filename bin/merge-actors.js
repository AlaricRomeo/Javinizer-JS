#!/usr/bin/env node

/**
 * Merge Actors (semi-automatic)
 *
 * The startup duplicate-name check only detects candidates — deciding
 * whether two records are really the same person (vs. a real name
 * collision) needs a human. This tool does the mechanical part once you
 * decide: moves every name variant and movie link from the losing record
 * onto the winner, fills the winner's empty physical fields from the
 * loser, asks you to resolve any conflicting non-empty fields, then
 * deletes the loser.
 *
 * Usage:
 *   node bin/merge-actors.js                 List duplicate-name candidates
 *   node bin/merge-actors.js <id-a> <id-b>    Interactively merge two actors
 */

const readline = require('node:readline/promises');
const actorDb = require('../scrapers/actors/actorDb');

function printActor(label, id) {
  const actor = actorDb.getActor(id);
  const names = actorDb.getActorNames(id);
  const movies = actorDb.getMoviesForActor(id);

  console.log(`\n${label}: ${id}`);
  console.log(`  Primary:    ${names.primary || '(none)'}`);
  console.log(`  Alt:        ${names.alt.join(', ') || '(none)'}`);
  console.log(`  Birthdate:  ${actor.birthdate || '(empty)'}`);
  console.log(`  Height/Bust/Waist/Hips: ${actor.height || 0}/${actor.bust || 0}/${actor.waist || 0}/${actor.hips || 0}`);
  console.log(`  Sources:    ${actor.meta.sources.join(', ') || '(none)'}`);
  console.log(`  Movies:     ${movies.length}`);
  return actor;
}

function listDuplicates() {
  const duplicates = actorDb.findDuplicateNames();
  if (duplicates.length === 0) {
    console.log('No duplicate names found.');
    return;
  }

  const pairs = new Map();
  duplicates.forEach(d => {
    const ids = [...d.actorIds].sort();
    const key = ids.join('|');
    if (!pairs.has(key)) pairs.set(key, { ids, names: [] });
    pairs.get(key).names.push(d.name);
  });

  console.log(`${pairs.size} candidate group(s):\n`);
  for (const { ids, names } of pairs.values()) {
    console.log(`  ${ids.join('  <->  ')}`);
    console.log(`    shared name(s): ${names.join(', ')}`);
  }
  console.log(`\nRun: node bin/merge-actors.js <id1> <id2> to review and merge a pair.`);
}

async function resolveConflicts(rl, winnerId, loserId) {
  const winner = actorDb.getActor(winnerId);
  const loser = actorDb.getActor(loserId);
  const overrides = {};

  const fields = [
    ['birthdate', 'birthdate'],
    ['height', 'height'],
    ['bust', 'bust'],
    ['waist', 'waist'],
    ['hips', 'hips']
  ];

  for (const [label, key] of fields) {
    const w = winner[key];
    const l = loser[key];
    const wEmpty = w === '' || w === 0;
    const lEmpty = l === '' || l === 0;
    if (wEmpty || lEmpty || w === l) continue; // no conflict: fill-from-loser or already-agree handles it

    const answer = await rl.question(`  Conflict on ${label}: winner=${w}  loser=${l}  — keep [w]inner / [l]oser? `);
    overrides[key === 'birthdate' ? 'birthdate' : key] = answer.trim().toLowerCase() === 'l' ? l : w;
  }

  return overrides;
}

async function main() {
  const [idA, idB] = process.argv.slice(2);

  if (!idA && !idB) {
    listDuplicates();
    return;
  }

  if (!idA || !idB) {
    console.error('Usage: node bin/merge-actors.js <id1> <id2>');
    process.exit(1);
  }

  if (!actorDb.getActor(idA)) { console.error(`Actor not found: ${idA}`); process.exit(1); }
  if (!actorDb.getActor(idB)) { console.error(`Actor not found: ${idB}`); process.exit(1); }

  printActor('[1]', idA);
  printActor('[2]', idB);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const pick = await rl.question('\nQuale mantenere come record principale? [1/2] (invio per annullare) ');
    if (pick.trim() !== '1' && pick.trim() !== '2') {
      console.log('Annullato.');
      return;
    }
    const winnerId = pick.trim() === '1' ? idA : idB;
    const loserId = pick.trim() === '1' ? idB : idA;

    const overrides = await resolveConflicts(rl, winnerId, loserId);

    console.log(`\nUnisco ${loserId} dentro ${winnerId}...`);
    const confirm = await rl.question('Confermi? [y/N] ');
    if (confirm.trim().toLowerCase() !== 'y') {
      console.log('Annullato.');
      return;
    }

    const merged = actorDb.mergeActors(winnerId, loserId, overrides);
    console.log('\n✓ Merge completato.');
    console.log(JSON.stringify(merged, null, 2));
  } finally {
    rl.close();
  }
}

main();
