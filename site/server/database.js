const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS bank_tag_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      group_revision INTEGER NOT NULL DEFAULT 0,
      order_revision INTEGER NOT NULL DEFAULT 0,
      ordered_tag_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO bank_tag_state
      (singleton, group_revision, order_revision, ordered_tag_ids, updated_at)
      VALUES (1, 0, 0, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    CREATE TABLE IF NOT EXISTS bank_tags (
      tag_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_item_id INTEGER NOT NULL,
      item_ids TEXT NOT NULL,
      layout TEXT,
      revision INTEGER NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bank_tags_live_name
      ON bank_tags(name) WHERE deleted_at IS NULL;
  `);
  return db;
}

module.exports = { openDatabase };
