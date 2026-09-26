#!/usr/bin/env node

/**
 * Detached watchdog for the shared javlibrary browser (see browser.js).
 * Usage: node browser-watchdog.js <chromePid> <stateFile> <idleMs>
 *
 * Kills Chrome once it has been unused for idleMs and no scrape process is
 * attached to it. Exits on its own if Chrome dies or gets replaced.
 */

const fs = require('fs');

const pid = Number(process.argv[2]);
const stateFile = process.argv[3];
const idleMs = Number(process.argv[4]);
const CHECK_INTERVAL_MS = 30000;

function isAlive(p) {
  if (!p) return false;
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch (_) {
    return null;
  }
}

setInterval(() => {
  const state = readState();

  // Browser gone or replaced by a newer one: nothing left to watch
  if (!state || state.pid !== pid) process.exit(0);
  if (!isAlive(pid)) {
    fs.rmSync(stateFile, { force: true });
    process.exit(0);
  }

  // A scrape is still attached (e.g. waiting for the user on Cloudflare)
  if (isAlive(state.busyPid)) return;

  if (Date.now() - (state.lastUsed || 0) >= idleMs) {
    try { process.kill(pid, process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL'); } catch (_) {}
    fs.rmSync(stateFile, { force: true });
    process.exit(0);
  }
}, CHECK_INTERVAL_MS);
