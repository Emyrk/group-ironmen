const express = require("express");

const VERSION = 1;
const now = () => new Date().toISOString();
const etag = (revision) => `"${revision}"`;
const parseEtag = (value) => (/^"\d+"$/.test(value || "") ? Number(value.slice(1, -1)) : undefined);

function error(res, status, code, message, current) {
  return res.status(status).json({ error: code, message, ...(current ? { current } : {}) });
}

function validId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}

function metadata(row) {
  return {
    folderId: row.folder_id,
    name: row.name,
    revision: row.revision,
    deleted: row.deleted_at !== null,
  };
}

function document(row) {
  const deleted = row.deleted_at !== null;
  return {
    schemaVersion: VERSION,
    folderId: row.folder_id,
    name: row.name,
    iconItemId: row.icon_item_id,
    orderedTagIds: deleted ? [] : JSON.parse(row.ordered_tag_ids),
    revision: row.revision,
    deleted,
    updatedAt: row.updated_at,
  };
}

function manifest(db) {
  const state = db.prepare("SELECT * FROM bank_tag_folder_state WHERE singleton=1").get();
  return {
    schemaVersion: VERSION,
    groupRevision: state.group_revision,
    orderRevision: state.order_revision,
    orderedFolderIds: JSON.parse(state.ordered_folder_ids),
    folders: db
      .prepare("SELECT folder_id,name,revision,deleted_at FROM bank_tag_folders ORDER BY folder_id")
      .all()
      .map(metadata),
  };
}

function validateFolder(body, pathId) {
  if (!body || body.schemaVersion !== VERSION) return ["unsupported_schema", "schemaVersion must be 1"];
  if (body.folderId !== undefined && body.folderId !== pathId)
    return ["invalid_folder_id", "body folderId must match path id"];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > 50) return ["invalid_folder", "folder name must be between 1 and 50 characters"];
  if (!Number.isInteger(body.iconItemId) || body.iconItemId < 0)
    return ["invalid_folder", "iconItemId must be non-negative"];
  const orderedTagIds = body.orderedTagIds;
  if (
    !Array.isArray(orderedTagIds) ||
    orderedTagIds.some((id) => !validId(id)) ||
    new Set(orderedTagIds).size !== orderedTagIds.length
  )
    return ["invalid_folder", "orderedTagIds must contain unique lowercase UUID v4 values"];
  return [null, { name, iconItemId: body.iconItemId, orderedTagIds }];
}

function validateMembership(db, folderId, orderedTagIds) {
  if (!orderedTagIds.length) return null;
  const liveTagIds = new Set(
    db
      .prepare("SELECT tag_id FROM bank_tags WHERE deleted_at IS NULL")
      .all()
      .map((row) => row.tag_id)
  );
  const missing = orderedTagIds.find((tagId) => !liveTagIds.has(tagId));
  if (missing) return { status: 400, code: "invalid_folder", message: `tag ${missing} does not exist or is deleted` };

  const requested = new Set(orderedTagIds);
  const conflict = db
    .prepare(
      "SELECT folder_id,name,revision,deleted_at,ordered_tag_ids FROM bank_tag_folders WHERE deleted_at IS NULL AND folder_id<>?"
    )
    .all(folderId)
    .find((row) => JSON.parse(row.ordered_tag_ids).some((tagId) => requested.has(tagId)));
  if (!conflict) return null;
  const tagId = JSON.parse(conflict.ordered_tag_ids).find((id) => requested.has(id));
  return {
    status: 409,
    code: "tag_already_filed",
    message: `tag ${tagId} already belongs to folder ${conflict.folder_id}`,
    current: metadata(conflict),
  };
}

function detachTagFromFolder(db, tagId, timestamp = now()) {
  const matches = db
    .prepare("SELECT * FROM bank_tag_folders WHERE deleted_at IS NULL")
    .all()
    .map((row) => ({ row, tagIds: JSON.parse(row.ordered_tag_ids) }))
    .filter(({ tagIds }) => tagIds.includes(tagId));
  for (const { row, tagIds } of matches) {
    db.prepare("UPDATE bank_tag_folders SET ordered_tag_ids=?,revision=revision+1,updated_at=? WHERE folder_id=?").run(
      JSON.stringify(tagIds.filter((id) => id !== tagId)),
      timestamp,
      row.folder_id
    );
  }
  if (matches.length) {
    db.prepare("UPDATE bank_tag_folder_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1").run(
      timestamp
    );
  }
  return matches.length;
}

function createBankTagFoldersRouter(db, auth) {
  const router = express.Router({ mergeParams: true });
  router.use(auth);

  router.get("/bank-tag-folders", (req, res) => {
    const current = manifest(db);
    if (parseEtag(req.get("If-None-Match")) === current.groupRevision) return res.status(304).end();
    return res.set("ETag", etag(current.groupRevision)).json(current);
  });

  router.get("/bank-tag-folders/:folderId", (req, res) => {
    if (!validId(req.params.folderId))
      return error(res, 400, "invalid_folder_id", "folder id must be a lowercase UUID v4");
    const row = db.prepare("SELECT * FROM bank_tag_folders WHERE folder_id=?").get(req.params.folderId);
    if (!row) return error(res, 404, "folder_not_found", "folder was not found");
    return res.set("ETag", etag(row.revision)).json(document(row));
  });

  router.put("/bank-tag-folders/:folderId", (req, res) => {
    const id = req.params.folderId;
    if (!validId(id)) return error(res, 400, "invalid_folder_id", "folder id must be a lowercase UUID v4");
    const [problem, value] = validateFolder(req.body, id);
    if (problem) return error(res, 400, problem, value);
    const creating = req.get("If-None-Match") === "*";
    const expected = parseEtag(req.get("If-Match"));
    if (!creating && expected === undefined)
      return error(res, 428, "precondition_required", "If-Match or If-None-Match is required");
    let status;
    let result;
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM bank_tag_folders WHERE folder_id=?").get(id);
      if (creating && existing) {
        db.exec("ROLLBACK");
        return error(res, 409, "folder_exists", "folder id already exists", metadata(existing));
      }
      if (!creating && !existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "folder_not_found", "folder was not found");
      }
      if (!creating && existing.deleted_at !== null) {
        db.exec("ROLLBACK");
        return error(res, 409, "folder_deleted", "a deleted folder cannot be updated", metadata(existing));
      }
      if (!creating && existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(
          res,
          409,
          "stale_revision",
          `folder revision ${expected} is stale; current is ${existing.revision}`,
          metadata(existing)
        );
      }
      const membershipProblem = validateMembership(db, id, value.orderedTagIds);
      if (membershipProblem) {
        db.exec("ROLLBACK");
        return error(
          res,
          membershipProblem.status,
          membershipProblem.code,
          membershipProblem.message,
          membershipProblem.current
        );
      }
      const timestamp = now();
      const revision = creating ? 1 : expected + 1;
      if (creating) {
        db.prepare("INSERT INTO bank_tag_folders VALUES (?,?,?,?,?,NULL,?)").run(
          id,
          value.name,
          value.iconItemId,
          JSON.stringify(value.orderedTagIds),
          revision,
          timestamp
        );
        const state = db.prepare("SELECT * FROM bank_tag_folder_state WHERE singleton=1").get();
        const order = [...JSON.parse(state.ordered_folder_ids), id];
        db.prepare(
          "UPDATE bank_tag_folder_state SET group_revision=group_revision+1,order_revision=order_revision+1,ordered_folder_ids=?,updated_at=? WHERE singleton=1"
        ).run(JSON.stringify(order), timestamp);
        status = 201;
      } else {
        db.prepare(
          "UPDATE bank_tag_folders SET name=?,icon_item_id=?,ordered_tag_ids=?,revision=?,deleted_at=NULL,updated_at=? WHERE folder_id=?"
        ).run(value.name, value.iconItemId, JSON.stringify(value.orderedTagIds), revision, timestamp, id);
        db.prepare(
          "UPDATE bank_tag_folder_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1"
        ).run(timestamp);
        status = 200;
      }
      result = db.prepare("SELECT * FROM bank_tag_folders WHERE folder_id=?").get(id);
      db.exec("COMMIT");
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
    return res.status(status).set("ETag", etag(result.revision)).json(document(result));
  });

  router.delete("/bank-tag-folders/:folderId", (req, res) => {
    const id = req.params.folderId;
    if (!validId(id)) return error(res, 400, "invalid_folder_id", "folder id must be a lowercase UUID v4");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    db.exec("BEGIN IMMEDIATE");
    const existing = db.prepare("SELECT * FROM bank_tag_folders WHERE folder_id=?").get(id);
    if (!existing) {
      db.exec("ROLLBACK");
      return error(res, 404, "folder_not_found", "folder was not found");
    }
    if (existing.revision !== expected) {
      db.exec("ROLLBACK");
      return error(
        res,
        409,
        "stale_revision",
        `folder revision ${expected} is stale; current is ${existing.revision}`,
        metadata(existing)
      );
    }
    const timestamp = now();
    db.prepare(
      "UPDATE bank_tag_folders SET ordered_tag_ids='[]',revision=revision+1,deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE folder_id=?"
    ).run(timestamp, timestamp, id);
    const state = db.prepare("SELECT * FROM bank_tag_folder_state WHERE singleton=1").get();
    const previousOrder = JSON.parse(state.ordered_folder_ids);
    const order = previousOrder.filter((folderId) => folderId !== id);
    db.prepare(
      `UPDATE bank_tag_folder_state SET group_revision=group_revision+1,order_revision=order_revision+?,ordered_folder_ids=?,updated_at=? WHERE singleton=1`
    ).run(order.length === previousOrder.length ? 0 : 1, JSON.stringify(order), timestamp);
    const result = db.prepare("SELECT * FROM bank_tag_folders WHERE folder_id=?").get(id);
    db.exec("COMMIT");
    return res.set("ETag", etag(result.revision)).json(document(result));
  });

  router.put("/bank-folder-order", (req, res) => {
    if (!req.body || req.body.schemaVersion !== VERSION)
      return error(res, 400, "unsupported_schema", "schemaVersion must be 1");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    const ids = req.body.orderedFolderIds;
    if (!Array.isArray(ids) || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length)
      return error(res, 400, "invalid_order", "orderedFolderIds is invalid");
    db.exec("BEGIN IMMEDIATE");
    const current = manifest(db);
    if (current.orderRevision !== expected) {
      db.exec("ROLLBACK");
      return error(res, 409, "stale_revision", "bank tag folder order revision is stale", current);
    }
    const live = db
      .prepare("SELECT folder_id FROM bank_tag_folders WHERE deleted_at IS NULL ORDER BY folder_id")
      .all()
      .map((row) => row.folder_id)
      .sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(live)) {
      db.exec("ROLLBACK");
      return error(res, 400, "invalid_order", "orderedFolderIds must contain every non-deleted folder exactly once");
    }
    db.prepare(
      "UPDATE bank_tag_folder_state SET group_revision=group_revision+1,order_revision=order_revision+1,ordered_folder_ids=?,updated_at=? WHERE singleton=1"
    ).run(JSON.stringify(ids), now());
    const result = manifest(db);
    db.exec("COMMIT");
    return res.set("ETag", etag(result.orderRevision)).json(result);
  });

  return router;
}

module.exports = {
  createBankTagFoldersRouter,
  detachTagFromFolder,
  document,
  manifest,
  validId,
  validateFolder,
};
