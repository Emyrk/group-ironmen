const express = require("express");

const VERSION = 1;
const now = () => new Date().toISOString();
const etag = (revision) => `"${revision}"`;
const parseEtag = (value) => (/^"\d+"$/.test(value || "") ? Number(value.slice(1, -1)) : undefined);
const validId = (id) =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

function error(res, status, code, message, current) {
  return res.status(status).json({ error: code, message, ...(current ? { current } : {}) });
}

function setupMetadata(row) {
  return { setupId: row.setup_id, name: row.name, revision: row.revision, deleted: row.deleted_at !== null };
}

function sectionMetadata(row) {
  return { sectionId: row.section_id, name: row.name, revision: row.revision, deleted: row.deleted_at !== null };
}

function setupDocument(row) {
  const deleted = row.deleted_at !== null;
  return {
    schemaVersion: VERSION,
    setupId: row.setup_id,
    name: row.name,
    notes: row.notes,
    payload: deleted ? {} : JSON.parse(row.payload),
    revision: row.revision,
    deleted,
    updatedAt: row.updated_at,
  };
}

function sectionDocument(row) {
  const deleted = row.deleted_at !== null;
  return {
    schemaVersion: VERSION,
    sectionId: row.section_id,
    name: row.name,
    displayColor: row.display_color,
    orderedSetupIds: deleted ? [] : JSON.parse(row.ordered_setup_ids),
    revision: row.revision,
    deleted,
    updatedAt: row.updated_at,
  };
}

function manifest(db) {
  const state = db.prepare("SELECT * FROM inventory_setup_state WHERE singleton=1").get();
  return {
    schemaVersion: VERSION,
    groupRevision: state.group_revision,
    setupOrderRevision: state.setup_order_revision,
    sectionOrderRevision: state.section_order_revision,
    orderedSetupIds: JSON.parse(state.ordered_setup_ids),
    orderedSectionIds: JSON.parse(state.ordered_section_ids),
    setups: db
      .prepare("SELECT setup_id,name,revision,deleted_at FROM inventory_setups ORDER BY setup_id")
      .all()
      .map(setupMetadata),
    sections: db
      .prepare("SELECT section_id,name,revision,deleted_at FROM inventory_setup_sections ORDER BY section_id")
      .all()
      .map(sectionMetadata),
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function hasOnlyKeys(body, allowed) {
  return Object.keys(body).every((key) => allowed.has(key));
}

function validateSetup(body, pathId) {
  if (!body || body.schemaVersion !== VERSION) return ["unsupported_schema", "schemaVersion must be 1"];
  const allowed = new Set(["schemaVersion", "setupId", "name", "notes", "payload", "revision", "deleted", "updatedAt"]);
  if (!hasOnlyKeys(body, allowed)) return ["invalid_setup", "setup contains unknown fields"];
  if (body.setupId !== undefined && body.setupId !== pathId)
    return ["invalid_setup_id", "body setupId must match path id"];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > 50) return ["invalid_setup", "setup name must be between 1 and 50 characters"];
  if (typeof body.notes !== "string") return ["invalid_setup", "notes must be a string"];
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))
    return ["invalid_setup", "payload must be an object"];
  return [null, { name, notes: body.notes, payload: canonicalValue(body.payload) }];
}

function validateSection(body, pathId) {
  if (!body || body.schemaVersion !== VERSION) return ["unsupported_schema", "schemaVersion must be 1"];
  const allowed = new Set([
    "schemaVersion",
    "sectionId",
    "name",
    "displayColor",
    "orderedSetupIds",
    "revision",
    "deleted",
    "updatedAt",
  ]);
  if (!hasOnlyKeys(body, allowed)) return ["invalid_section", "section contains unknown fields"];
  if (body.sectionId !== undefined && body.sectionId !== pathId)
    return ["invalid_section_id", "body sectionId must match path id"];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > 50) return ["invalid_section", "section name must be between 1 and 50 characters"];
  if (
    body.displayColor !== null &&
    (!Number.isInteger(body.displayColor) || body.displayColor < -2147483648 || body.displayColor > 2147483647)
  )
    return ["invalid_section", "displayColor must be null or a signed 32-bit integer"];
  const ids = body.orderedSetupIds;
  if (!Array.isArray(ids) || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length)
    return ["invalid_section", "orderedSetupIds must contain unique lowercase UUID v4 values"];
  return [null, { name, displayColor: body.displayColor, orderedSetupIds: ids }];
}

function duplicateName(db, table, idColumn, id, name) {
  return db
    .prepare(`SELECT * FROM ${table} WHERE lower(name)=lower(?) AND deleted_at IS NULL AND ${idColumn}<>?`)
    .get(name, id);
}

function requireLiveSetups(db, ids) {
  const live = new Set(
    db
      .prepare("SELECT setup_id FROM inventory_setups WHERE deleted_at IS NULL")
      .all()
      .map((row) => row.setup_id)
  );
  return ids.find((id) => !live.has(id));
}

function createInventorySetupsRouter(db, auth) {
  const router = express.Router({ mergeParams: true });
  router.use(auth);

  router.get("/inventory-setups", (req, res) => {
    const current = manifest(db);
    if (parseEtag(req.get("If-None-Match")) === current.groupRevision) return res.status(304).end();
    return res.set("ETag", etag(current.groupRevision)).json(current);
  });

  router.get("/inventory-setups/:setupId", (req, res) => {
    const id = req.params.setupId;
    if (!validId(id)) return error(res, 400, "invalid_setup_id", "setup id must be a lowercase UUID v4");
    const row = db.prepare("SELECT * FROM inventory_setups WHERE setup_id=?").get(id);
    if (!row) return error(res, 404, "setup_not_found", "setup was not found");
    if (parseEtag(req.get("If-None-Match")) === row.revision) return res.status(304).end();
    return res.set("ETag", etag(row.revision)).json(setupDocument(row));
  });

  router.put("/inventory-setups/:setupId", (req, res) => {
    const id = req.params.setupId;
    if (!validId(id)) return error(res, 400, "invalid_setup_id", "setup id must be a lowercase UUID v4");
    const [problem, value] = validateSetup(req.body, id);
    if (problem) return error(res, 400, problem, value);
    const creating = req.get("If-None-Match") === "*";
    const expected = parseEtag(req.get("If-Match"));
    if (!creating && expected === undefined)
      return error(res, 428, "precondition_required", "If-Match or If-None-Match is required");
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM inventory_setups WHERE setup_id=?").get(id);
      if (creating && existing) {
        db.exec("ROLLBACK");
        return error(res, 409, "setup_exists", "setup id already exists", setupMetadata(existing));
      }
      if (!creating && !existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "setup_not_found", "setup was not found");
      }
      if (!creating && existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(res, 409, "stale_revision", "setup revision is stale", setupMetadata(existing));
      }
      const duplicate = duplicateName(db, "inventory_setups", "setup_id", id, value.name);
      if (duplicate) {
        db.exec("ROLLBACK");
        return error(
          res,
          409,
          "duplicate_name",
          `a non-deleted setup named "${value.name}" already exists`,
          setupMetadata(duplicate)
        );
      }
      const timestamp = now();
      const revision = creating ? 1 : expected + 1;
      const wasDeleted = existing?.deleted_at !== null;
      if (creating) {
        db.prepare("INSERT INTO inventory_setups VALUES (?,?,?,?,?,NULL,?)").run(
          id,
          value.name,
          value.notes,
          JSON.stringify(value.payload),
          revision,
          timestamp
        );
        const state = db.prepare("SELECT ordered_setup_ids FROM inventory_setup_state WHERE singleton=1").get();
        db.prepare(
          "UPDATE inventory_setup_state SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+1,ordered_setup_ids=?,updated_at=? WHERE singleton=1"
        ).run(JSON.stringify([...JSON.parse(state.ordered_setup_ids), id]), timestamp);
      } else {
        db.prepare(
          "UPDATE inventory_setups SET name=?,notes=?,payload=?,revision=?,deleted_at=NULL,updated_at=? WHERE setup_id=?"
        ).run(value.name, value.notes, JSON.stringify(value.payload), revision, timestamp, id);
        if (wasDeleted) {
          const state = db.prepare("SELECT ordered_setup_ids FROM inventory_setup_state WHERE singleton=1").get();
          const order = JSON.parse(state.ordered_setup_ids);
          if (!order.includes(id)) order.push(id);
          db.prepare(
            "UPDATE inventory_setup_state SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+1,ordered_setup_ids=?,updated_at=? WHERE singleton=1"
          ).run(JSON.stringify(order), timestamp);
        } else {
          db.prepare(
            "UPDATE inventory_setup_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1"
          ).run(timestamp);
        }
      }
      const result = db.prepare("SELECT * FROM inventory_setups WHERE setup_id=?").get(id);
      db.exec("COMMIT");
      return res
        .status(creating ? 201 : 200)
        .set("ETag", etag(result.revision))
        .json(setupDocument(result));
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
  });

  router.delete("/inventory-setups/:setupId", (req, res) => {
    const id = req.params.setupId;
    if (!validId(id)) return error(res, 400, "invalid_setup_id", "setup id must be a lowercase UUID v4");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM inventory_setups WHERE setup_id=?").get(id);
      if (!existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "setup_not_found", "setup was not found");
      }
      if (existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(res, 409, "stale_revision", "setup revision is stale", setupMetadata(existing));
      }
      const timestamp = now();
      for (const section of db.prepare("SELECT * FROM inventory_setup_sections WHERE deleted_at IS NULL").all()) {
        const previous = JSON.parse(section.ordered_setup_ids);
        if (previous.includes(id)) {
          db.prepare(
            "UPDATE inventory_setup_sections SET ordered_setup_ids=?,revision=revision+1,updated_at=? WHERE section_id=?"
          ).run(JSON.stringify(previous.filter((setupId) => setupId !== id)), timestamp, section.section_id);
        }
      }
      db.prepare(
        "UPDATE inventory_setups SET payload='{}',revision=revision+1,deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE setup_id=?"
      ).run(timestamp, timestamp, id);
      const state = db.prepare("SELECT ordered_setup_ids FROM inventory_setup_state WHERE singleton=1").get();
      const previousOrder = JSON.parse(state.ordered_setup_ids);
      const order = previousOrder.filter((setupId) => setupId !== id);
      db.prepare(
        "UPDATE inventory_setup_state SET group_revision=group_revision+1,setup_order_revision=setup_order_revision+?,ordered_setup_ids=?,updated_at=? WHERE singleton=1"
      ).run(order.length === previousOrder.length ? 0 : 1, JSON.stringify(order), timestamp);
      const result = db.prepare("SELECT * FROM inventory_setups WHERE setup_id=?").get(id);
      db.exec("COMMIT");
      return res.set("ETag", etag(result.revision)).json(setupDocument(result));
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
  });

  router.put("/inventory-setup-order", (req, res) => updateOrder(req, res, db, "setup"));

  router.get("/inventory-setup-sections/:sectionId", (req, res) => {
    const id = req.params.sectionId;
    if (!validId(id)) return error(res, 400, "invalid_section_id", "section id must be a lowercase UUID v4");
    const row = db.prepare("SELECT * FROM inventory_setup_sections WHERE section_id=?").get(id);
    if (!row) return error(res, 404, "section_not_found", "section was not found");
    if (parseEtag(req.get("If-None-Match")) === row.revision) return res.status(304).end();
    return res.set("ETag", etag(row.revision)).json(sectionDocument(row));
  });

  router.put("/inventory-setup-sections/:sectionId", (req, res) => {
    const id = req.params.sectionId;
    if (!validId(id)) return error(res, 400, "invalid_section_id", "section id must be a lowercase UUID v4");
    const [problem, value] = validateSection(req.body, id);
    if (problem) return error(res, 400, problem, value);
    const creating = req.get("If-None-Match") === "*";
    const expected = parseEtag(req.get("If-Match"));
    if (!creating && expected === undefined)
      return error(res, 428, "precondition_required", "If-Match or If-None-Match is required");
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM inventory_setup_sections WHERE section_id=?").get(id);
      if (creating && existing) {
        db.exec("ROLLBACK");
        return error(res, 409, "section_exists", "section id already exists", sectionMetadata(existing));
      }
      if (!creating && !existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "section_not_found", "section was not found");
      }
      if (!creating && existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(res, 409, "stale_revision", "section revision is stale", sectionMetadata(existing));
      }
      const missing = requireLiveSetups(db, value.orderedSetupIds);
      if (missing) {
        db.exec("ROLLBACK");
        return error(res, 400, "invalid_section", `setup ${missing} does not exist or is deleted`);
      }
      const duplicate = duplicateName(db, "inventory_setup_sections", "section_id", id, value.name);
      if (duplicate) {
        db.exec("ROLLBACK");
        return error(
          res,
          409,
          "duplicate_name",
          `a non-deleted section named "${value.name}" already exists`,
          sectionMetadata(duplicate)
        );
      }
      const timestamp = now();
      const revision = creating ? 1 : expected + 1;
      const wasDeleted = existing?.deleted_at !== null;
      if (creating) {
        db.prepare("INSERT INTO inventory_setup_sections VALUES (?,?,?,?,?,NULL,?)").run(
          id,
          value.name,
          value.displayColor,
          JSON.stringify(value.orderedSetupIds),
          revision,
          timestamp
        );
        const state = db.prepare("SELECT ordered_section_ids FROM inventory_setup_state WHERE singleton=1").get();
        db.prepare(
          "UPDATE inventory_setup_state SET group_revision=group_revision+1,section_order_revision=section_order_revision+1,ordered_section_ids=?,updated_at=? WHERE singleton=1"
        ).run(JSON.stringify([...JSON.parse(state.ordered_section_ids), id]), timestamp);
      } else {
        db.prepare(
          "UPDATE inventory_setup_sections SET name=?,display_color=?,ordered_setup_ids=?,revision=?,deleted_at=NULL,updated_at=? WHERE section_id=?"
        ).run(value.name, value.displayColor, JSON.stringify(value.orderedSetupIds), revision, timestamp, id);
        if (wasDeleted) {
          const state = db.prepare("SELECT ordered_section_ids FROM inventory_setup_state WHERE singleton=1").get();
          const order = JSON.parse(state.ordered_section_ids);
          if (!order.includes(id)) order.push(id);
          db.prepare(
            "UPDATE inventory_setup_state SET group_revision=group_revision+1,section_order_revision=section_order_revision+1,ordered_section_ids=?,updated_at=? WHERE singleton=1"
          ).run(JSON.stringify(order), timestamp);
        } else {
          db.prepare(
            "UPDATE inventory_setup_state SET group_revision=group_revision+1,updated_at=? WHERE singleton=1"
          ).run(timestamp);
        }
      }
      const result = db.prepare("SELECT * FROM inventory_setup_sections WHERE section_id=?").get(id);
      db.exec("COMMIT");
      return res
        .status(creating ? 201 : 200)
        .set("ETag", etag(result.revision))
        .json(sectionDocument(result));
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
  });

  router.delete("/inventory-setup-sections/:sectionId", (req, res) => {
    const id = req.params.sectionId;
    if (!validId(id)) return error(res, 400, "invalid_section_id", "section id must be a lowercase UUID v4");
    const expected = parseEtag(req.get("If-Match"));
    if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT * FROM inventory_setup_sections WHERE section_id=?").get(id);
      if (!existing) {
        db.exec("ROLLBACK");
        return error(res, 404, "section_not_found", "section was not found");
      }
      if (existing.revision !== expected) {
        db.exec("ROLLBACK");
        return error(res, 409, "stale_revision", "section revision is stale", sectionMetadata(existing));
      }
      const timestamp = now();
      db.prepare(
        "UPDATE inventory_setup_sections SET ordered_setup_ids='[]',revision=revision+1,deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE section_id=?"
      ).run(timestamp, timestamp, id);
      const state = db.prepare("SELECT ordered_section_ids FROM inventory_setup_state WHERE singleton=1").get();
      const previous = JSON.parse(state.ordered_section_ids);
      const order = previous.filter((sectionId) => sectionId !== id);
      db.prepare(
        "UPDATE inventory_setup_state SET group_revision=group_revision+1,section_order_revision=section_order_revision+?,ordered_section_ids=?,updated_at=? WHERE singleton=1"
      ).run(order.length === previous.length ? 0 : 1, JSON.stringify(order), timestamp);
      const result = db.prepare("SELECT * FROM inventory_setup_sections WHERE section_id=?").get(id);
      db.exec("COMMIT");
      return res.set("ETag", etag(result.revision)).json(sectionDocument(result));
    } catch (failure) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw failure;
    }
  });

  router.put("/inventory-setup-section-order", (req, res) => updateOrder(req, res, db, "section"));
  return router;
}

function updateOrder(req, res, db, kind) {
  if (!req.body || req.body.schemaVersion !== VERSION)
    return error(res, 400, "unsupported_schema", "schemaVersion must be 1");
  const expected = parseEtag(req.get("If-Match"));
  if (expected === undefined) return error(res, 428, "precondition_required", "If-Match is required");
  const setup = kind === "setup";
  const field = setup ? "orderedSetupIds" : "orderedSectionIds";
  const ids = req.body[field];
  if (!Array.isArray(ids) || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length)
    return error(res, 400, "invalid_order", `${field} is invalid`);
  try {
    db.exec("BEGIN IMMEDIATE");
    const current = manifest(db);
    const revisionField = setup ? "setupOrderRevision" : "sectionOrderRevision";
    if (current[revisionField] !== expected) {
      db.exec("ROLLBACK");
      return error(res, 409, "stale_revision", `inventory ${kind} order revision is stale`, current);
    }
    const table = setup ? "inventory_setups" : "inventory_setup_sections";
    const idColumn = setup ? "setup_id" : "section_id";
    const live = db
      .prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE deleted_at IS NULL ORDER BY ${idColumn}`)
      .all()
      .map((row) => row.id)
      .sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(live)) {
      db.exec("ROLLBACK");
      return error(res, 400, "invalid_order", `${field} must contain every non-deleted ${kind} exactly once`);
    }
    const column = setup ? "ordered_setup_ids" : "ordered_section_ids";
    const revisionColumn = setup ? "setup_order_revision" : "section_order_revision";
    db.prepare(
      `UPDATE inventory_setup_state SET group_revision=group_revision+1,${revisionColumn}=${revisionColumn}+1,${column}=?,updated_at=? WHERE singleton=1`
    ).run(JSON.stringify(ids), now());
    const result = manifest(db);
    db.exec("COMMIT");
    return res.set("ETag", etag(result[revisionField])).json(result);
  } catch (failure) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw failure;
  }
}

module.exports = { createInventorySetupsRouter, manifest, setupDocument, sectionDocument, validId };
