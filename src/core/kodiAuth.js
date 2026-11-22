const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Password + token auth for the Kodi API (/kodi/*).
 *
 * The password is stored in config.json only as a scrypt hash
 * (config.kodi.passwordHash = "salt:hash", hex). A successful login returns a
 * random token, persisted in data/kodi-tokens.json so the Kodi add-on can
 * remember it across server restarts. Changing the password revokes every
 * token.
 */

const TOKENS_PATH = path.join(process.cwd(), "data", "kodi-tokens.json");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// In-memory copy: every image request is token-checked
let _tokens = null;

function loadTokens() {
  if (_tokens) return _tokens;
  try {
    const data = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    _tokens = Array.isArray(data.tokens) ? data.tokens : [];
  } catch (_) {
    _tokens = [];
  }
  return _tokens;
}

function saveTokens(tokens) {
  _tokens = tokens;
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify({ tokens }, null, 2), "utf8");
}

// Tokens are stored hashed: a leaked tokens file can't be replayed.
function digest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueToken(device) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokens = loadTokens().slice();
  tokens.push({ hash: digest(token), device: String(device || "kodi").slice(0, 80), createdAt: new Date().toISOString() });
  saveTokens(tokens);
  return token;
}

function isValidToken(token) {
  if (!token || typeof token !== "string") return false;
  const h = digest(token);
  return loadTokens().some(t => t.hash === h);
}

function revokeToken(token) {
  if (!token) return;
  const h = digest(token);
  saveTokens(loadTokens().filter(t => t.hash !== h));
}

function revokeAllTokens() {
  saveTokens([]);
}

module.exports = { hashPassword, verifyPassword, issueToken, isValidToken, revokeToken, revokeAllTokens };
