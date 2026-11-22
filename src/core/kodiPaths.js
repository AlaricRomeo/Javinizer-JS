const os = require("os");
const { execFileSync } = require("child_process");

/**
 * Translates a library path (as the server sees it) into the path Kodi opens.
 *
 * 1. Manual rules (config.kodi.pathMap) win: needed for NAS/NFS mounts,
 *    Docker, Windows, or shares Kodi reaches under another name.
 * 2. Otherwise, when Samba runs on this same machine, the share containing
 *    the folder is detected (testparm + usershares) and the path becomes
 *    smb://<host Kodi used to reach this server>/<share>/<rest>.
 */

const SHARES_TTL_MS = 60000;
const SKIP_SECTIONS = new Set(["global", "printers", "print$", "homes"]);
let _shares = null;
let _sharesAt = 0;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (_) {
    return "";
  }
}

// Parses "[name]" sections followed by "path = ..." / "path=..." lines
function parseShares(text) {
  const shares = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = SKIP_SECTIONS.has(section[1].toLowerCase()) ? null : section[1];
      continue;
    }
    const p = line.match(/^path\s*=\s*(.+)$/i);
    if (current && p) shares.push({ name: current, path: p[1].trim().replace(/\/+$/, "") || "/" });
  }
  return shares;
}

function getSambaShares() {
  if (process.platform === "win32") return [];
  if (_shares && Date.now() - _sharesAt < SHARES_TTL_MS) return _shares;
  _shares = [
    ...parseShares(run("testparm", ["-s"])),
    ...parseShares(run("net", ["usershare", "info"]))
  ];
  _sharesAt = Date.now();
  return _shares;
}

function isUnder(target, base) {
  return base === "/" || target === base || target.startsWith(base + "/");
}

/**
 * @param {string} localPath - absolute path on this server
 * @param {object} cfg - loaded config
 * @param {string} host - host/IP Kodi should use for smb:// (no port)
 * @returns {{path: string, source: "manual"|"samba", share?: string} | null}
 */
function resolveKodiPath(localPath, cfg, host) {
  const normalized = localPath.replace(/\\/g, "/");

  const rule = ((cfg.kodi && cfg.kodi.pathMap) || [])
    .map(m => ({ from: m.from.replace(/\\/g, "/").replace(/\/+$/, ""), to: m.to.replace(/\/+$/, "") }))
    .sort((a, b) => b.from.length - a.from.length)
    .find(m => isUnder(normalized, m.from));
  // Kodi takes smb:// paths unencoded, as in its own sources
  if (rule) return { path: rule.to + normalized.slice(rule.from.length), source: "manual" };

  if (!host) return null;
  const share = getSambaShares()
    .filter(s => isUnder(normalized, s.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!share) return null;
  const rest = share.path === "/" ? normalized : normalized.slice(share.path.length);
  return { path: `smb://${host}/${share.name}${rest}`, source: "samba", share: share.name };
}

/**
 * Host for smb:// URLs from the request's Host header; a loopback host
 * (browser on the server itself) is replaced with the first LAN IPv4.
 */
function hostFromRequest(req) {
  const host = req.hostname || "";
  if (host && !/^(localhost|127\.|::1$|\[::1\])/.test(host)) return host;
  for (const addrs of Object.values(os.networkInterfaces())) {
    const lan = (addrs || []).find(a => a.family === "IPv4" && !a.internal);
    if (lan) return lan.address;
  }
  return host;
}

module.exports = { resolveKodiPath, hostFromRequest, getSambaShares };
