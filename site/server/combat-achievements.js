const express = require("express");
const catalog = require("./combat-achievements-medium.json");

const STATUSES = new Set(["unplanned", "planned", "completed"]);
const taskIds = new Set(catalog.tasks.map((task) => task.id));

function characters(db) {
  const row = db.prepare("SELECT characters FROM goal_map_state WHERE singleton=1").get();
  return row ? JSON.parse(row.characters) : [];
}

function assertCharacter(db, character) {
  if (typeof character !== "string" || !characters(db).includes(character)) {
    throw new RangeError("character must name a current group member");
  }
}

function readMediumPlan(db, groupId, requestedCharacter) {
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
  return {
    catalogVersion: catalog.version,
    verifiedAt: catalog.verifiedAt,
    sourceUrl: catalog.sourceUrl,
    tier: catalog.tier,
    rewardPoints: catalog.rewardPoints,
    pointsPerTask: catalog.pointsPerTask,
    characters: members,
    selectedCharacter,
    externalPoints: settings?.external_points || 0,
    tasks: catalog.tasks.map((task) => ({
      ...task,
      status: progressByTask.get(task.id)?.status || "unplanned",
      notes: progressByTask.get(task.id)?.notes || "",
      updatedAt: progressByTask.get(task.id)?.updated_at || null,
    })),
  };
}

function createCombatAchievementsRouter(db, auth) {
  const router = express.Router({ mergeParams: true });
  router.use(auth);
  router.get("/combat-achievements/medium", (req, res, next) => {
    try {
      return res.json(readMediumPlan(db, req.params.groupName, req.query.character));
    } catch (failure) {
      if (failure instanceof RangeError) return res.status(400).json({ error: "invalid_character" });
      return next(failure);
    }
  });
  router.put("/combat-achievements/medium/progress", (req, res, next) => {
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
      return res.json(readMediumPlan(db, req.params.groupName, character));
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

module.exports = { createCombatAchievementsRouter, readMediumPlan };
