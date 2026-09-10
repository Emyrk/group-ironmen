const express = require("express");
const { detachTagFromFolder } = require("./bank-tag-folders");

const VERSION = 1;
const MAX_ITEMS = 4000;
const now = () => new Date().toISOString();
const etag = (revision) => `"${revision}"`;
const parseEtag = (value) => (/^"\d+"$/.test(value || "") ? Number(value.slice(1, -1)) : undefined);

function error(res, status, code, message, current) {
  return res.status(status).json({ error: code, message, ...(current ? { current } : {}) });
}

function metadata(row) {
  return { tagId: row.tag_id, name: row.name, revision: row.revision, deleted: row.deleted_at !== null };
}

function document(row) {
  const deleted = row.deleted_at !== null;
  return {
    schemaVersion: VERSION,
    tagId: row.tag_id,
    name: row.name,
    iconItemId: row.icon_item_id,
    itemIds: deleted ? [] : JSON.parse(row.item_ids),
    layout: deleted ? null : row.layout === null ? null : JSON.parse(row.layout),
    revision: row.revision,
    deleted,
    updatedAt: row.updated_at,
  };
}

function recordRevision(db, row) {
  const value = document(row);
  db.prepare("INSERT OR REPLACE INTO bank_tag_revisions (tag_id,revision,document,stored_at) VALUES (?,?,?,?)").run(
    row.tag_id,
    row.revision,
    JSON.stringify(value),
    value.updatedAt
  );
}

function revisionSummary(value) {
  return {
    revision: value.revision,
    name: value.name,
    iconItemId: value.iconItemId,
    itemCount: value.itemIds.length,
    layoutCount: value.layout === null ? null : value.layout.length,
    deleted: value.deleted,
    updatedAt: value.updatedAt,
  };
}

function manifest(db) {
  const state = db.prepare("SELECT * FROM bank_tag_state WHERE singleton=1").get();
  return {
    schemaVersion: VERSION,
    groupRevision: state.group_revision,
    orderRevision: state.order_revision,
    orderedTagIds: JSON.parse(state.ordered_tag_ids),
    tags: db.prepare("SELECT tag_id,name,revision,deleted_at FROM bank_tags ORDER BY tag_id").all().map(metadata),
  };
}

function validId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}

function validateTag(body, pathId) {
  if (!body || body.schemaVersion !== VERSION) return ["unsupported_schema", "schemaVersion must be 1"];
  if (body.tagId !== undefined && body.tagId !== pathId) return ["invalid_tag_id", "body tagId must match path id"];
  const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
  if (!name || [...name].length > 50 || /[<>\/:,]/.test(name)) return ["invalid_tag", "invalid tag name"];
  if (!Number.isInteger(body.iconItemId) || body.iconItemId < 0)
    return ["invalid_tag", "iconItemId must be non-negative"];
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length > MAX_ITEMS ||
    body.itemIds.some((id, i) => !Number.isInteger(id) || id === 0 || (i && body.itemIds[i - 1] >= id))
  )
    return ["invalid_tag", "itemIds must be sorted ascending without duplicates"];
  if (
    body.layout !== null &&
    (!Array.isArray(body.layout) ||
      body.layout.length > MAX_ITEMS ||
      body.layout.some((id) => !Number.isInteger(id) || id === 0 || id < -1))
  )
    return ["invalid_tag", "layout entries must be -1 or positive"];
  return [null, { name, iconItemId: body.iconItemId, itemIds: body.itemIds, layout: body.layout }];
}

function createBankTagsRouter(db, auth) {
  const router = express.Router({ mergeParams: true });
  router.use(auth);

  router.get("/bank-tags", (req, res) => {
    const current = manifest(db);
    if (parseEtag(req.get("If-None-Match")) === current.groupRevision) return res.status(304).end();
    return res.set("ETag", etag(current.groupRevision)).json(current);
  });

  router.get("/bank-tags/:tagId", (req, res) => {
    if (!validId(req.params.tagId)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const row = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(req.params.tagId);
    if (!row) return error(res, 404, "tag_not_found", "tag was not found");
    return res.set("ETag", etag(row.revision)).json(document(row));
  });

  router.get("/bank-tags/:tagId/revisions", (req, res) => {
    if (!validId(req.params.tagId)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const revisions = db
      .prepare("SELECT document FROM bank_tag_revisions WHERE tag_id=? ORDER BY revision DESC")
      .all(req.params.tagId)
      .map((row) => revisionSummary(JSON.parse(row.document)));
    if (!revisions.length) return error(res, 404, "tag_not_found", "tag was not found");
    return res.json({ schemaVersion: VERSION, tagId: req.params.tagId, revisions });
  });

  router.get("/bank-tags/:tagId/revisions/:revision", (req, res) => {
    if (!validId(req.params.tagId)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const revision = Number(req.params.revision);
    if (!Number.isInteger(revision) || revision < 1) return error(res, 400, "invalid_tag", "revision must be positive");
    const row = db
      .prepare("SELECT document FROM bank_tag_revisions WHERE tag_id=? AND revision=?")
      .get(req.params.tagId, revision);
    if (!row) return error(res, 404, "tag_not_found", "tag revision was not found");
    return res.json(JSON.parse(row.document));
  });

  router.post("/bank-tags/:tagId/revisions/:revision/restore", (req, res) => {
    const id = req.params.tagId;
    if (!validId(id)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    const historical = db
      .prepare("SELECT document FROM bank_tag_revisions WHERE tag_id=? AND revision=?")
      .get(id, Number(req.params.revision));
    if (!historical) return error(res, 404, "tag_not_found", "tag revision was not found");
    const value = JSON.parse(historical.document);
    if (value.deleted) return error(res, 400, "invalid_tag", "a deleted revision cannot be restored");
    db.exec("BEGIN IMMEDIATE");
    const current = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
    if (!current) {
      db.exec("ROLLBACK");
      return error(res, 404, "tag_not_found", "tag was not found");
    }
    if (current.revision !== expected) {
      db.exec("ROLLBACK");
      return error(res, 409, "stale_revision", "tag revision is stale", metadata(current));
    }
    const timestamp = now();
    db.prepare(
      "UPDATE bank_tags SET name=?,icon_item_id=?,item_ids=?,layout=?,revision=revision+1,deleted_at=NULL,updated_at=? WHERE tag_id=?"
    ).run(
      value.name,
      value.iconItemId,
      JSON.stringify(value.itemIds),
      value.layout === null ? null : JSON.stringify(value.layout),
      timestamp,
      id
    );
    db.prepare("UPDATE bank_tag_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1").run(
      timestamp
    );
    const restored = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
    recordRevision(db, restored);
    db.exec("COMMIT");
    return res.set("ETag", etag(restored.revision)).json(document(restored));
  });

  router.put("/bank-tags/:tagId", (req, res) => {
    const id = req.params.tagId;
    if (!validId(id)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const [problem, value] = validateTag(req.body, id);
    if (problem) return error(res, 400, problem, value);
    const creating = req.get("If-None-Match") === "*";
    const expected = parseEtag(req.get("If-Match"));
    if (!creating && expected === undefined)
      return error(res, 428, "precondition_required", "If-Match or If-None-Match is required");
    let status;
    let result;
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
      if (creating && existing) {
        db.exec("ROLLBACK");
        return error(res, 409, "tag_exists", "tag id already exists", metadata(existing));
      }
      if (!creating && !existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "tag_not_found", "tag was not found");
      }
      if (!creating && existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(
          res,
          409,
          "stale_revision",
          `tag revision ${expected} is stale; current is ${existing.revision}`,
          metadata(existing)
        );
      }
      const duplicate = db
        .prepare("SELECT * FROM bank_tags WHERE name=? AND deleted_at IS NULL AND tag_id<>?")
        .get(value.name, id);
      if (duplicate) {
        db.exec("ROLLBACK");
        return error(
          res,
          409,
          "duplicate_name",
          `a non-deleted tag named \"${value.name}\" already exists`,
          metadata(duplicate)
        );
      }
      const timestamp = now();
      const revision = creating ? 1 : expected + 1;
      if (creating) {
        db.prepare("INSERT INTO bank_tags VALUES (?,?,?,?,?,?,NULL,?)").run(
          id,
          value.name,
          value.iconItemId,
          JSON.stringify(value.itemIds),
          value.layout === null ? null : JSON.stringify(value.layout),
          revision,
          timestamp
        );
        const state = db.prepare("SELECT * FROM bank_tag_state WHERE singleton=1").get();
        const order = [...JSON.parse(state.ordered_tag_ids), id];
        db.prepare(
          "UPDATE bank_tag_state SET group_revision=group_revision+1,order_revision=order_revision+1,ordered_tag_ids=?,updated_at=? WHERE singleton=1"
        ).run(JSON.stringify(order), timestamp);
        status = 201;
      } else {
        db.prepare(
          "UPDATE bank_tags SET name=?,icon_item_id=?,item_ids=?,layout=?,revision=?,deleted_at=NULL,updated_at=? WHERE tag_id=?"
        ).run(
          value.name,
          value.iconItemId,
          JSON.stringify(value.itemIds),
          value.layout === null ? null : JSON.stringify(value.layout),
          revision,
          timestamp,
          id
        );
        db.prepare("UPDATE bank_tag_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1").run(
          timestamp
        );
        status = 200;
      }
      result = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
      recordRevision(db, result);
      db.exec("COMMIT");
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
    return res.status(status).set("ETag", etag(result.revision)).json(document(result));
  });

  router.delete("/bank-tags/:tagId", (req, res) => {
    const id = req.params.tagId;
    if (!validId(id)) return error(res, 400, "invalid_tag_id", "tag id must be a lowercase UUID v4");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    db.exec("BEGIN IMMEDIATE");
    const existing = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
    if (!existing) {
      db.exec("ROLLBACK");
      return error(res, 404, "tag_not_found", "tag was not found");
    }
    if (existing.revision !== expected) {
      db.exec("ROLLBACK");
      return error(
        res,
        409,
        "stale_revision",
        `tag revision ${expected} is stale; current is ${existing.revision}`,
        metadata(existing)
      );
    }
    const timestamp = now();
    detachTagFromFolder(db, id, timestamp);
    db.prepare(
      "UPDATE bank_tags SET item_ids='[]',layout=NULL,revision=revision+1,deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE tag_id=?"
    ).run(timestamp, timestamp, id);
    const state = db.prepare("SELECT * FROM bank_tag_state WHERE singleton=1").get();
    const order = JSON.parse(state.ordered_tag_ids).filter((tagId) => tagId !== id);
    const changed = order.length !== JSON.parse(state.ordered_tag_ids).length;
    db.prepare(
      `UPDATE bank_tag_state SET group_revision=group_revision+1,order_revision=order_revision+?,ordered_tag_ids=?,updated_at=? WHERE singleton=1`
    ).run(changed ? 1 : 0, JSON.stringify(order), timestamp);
    const result = db.prepare("SELECT * FROM bank_tags WHERE tag_id=?").get(id);
    recordRevision(db, result);
    db.exec("COMMIT");
    return res.set("ETag", etag(result.revision)).json(document(result));
  });

  router.put("/bank-tag-order", (req, res) => {
    if (!req.body || req.body.schemaVersion !== VERSION)
      return error(res, 400, "unsupported_schema", "schemaVersion must be 1");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    const ids = req.body.orderedTagIds;
    if (!Array.isArray(ids) || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length)
      return error(res, 400, "invalid_order", "orderedTagIds is invalid");
    db.exec("BEGIN IMMEDIATE");
    const current = manifest(db);
    if (current.orderRevision !== expected) {
      db.exec("ROLLBACK");
      return error(res, 409, "stale_revision", "bank tag order revision is stale", current);
    }
    const live = db
      .prepare("SELECT tag_id FROM bank_tags WHERE deleted_at IS NULL ORDER BY tag_id")
      .all()
      .map((row) => row.tag_id)
      .sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(live)) {
      db.exec("ROLLBACK");
      return error(res, 400, "invalid_order", "orderedTagIds must contain every non-deleted tag exactly once");
    }
    db.prepare(
      "UPDATE bank_tag_state SET group_revision=group_revision+1,order_revision=order_revision+1,ordered_tag_ids=?,updated_at=? WHERE singleton=1"
    ).run(JSON.stringify(ids), now());
    const result = manifest(db);
    db.exec("COMMIT");
    return res.set("ETag", etag(result.orderRevision)).json(result);
  });

  return router;
}

module.exports = { createBankTagsRouter, document, manifest, validId, validateTag };
