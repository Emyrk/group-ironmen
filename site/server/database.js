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
    CREATE TABLE IF NOT EXISTS bank_tag_revisions (
      tag_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      document TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      PRIMARY KEY (tag_id, revision)
    );
    INSERT OR IGNORE INTO bank_tag_revisions (tag_id, revision, document, stored_at)
      SELECT tag_id, revision, json_object(
        'schemaVersion', 1,
        'tagId', tag_id,
        'name', name,
        'iconItemId', icon_item_id,
        'itemIds', json(item_ids),
        'layout', CASE WHEN layout IS NULL THEN NULL ELSE json(layout) END,
        'revision', revision,
        'deleted', deleted_at IS NOT NULL,
        'updatedAt', updated_at
      ), updated_at
      FROM bank_tags;
    CREATE TABLE IF NOT EXISTS bank_tag_folder_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      group_revision INTEGER NOT NULL DEFAULT 0,
      order_revision INTEGER NOT NULL DEFAULT 0,
      ordered_folder_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO bank_tag_folder_state
      (singleton, group_revision, order_revision, ordered_folder_ids, updated_at)
      VALUES (1, 0, 0, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    CREATE TABLE IF NOT EXISTS bank_tag_folders (
      folder_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_item_id INTEGER NOT NULL,
      ordered_tag_ids TEXT NOT NULL,
      revision INTEGER NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_setup_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      group_revision INTEGER NOT NULL DEFAULT 0,
      setup_order_revision INTEGER NOT NULL DEFAULT 0,
      section_order_revision INTEGER NOT NULL DEFAULT 0,
      ordered_setup_ids TEXT NOT NULL DEFAULT '[]',
      ordered_section_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO inventory_setup_state
      (singleton, group_revision, setup_order_revision, section_order_revision, ordered_setup_ids, ordered_section_ids, updated_at)
      VALUES (1, 0, 0, 0, '[]', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    CREATE TABLE IF NOT EXISTS inventory_setups (
      setup_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT NOT NULL,
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_setups_live_name
      ON inventory_setups(lower(name)) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS inventory_setup_sections (
      section_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_color INTEGER,
      ordered_setup_ids TEXT NOT NULL,
      revision INTEGER NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_setup_sections_live_name
      ON inventory_setup_sections(lower(name)) WHERE deleted_at IS NULL;
  `);
  return db;
}

module.exports = { openDatabase };
