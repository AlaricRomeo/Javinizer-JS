/**
 * GitHub Releases update checker + trigger.
 *
 * The version check runs once at server startup (see index.js) and the
 * result is cached in memory for the process lifetime — GET /update/check
 * just serves that cache, so opening the WebUI never fires its own GitHub
 * API call. Applying an update hands off to the standalone bin/apply-update.js
 * script (spawned detached) since a running Node process can't swap its own
 * files or relaunch itself.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const REPO_OWNER = "AlaricRomeo";
const REPO_NAME = "Javinizer-JS";
const REPO_ROOT = path.join(__dirname, "../..");

const UPDATE_DIR = path.join(process.cwd(), "data", "update-workdir");
const STATUS_PATH = path.join(UPDATE_DIR, "status.json");

let cachedCheck = null;

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Javinizer-JS-UpdateChecker",
        "Accept": "application/vnd.github+json"
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(fetchJson(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GitHub API returned ${res.statusCode}`));
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

async function checkForUpdate() {
  const pkg = require("../../package.json");
  const currentVersion = pkg.version;

  const release = await fetchJson(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
  const latestVersion = (release.tag_name || "").replace(/^v/, "");

  return {
    ok: true,
    currentVersion,
    latestVersion,
    tag: release.tag_name,
    updateAvailable: !!latestVersion && compareVersions(latestVersion, currentVersion) > 0,
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    name: release.name
  };
}

/**
 * Runs once at server startup, caches the result for the process lifetime.
 * Never throws — a failed check (offline, rate-limited, ...) just leaves the
 * cache empty and the WebUI badge hidden.
 */
async function initUpdateCheck() {
  try {
    cachedCheck = await checkForUpdate();
    if (cachedCheck.updateAvailable) {
      console.log(`[UpdateManager] Update available: v${cachedCheck.currentVersion} -> v${cachedCheck.latestVersion}`);
    }
  } catch (err) {
    console.error("[UpdateManager] Startup version check failed:", err.message);
    cachedCheck = { ok: false, error: err.message };
  }
}

function getCachedCheck() {
  return cachedCheck || { ok: false, error: "Update check has not completed yet" };
}

function writeStatus(status) {
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), "utf8");
}

function readUpdateStatus() {
  if (!fs.existsSync(STATUS_PATH)) return { state: "idle" };
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch {
    return { state: "idle" };
  }
}

/**
 * Hands off to bin/apply-update.js, detached so it survives this process
 * exiting. The caller (route handler) is responsible for exiting the server
 * shortly after calling this, once the HTTP response has flushed.
 */
function startUpdateProcess({ tag, version }) {
  writeStatus({ state: "starting", version, tag, startedAt: new Date().toISOString() });

  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "bin", "apply-update.js"), `--tag=${tag}`, `--version=${version}`, `--pid=${process.pid}`],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore" }
  );
  child.unref();
}

module.exports = {
  compareVersions,
  checkForUpdate,
  initUpdateCheck,
  getCachedCheck,
  startUpdateProcess,
  readUpdateStatus
};
