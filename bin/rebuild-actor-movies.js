#!/usr/bin/env node
/**
 * Rebuild the actor_movies index for the current library — wipes it and
 * rewrites it from scratch by reading every item's actor list straight out
 * of its NFO (see src/core/actorMoviesIndexer.js).
 *
 * Runs as its own process, spawned detached by the server whenever
 * libraryPaths change (see POST /config in src/server/routes.js) — never
 * in-process, since a full scan does synchronous, blocking file I/O for
 * every item and would otherwise freeze the single-threaded server for the
 * whole run (seconds on a warm OS cache, up to tens of seconds cold on a
 * large library).
 *
 * Safe to re-run manually too: node bin/rebuild-actor-movies.js
 */
const path = require("path");
const { loadConfig, getLibraryPaths } = require("../src/core/config");
const LibraryReader = require("../src/core/libraryReader");
const { rebuildActorMoviesIndex } = require("../src/core/actorMoviesIndexer");

async function main() {
  const config = loadConfig();
  const libraryPaths = getLibraryPaths(config);
  if (libraryPaths.length === 0) {
    console.error("[rebuild-actor-movies] No libraryPaths configured, nothing to do");
    process.exit(1);
  }

  console.log(`[rebuild-actor-movies] Scanning ${libraryPaths.join(", ")}...`);
  const libraryReader = new LibraryReader(libraryPaths, config.actorsPath);

  const start = Date.now();
  const { total, links } = await rebuildActorMoviesIndex(libraryReader, msg =>
    console.log(`[rebuild-actor-movies] ${msg}`)
  );
  console.log(`[rebuild-actor-movies] Done in ${Date.now() - start}ms — ${links} link(s) across ${total} movie(s)`);
}

main().catch(err => {
  console.error("[rebuild-actor-movies] Failed:", err.message);
  process.exit(1);
});
