const express = require("express");
const catalog = require("./combat-achievements.json");
const syncedTaskIdsByCatalogId = require("./combat-achievement-sync-ids.json");

const STATUSES = new Set(["unplanned", "planned", "completed"]);
const taskIds = new Set(catalog.tasks.map((task) => task.id));
const SNAPSHOT_KEYS = ["achievementPoints", "clientRevision", "completedTaskIds", "playerName", "schemaVersion"];

function normalizePlayerName(name) {
  return String(name || "")
    .trim()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function characters(db) {
  const row = db.prepare("SELECT characters FROM goal_map_state WHERE singleton=1").get();
  return row ? JSON.parse(row.characters) : [];
}

function assertCharacter(db, character) {
  if (typeof character !== "string" || !characters(db).includes(character)) {
    throw new RangeError("character must name a current group member");
  }
}

function matchingCharacter(db, playerName) {
  const normalized = normalizePlayerName(playerName);
  return characters(db).find((character) => normalizePlayerName(character) === normalized);
}

function validateSnapshot(db, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).sort().join(",") !== SNAPSHOT_KEYS.join(",")) return null;
  const member = matchingCharacter(db, body.playerName);
  if (!member) throw new RangeError("playerName must name a current group member");
  if (
    body.schemaVersion !== 1 ||
    !Number.isSafeInteger(body.clientRevision) ||
    body.clientRevision < 0 ||
    !Number.isSafeInteger(body.achievementPoints) ||
    body.achievementPoints < 0 ||
    body.achievementPoints > 10000
  )
    return null;
  if (!Array.isArray(body.completedTaskIds) || body.completedTaskIds.length > 1000) return null;
  const ids = new Set(body.completedTaskIds);
  if (
    ids.size !== body.completedTaskIds.length ||
    body.completedTaskIds.some((taskId) => typeof taskId !== "string" || !/^CA_TASK_[A-Z0-9_]+_COMPLETED$/.test(taskId))
  )
    return null;
  return { ...body, playerName: member, normalizedPlayerName: normalizePlayerName(member) };
}

function readSnapshots(db, groupId) {
  return {
    schemaVersion: 1,
    snapshots: db
      .prepare(
        `SELECT player_name,client_revision,achievement_points,completed_task_ids,updated_at
         FROM combat_achievement_snapshots WHERE group_id=? ORDER BY normalized_player_name`
      )
      .all(groupId)
      .map((row) => ({
        schemaVersion: 1,
        playerName: row.player_name,
        clientRevision: row.client_revision,
        achievementPoints: row.achievement_points,
        completedTaskIds: JSON.parse(row.completed_task_ids),
        updatedAt: row.updated_at,
      })),
  };
}

function readCombatAchievementPlan(db, groupId, requestedCharacter) {
  const members = characters(db);
  const selectedCharacter = requestedCharacter || members[0] || null;
  if (selectedCharacter) assertCharacter(db, selectedCharacter);
  const progress = selectedCharacter
    ? db
        .prepare(
          "SELECT task_id,status,notes,updated_at FROM combat_achievement_plans WHERE group_id=? AND character=?"
        )
        .all(groupId, selectedCharacter)
    : [];
  const progressByTask = new Map(progress.map((row) => [row.task_id, row]));
  const settings = selectedCharacter
    ? db
        .prepare("SELECT external_points FROM combat_achievement_settings WHERE group_id=? AND character=?")
        .get(groupId, selectedCharacter)
    : undefined;
  const snapshot = selectedCharacter
    ? db
        .prepare(
          "SELECT client_revision,achievement_points,completed_task_ids,updated_at FROM combat_achievement_snapshots WHERE group_id=? AND normalized_player_name=?"
        )
        .get(groupId, normalizePlayerName(selectedCharacter))
    : undefined;
  const syncedTaskIds = new Set(snapshot ? JSON.parse(snapshot.completed_task_ids) : []);
  return {
    catalogVersion: catalog.version,
    verifiedAt: catalog.verifiedAt,
    sourceUrl: catalog.sourceUrl,
    rewardPoints: catalog.rewardPoints,
    tiers: catalog.tiers,
    characters: members,
    selectedCharacter,
    externalPoints: settings?.external_points || 0,
    syncedSnapshot: snapshot
      ? {
          clientRevision: snapshot.client_revision,
          achievementPoints: snapshot.achievement_points,
          updatedAt: snapshot.updated_at,
        }
      : null,
    tasks: catalog.tasks.map((task) => ({
      ...task,
      status: progressByTask.get(task.id)?.status || "unplanned",
      notes: progressByTask.get(task.id)?.notes || "",
      updatedAt: progressByTask.get(task.id)?.updated_at || null,
      syncedComplete: syncedTaskIds.has(syncedTaskIdsByCatalogId[task.id]),
    })),
  };
}

function readMediumPlan(db, groupId, requestedCharacter) {
  const plan = readCombatAchievementPlan(db, groupId, requestedCharacter);
  const medium = catalog.tiers.find((tier) => tier.name === "Medium");
  return {
    ...plan,
    tier: medium.name,
    rewardPoints: medium.rewardPoints,
    pointsPerTask: medium.pointsPerTask,
    tasks: plan.tasks.filter((task) => task.tier === medium.name),
  };
}

function createCombatAchievementsRouter(db, auth) {
  const router = express.Router({ mergeParams: true });
  router.use(auth);
  router.get("/combat-achievements/snapshots", (req, res) => res.json(readSnapshots(db, req.params.groupName)));
  router.put("/combat-achievements/snapshot", (req, res, next) => {
    try {
      if (req.body && Object.hasOwn(req.body, "schemaVersion") && req.body.schemaVersion !== 1) {
        return res.status(400).json({ error: "unsupported_schema_version" });
      }
      const snapshot = validateSnapshot(db, req.body);
      if (!snapshot) return res.status(400).json({ error: "invalid_combat_achievement_snapshot" });
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `INSERT INTO combat_achievement_snapshots
             (group_id,normalized_player_name,player_name,client_revision,achievement_points,completed_task_ids,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(group_id,normalized_player_name) DO UPDATE SET
             player_name=excluded.player_name,
             client_revision=excluded.client_revision,
             achievement_points=excluded.achievement_points,
             completed_task_ids=excluded.completed_task_ids,
             updated_at=excluded.updated_at
           WHERE combat_achievement_snapshots.client_revision <= excluded.client_revision`
        )
        .run(
          req.params.groupName,
          snapshot.normalizedPlayerName,
          snapshot.playerName,
          snapshot.clientRevision,
          snapshot.achievementPoints,
          JSON.stringify(snapshot.completedTaskIds),
          now
        );
      if (result.changes === 0) return res.status(409).json({ error: "stale_client_revision" });
      return res.json(
        readSnapshots(db, req.params.groupName).snapshots.find(
          (stored) => normalizePlayerName(stored.playerName) === snapshot.normalizedPlayerName
        )
      );
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_player_name" });
      return next(failure);
    }
  });
  router.get("/combat-achievements/all", (req, res, next) => {
    try {
      return res.json(readCombatAchievementPlan(db, req.params.groupName, req.query.character));
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_character" });
      return next(failure);
    }
  });
  router.get("/combat-achievements/medium", (req, res, next) => {
    try {
      return res.json(readMediumPlan(db, req.params.groupName, req.query.character));
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_character" });
      return next(failure);
    }
  });
  router.put(["/combat-achievements/all/progress", "/combat-achievements/medium/progress"], (req, res, next) => {
    try {
      const { character, taskId, status, notes = "" } = req.body || {};
      assertCharacter(db, character);
      if (!taskIds.has(taskId) || !STATUSES.has(status) || typeof notes !== "string" || notes.length > 500) {
        return res.status(400).json({ error: "invalid_combat_achievement_progress" });
      }
      const now = new Date().toISOString();
      if (status === "unplanned" && notes.length === 0) {
        db.prepare("DELETE FROM combat_achievement_plans WHERE group_id=? AND character=? AND task_id=?").run(
          req.params.groupName,
          character,
          taskId
        );
      } else {
        db.prepare(
          `INSERT INTO combat_achievement_plans (group_id,character,task_id,status,notes,updated_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(group_id,character,task_id) DO UPDATE SET
             status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at`
        ).run(req.params.groupName, character, taskId, status, notes, now);
      }
      const readPlan = req.path.includes("/all/") ? readCombatAchievementPlan : readMediumPlan;
      return res.json(readPlan(db, req.params.groupName, character));
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_character" });
      return next(failure);
    }
  });
  router.put("/combat-achievements/medium/settings", (req, res, next) => {
    try {
      const { character, externalPoints } = req.body || {};
      assertCharacter(db, character);
      if (!Number.isInteger(externalPoints) || externalPoints < 0 || externalPoints > 2697) {
        return res.status(400).json({ error: "invalid_combat_achievement_settings" });
      }
      db.prepare(
        `INSERT INTO combat_achievement_settings (group_id,character,external_points,updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(group_id,character) DO UPDATE SET
           external_points=excluded.external_points,updated_at=excluded.updated_at`
      ).run(req.params.groupName, character, externalPoints, new Date().toISOString());
      return res.json(readMediumPlan(db, req.params.groupName, character));
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_character" });
      return next(failure);
    }
  });
  return router;
}

module.exports = { createCombatAchievementsRouter, readCombatAchievementPlan, readMediumPlan };
