/**
 * Versioned SQLite migrations for data/actors-index.db, tracked via
 * PRAGMA user_version so the update flow (bin/apply-update.js) can bring an
 * older DB up to date right after swapping in new application code.
 *
 * No-op today — MIGRATIONS is empty until a release actually needs a schema
 * change; add { version, up(db) } entries here when that happens.
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "../../data/actors-index.db");

const MIGRATIONS = [
  // { version: 1, up(db) { db.exec("ALTER TABLE actors ADD COLUMN example TEXT DEFAULT ''"); } }
];

function runPendingMigrations() {
  if (!fs.existsSync(DB_PATH)) return { applied: 0 };

  const db = new DatabaseSync(DB_PATH);
  try {
    const currentVersion = db.prepare("PRAGMA user_version").get().user_version;
    const pending = MIGRATIONS
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    let applied = 0;
    for (const migration of pending) {
      db.exec("BEGIN");
      try {
        migration.up(db);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec("COMMIT");
        applied++;
      } catch (err) {
        db.exec("ROLLBACK");
        throw new Error(`Migration ${migration.version} failed: ${err.message}`);
      }
    }
    return { applied };
  } finally {
    db.close();
  }
}

module.exports = { runPendingMigrations, MIGRATIONS };
