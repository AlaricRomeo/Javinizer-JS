#!/usr/bin/env node
/**
 * Standalone updater — spawned detached by the running server (see
 * src/core/updateManager.js::startUpdateProcess) so it can swap application
 * files and relaunch after the parent process has fully exited, which a
 * process can never do to itself.
 *
 * Never invoke directly outside of the WebUI's "Update available" flow,
 * except for manual recovery: node bin/apply-update.js --tag=vX.Y.Z
 * --version=X.Y.Z [--pid=<pid of a still-running server to wait out>]
 *
 * Progress is written to data/update-workdir/status.json (polled by
 * GET /update/status) and data/update-workdir/update.log (raw command
 * output, for debugging a failed run).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync, spawn } = require("child_process");

const REPO_OWNER = "AlaricRomeo";
const REPO_NAME = "Javinizer-JS";
const REPO_ROOT = path.join(__dirname, "..");
const UPDATE_DIR = path.join(REPO_ROOT, "data", "update-workdir");
const STATUS_PATH = path.join(UPDATE_DIR, "status.json");
const LOG_PATH = path.join(UPDATE_DIR, "update.log");
const ARCHIVE_PATH = path.join(UPDATE_DIR, "release.tar.gz");
const EXTRACT_DIR = path.join(UPDATE_DIR, "extracted");

// Never overwritten or deleted by the update — user data, secrets, and
// developer-local directories. Everything else at the repo root is treated
// as application code and replaced wholesale with what the release ships.
const PRESERVE = new Set([
  "config.json", "data", ".env", ".git", "node_modules",
  "scrapers-dev", ".claude", "todo.md"
]);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...rest] = a.replace(/^--/, "").split("=");
  return [k, rest.join("=")];
}));

function log(msg) {
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
}

function writeStatus(status) {
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForParentExit(pid, timeoutMs = 30000) {
  if (!pid) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      return; // process is gone
    }
    await sleep(500);
  }
  log(`Parent pid ${pid} still alive after ${timeoutMs}ms, proceeding anyway`);
}

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { "User-Agent": "Javinizer-JS-Updater" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        file.close();
        fs.rmSync(destPath, { force: true });
        return resolve(download(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

function run(cmd, cmdArgs) {
  log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  try {
    const output = execFileSync(cmd, cmdArgs, { cwd: REPO_ROOT });
    log(output.toString());
  } catch (err) {
    if (err.stdout) log(err.stdout.toString());
    if (err.stderr) log(err.stderr.toString());
    throw err;
  }
}

function replaceApplicationFiles() {
  for (const entry of fs.readdirSync(EXTRACT_DIR)) {
    if (PRESERVE.has(entry)) continue;

    const src = path.join(EXTRACT_DIR, entry);
    const dest = path.join(REPO_ROOT, entry);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
  }
}

function relaunchServer() {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "src/server/index.js")], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function main() {
  const { tag, version, pid } = args;
  if (!tag || !version) {
    console.error("[apply-update] Missing --tag or --version");
    process.exit(1);
  }

  writeStatus({ state: "waiting_for_shutdown", version, tag, startedAt: new Date().toISOString() });
  log(`Update to ${tag} requested`);

  await waitForParentExit(pid);

  let filesReplaced = false;
  try {
    writeStatus({ state: "downloading", version, tag });
    const archiveUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/tags/${tag}.tar.gz`;
    await download(archiveUrl, ARCHIVE_PATH);

    writeStatus({ state: "extracting", version, tag });
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    run("tar", ["xzf", ARCHIVE_PATH, "--strip-components=1", "-C", EXTRACT_DIR]);

    writeStatus({ state: "replacing_files", version, tag });
    replaceApplicationFiles();
    filesReplaced = true;

    writeStatus({ state: "installing_dependencies", version, tag });
    run("npm", ["install"]);

    writeStatus({ state: "migrating_database", version, tag });
    try {
      const { runPendingMigrations } = require(path.join(REPO_ROOT, "src/core/schemaMigrations"));
      const result = runPendingMigrations();
      log(`Migrations applied: ${result.applied}`);
    } catch (migrationErr) {
      log(`Migration error (non-fatal): ${migrationErr.message}`);
    }

    fs.rmSync(ARCHIVE_PATH, { force: true });
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });

    writeStatus({ state: "complete", version, tag, completedAt: new Date().toISOString() });
    log("Update complete");
  } catch (err) {
    log(`Update failed: ${err.message}`);
    writeStatus({ state: "failed", version, tag, error: err.message, filesReplaced });
  } finally {
    relaunchServer();
  }
}

main();
