#!/usr/bin/env node
/**
 * Starts Javinizer-js through its service (see src/core/serviceManager.js)
 * once the server started by hand has exited — spawned detached by
 * POST /service-restart, so the port is free when the service starts.
 *
 *   node bin/service-start.js --pid=<server pid>
 */
const { startService } = require("../src/core/serviceManager");

const pidArg = process.argv.find(a => a.startsWith("--pid="));
const pid = pidArg ? Number(pidArg.slice(6)) : 0;
const TIMEOUT_MS = 30000;

function alive(p) {
  try {
    process.kill(p, 0);
    return true;
  } catch (_) {
    return false;
  }
}

const startedAt = Date.now();
const timer = setInterval(() => {
  if (pid && alive(pid) && Date.now() - startedAt < TIMEOUT_MS) return;
  clearInterval(timer);
  try {
    startService();
  } catch (err) {
    console.error(`[service-start] ${err.message}`);
    process.exit(1);
  }
}, 500);
