#!/usr/bin/env node
/**
 * Minimum Node.js version check, against "engines.node" in package.json —
 * the single place to raise it. Used by start.sh / start.bat (exit code 0 =
 * ok, 1 = too old: they then download a newer private copy) and by the
 * server itself at startup (src/server/index.js).
 *
 * Plain ES5 on purpose: it must run, and fail cleanly, on very old Node.js.
 */
var path = require("path");

function requiredVersion() {
  var pkg = require(path.join(__dirname, "..", "package.json"));
  var range = (pkg.engines && pkg.engines.node) || "";
  var m = range.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : null;
}

function isSupported(version) {
  var min = requiredVersion();
  if (!min) return true;
  var cur = version.replace(/^v/, "").split(".").map(Number);
  var req = min.split(".").map(Number);
  for (var i = 0; i < 3; i++) {
    if (cur[i] !== req[i]) return cur[i] > req[i];
  }
  return true;
}

module.exports = { requiredVersion: requiredVersion, isSupported: isSupported };

if (require.main === module) {
  // --required: print the minimum version (for the start scripts' messages)
  if (process.argv[2] === "--required") {
    console.log(requiredVersion() || "");
    process.exit(0);
  }
  process.exit(isSupported(process.versions.node) ? 0 : 1);
}
