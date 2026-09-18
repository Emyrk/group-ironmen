const express = require("express");
const diaryData = require("../public/data/diary_data.json");
const questData = require("../public/data/quest_data.json");
const { edges, nodes } = require("./goal-definitions");

const DEFINITION_VERSION = 8;
const REFRESH_MINUTES = 15;
const REFRESH_MS = REFRESH_MINUTES * 60 * 1000;
const ITEM_FIELDS = ["inventory", "equipment", "bank", "rune_pouch", "seed_vault"];
const SKILL_NAMES = [
  "Agility",
  "Attack",
  "Construction",
  "Cooking",
  "Crafting",
  "Defence",
  "Farming",
  "Firemaking",
  "Fishing",
  "Fletching",
  "Herblore",
  "Hitpoints",
  "Hunter",
  "Magic",
  "Mining",
  "Prayer",
  "Ranged",
  "Runecraft",
  "Slayer",
  "Smithing",
  "Strength",
  "Thieving",
  "Woodcutting",
  "Sailing",
];
const QUEST_IDS = Object.entries(questData)
  .filter(([, details]) => !details.hidden)
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);
const QUEST_ID_BY_NAME = new Map(Object.entries(questData).map(([id, details]) => [details.name, Number(id)]));

function levelForXp(xp) {
  let points = 0;
  for (let level = 1; level < 126; level += 1) {
    points += Math.floor(level + 300 * 2 ** (level / 7));
    if (xp < Math.floor(points / 4)) return level;
  }
  return 126;
}

function skillXp(member, name) {
  if (Array.isArray(member?.skills)) return Number(member.skills[SKILL_NAMES.indexOf(name)] || 0);
  const value = member?.skills?.[name];
  if (typeof value === "number") return value;
  if (typeof value?.xp === "number") return value.xp;
  return 0;
}

function itemTotals(members) {
  const totals = new Map();
  for (const member of members) {
    for (const field of ITEM_FIELDS) {
      const packed = member?.[field];
      if (!Array.isArray(packed)) continue;
      for (let index = 0; index + 1 < packed.length; index += 2) {
        const id = packed[index];
        const quantity = packed[index + 1];
        if (Number.isInteger(id) && id > 0 && Number.isFinite(quantity) && quantity > 0) {
          totals.set(id, (totals.get(id) || 0) + quantity);
        }
      }
    }
  }
  return totals;
}

function questState(member, questId) {
  if (Array.isArray(member?.quests)) {
    const index = QUEST_IDS.indexOf(questId);
    return index < 0 ? undefined : member.quests[index];
  }
  return member?.quests?.[questId];
}

function completeQuestState(state) {
  return state === 2 || state === "FINISHED";
}

function combatLevel(member) {
  const level = (skill) => levelForXp(skillXp(member, skill));
  const base = 0.25 * (level("Defence") + level("Hitpoints") + Math.floor(level("Prayer") / 2));
  const melee = 0.325 * (level("Attack") + level("Strength"));
  const ranged = 0.325 * Math.floor(level("Ranged") * 1.5);
  const magic = 0.325 * Math.floor(level("Magic") * 1.5);
  return Math.floor(base + Math.max(melee, ranged, magic));
}

function diaryTaskRequirements(member, requirementData = {}) {
  const requirements = Object.entries(requirementData.skills || {}).map(([skill, requiredLevel]) => {
    const level = levelForXp(skillXp(member, skill));
    return { type: "skill", skill, level, requiredLevel, complete: level >= requiredLevel };
  });
  for (const name of requirementData.quests || []) {
    const questId = QUEST_ID_BY_NAME.get(name);
    const state = questId === undefined ? undefined : questState(member, questId);
    requirements.push({
      type: "quest",
      name,
      questId: questId ?? null,
      state: state ?? "UNKNOWN",
      complete: completeQuestState(state),
    });
  }
  if (requirementData.combat) {
    const level = combatLevel(member);
    requirements.push({
      type: "combat",
      level,
      requiredLevel: requirementData.combat,
      complete: level >= requirementData.combat,
    });
  }
  return requirements;
}

const DIARY_CHECKS = {
  Morytania: {
    Easy: [
      [15, 1],
      [15, 2],
      [15, 3],
      [15, 4],
      [15, 5],
      [15, 6],
      [15, 7],
      [15, 8],
      [15, 9],
      [15, 10],
      [15, 11],
    ],
    Medium: [
      [15, 12],
      [15, 13],
      [15, 14],
      [15, 15],
      [15, 16],
      [15, 17],
      [15, 18],
      [15, 19],
      [15, 20],
      [15, 21],
      [15, 22],
    ],
    Hard: [
      [15, 23],
      [15, 24],
      [15, 25],
      [15, 26],
      [15, 27],
      [15, 28],
      [15, 29],
      [15, 30],
      [16, 1],
      [16, 2],
    ],
    Elite: [
      [16, 3],
      [16, 4],
      [16, 5],
      [16, 6],
      [16, 7],
      [16, 8],
    ],
  },
};

function diaryProgress(member, region, tier) {
  const checks = DIARY_CHECKS[region]?.[tier];
  const diaryVars = member?.diary_vars;
  if (!checks || !Array.isArray(diaryVars)) return null;
  const tasks = checks.map(([varIndex, bitIndex], index) => {
    const taskData = diaryData[region]?.[tier]?.[index];
    return {
      name: taskData?.task || `${region} ${tier} task ${index + 1}`,
      complete: ((Number(diaryVars[varIndex]) >>> bitIndex) & 1) === 1,
      requirements: diaryTaskRequirements(member, taskData?.requirements),
    };
  });
  return { completed: tasks.filter((task) => task.complete).length, total: tasks.length, tasks };
}

const customValidators = {
  "manual-observation": (_context, validator) => ({
    complete: false,
    progress: { current: 0, target: 1, observable: false },
    evidence: [{ type: "unobservable", message: validator.message }],
  }),
};

function evaluateValidator(validator, context) {
  if (validator.type === "skill") {
    const xp = skillXp(context.member, validator.skillName);
    const level = levelForXp(xp);
    return {
      complete: level >= validator.level,
      progress: { current: level, target: validator.level, unit: "level" },
      evidence: [{ type: "skill", skill: validator.skillName, level, xp, requiredLevel: validator.level }],
    };
  }
  if (validator.type === "quest") {
    const state = questState(context.member, validator.questId);
    const complete = completeQuestState(state);
    return {
      complete,
      progress: { current: complete ? 1 : 0, target: 1 },
      evidence: [{ type: "quest", questId: validator.questId, name: validator.name, state: state ?? "UNKNOWN" }],
    };
  }
  if (validator.type === "diary") {
    const progress = diaryProgress(context.member, validator.region, validator.tier);
    if (!progress) {
      return {
        complete: false,
        progress: { current: 0, target: 1, observable: false },
        evidence: [
          { type: "unobservable", message: `${validator.region} ${validator.tier} diary data is unavailable.` },
        ],
      };
    }
    return {
      complete: progress.completed === progress.total,
      progress: { current: progress.completed, target: progress.total, unit: "task" },
      evidence: [{ type: "diary", region: validator.region, tier: validator.tier, ...progress }],
    };
  }
  if (validator.type === "item") {
    const ids = [validator.itemId, ...(validator.alternatives || [])];
    const quantity = ids.reduce((sum, id) => sum + (context.items.get(id) || 0), 0);
    return {
      complete: quantity >= validator.quantity,
      progress: { current: Math.min(quantity, validator.quantity), target: validator.quantity, unit: "item" },
      evidence: [{ type: "item", itemId: validator.itemId, alternatives: validator.alternatives || [], quantity }],
    };
  }
  if (validator.type === "item-set" || validator.type === "every" || validator.type === "all") {
    const children = (validator.items || validator.validators || []).map((child) => evaluateValidator(child, context));
    return {
      complete: children.every((child) => child.complete),
      progress: { current: children.filter((child) => child.complete).length, target: children.length },
      evidence: children.flatMap((child) => child.evidence),
    };
  }
  if (validator.type === "any") {
    const children = validator.validators.map((child) => evaluateValidator(child, context));
    return {
      complete: children.some((child) => child.complete),
      progress: { current: children.some((child) => child.complete) ? 1 : 0, target: 1 },
      evidence: children.flatMap((child) => child.evidence),
    };
  }
  if (validator.type === "custom" && typeof validator.evaluate === "function") {
    return validator.evaluate(context, validator);
  }
  if (validator.type === "custom" && customValidators[validator.name]) {
    return customValidators[validator.name](context, validator);
  }
  return {
    complete: false,
    progress: { current: 0, target: 1, observable: false },
    evidence: [{ type: "unobservable", message: `Unknown validator ${validator.type}` }],
  };
}

function persistEvaluation(db, node, subjectType, subjectId, result, evaluatedAt) {
  const previous = db
    .prepare("SELECT complete,completed_at FROM goal_progress WHERE node_id=? AND subject_type=? AND subject_id=?")
    .get(node.id, subjectType, subjectId);
  const completedAt = previous?.completed_at || (result.complete ? evaluatedAt : null);
  db.prepare(
    `INSERT INTO goal_progress
      (node_id,subject_type,subject_id,complete,progress,evidence,completed_at,evaluated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(node_id,subject_type,subject_id) DO UPDATE SET
       complete=excluded.complete,progress=excluded.progress,evidence=excluded.evidence,
       completed_at=excluded.completed_at,evaluated_at=excluded.evaluated_at`
  ).run(
    node.id,
    subjectType,
    subjectId,
    result.complete ? 1 : 0,
    JSON.stringify(result.progress),
    JSON.stringify(result.evidence),
    completedAt,
    evaluatedAt
  );
  if (previous && Boolean(previous.complete) !== result.complete) {
    db.prepare(
      "INSERT INTO goal_progress_events (node_id,subject_type,subject_id,complete,occurred_at) VALUES (?,?,?,?,?)"
    ).run(node.id, subjectType, subjectId, result.complete ? 1 : 0, evaluatedAt);
  }
}

function evaluateGroupData(db, groupId, groupData, now = new Date()) {
  const members = Array.isArray(groupData) ? groupData.filter((member) => typeof member?.name === "string") : [];
  const characters = members.map((member) => member.name).sort((a, b) => a.localeCompare(b));
  const groupItems = itemTotals(members);
  const evaluatedAt = now.toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const node of nodes) {
      if (node.scope === "group") {
        persistEvaluation(
          db,
          node,
          "group",
          groupId,
          evaluateValidator(node.validator, { members, items: groupItems }),
          evaluatedAt
        );
        continue;
      }
      for (const member of members) {
        persistEvaluation(
          db,
          node,
          "character",
          member.name,
          evaluateValidator(node.validator, { member, members, items: itemTotals([member]) }),
          evaluatedAt
        );
      }
    }
    db.prepare("UPDATE goal_map_state SET characters=?,updated_at=?,definition_version=? WHERE singleton=1").run(
      JSON.stringify(characters),
      evaluatedAt,
      DEFINITION_VERSION
    );
    db.exec("COMMIT");
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
  return { characters, updatedAt: evaluatedAt };
}

async function refreshGoalMap(db, config, request, now = new Date()) {
  const state = db.prepare("SELECT updated_at,definition_version FROM goal_map_state WHERE singleton=1").get();
  if (
    state.definition_version === DEFINITION_VERSION &&
    state.updated_at &&
    now.getTime() - new Date(state.updated_at).getTime() < REFRESH_MS
  ) {
    return false;
  }
  const response = await request({
    method: "GET",
    url: `${config.upstreamBaseUrl}/api/group/${encodeURIComponent(config.upstreamGroupName)}/get-group-data`,
    responseType: "json",
    headers: { authorization: config.upstreamGroupToken },
    params: { from_time: new Date(0).toISOString() },
    timeout: 15000,
    maxContentLength: 10 * 1024 * 1024,
  });
  evaluateGroupData(db, config.privateGroupName, response.data, now);
  return true;
}

function nodeType(node) {
  if (node.type) return node.type;
  if (node.id === "fire-cape") return "goal";
  if (node.id === "barrows-ready" || node.id === "guardians-of-the-rift") return "activity";
  if (node.id === "fire-cape-stats" || node.id === "blood-rune-source" || node.id === "lantern-firemaking") {
    return "skill";
  }
  if (node.validator?.type === "item" || node.validator?.type === "item-set") return "item";
  return "unlock";
}

const GROUP_MANUAL_COMPLETION_SUBJECT = "__group__";

function setManualCompletion(db, groupId, nodeId, character, complete, now = new Date()) {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError("node must name a current goal");
  const state = db.prepare("SELECT characters FROM goal_map_state WHERE singleton=1").get();
  const characters = JSON.parse(state.characters);
  if (!characters.includes(character)) throw new RangeError("character must name a current group member");
  const subject = node.scope === "group" ? GROUP_MANUAL_COMPLETION_SUBJECT : character;
  if (complete) {
    db.prepare(
      `INSERT OR IGNORE INTO goal_manual_completions (group_id,node_id,character,completed_at)
       VALUES (?,?,?,?)`
    ).run(groupId, nodeId, subject, now.toISOString());
  } else {
    db.prepare("DELETE FROM goal_manual_completions WHERE group_id=? AND node_id=? AND character=?").run(
      groupId,
      nodeId,
      subject
    );
  }
}

function readGoalMap(db, groupId, requestedCharacter) {
  const state = db.prepare("SELECT characters,updated_at FROM goal_map_state WHERE singleton=1").get();
  const characters = JSON.parse(state.characters);
  const selectedCharacter = requestedCharacter || characters[0] || null;
  if (characters.length > 0 && !characters.includes(selectedCharacter)) {
    throw new RangeError("character must name a current group member");
  }
  const manualCompletions = new Map(
    selectedCharacter
      ? db
          .prepare(
            `SELECT node_id,character,completed_at FROM goal_manual_completions
             WHERE group_id=? AND character IN (?,?)`
          )
          .all(groupId, selectedCharacter, GROUP_MANUAL_COMPLETION_SUBJECT)
          .map((row) => [`${row.character}:${row.node_id}`, row.completed_at])
      : []
  );
  const enrichedNodes = nodes.map((node) => {
    const subjectId = node.scope === "group" ? groupId : selectedCharacter;
    const row = subjectId
      ? db
          .prepare(
            "SELECT complete,progress,evidence,completed_at FROM goal_progress WHERE node_id=? AND subject_type=? AND subject_id=?"
          )
          .get(node.id, node.scope, subjectId)
      : undefined;
    const automaticComplete = Boolean(row?.complete);
    const manualSubject = node.scope === "group" ? GROUP_MANUAL_COMPLETION_SUBJECT : selectedCharacter;
    const manuallyCompletedAt = manualCompletions.get(`${manualSubject}:${node.id}`) || null;
    const manualComplete = Boolean(manuallyCompletedAt);
    const complete = automaticComplete || manualComplete;
    const progress = row ? JSON.parse(row.progress) : { current: 0, target: 1, observable: false };
    const evidence = row
      ? JSON.parse(row.evidence)
      : [{ type: "unobservable", message: "No group data has been evaluated." }];
    const completedAt = automaticComplete ? row?.completed_at || null : manuallyCompletedAt || row?.completed_at || null;
    return {
      id: node.id,
      title: node.title,
      type: nodeType(node),
      scope: node.scope,
      category: node.category,
      description: node.description,
      wikiUrl: node.wikiUrl || node.metadata?.wikiUrl || null,
      recommended: Boolean(node.recommended),
      optional: Boolean(node.optional),
      complete,
      automaticComplete,
      manualComplete,
      manuallyCompletedAt,
      progress,
      evidence,
      completedAt,
      evaluated: { complete, automaticComplete, manualComplete, manuallyCompletedAt, progress, evidence, completedAt },
    };
  });
  return { updatedAt: state.updated_at, characters, selectedCharacter, nodes: enrichedNodes, edges };
}

function createGoalMapRouter(db, auth, config, request) {
  const router = express.Router({ mergeParams: true });
  let refreshPromise;
  const refresh = () => {
    if (!refreshPromise) {
      refreshPromise = refreshGoalMap(db, config, request).finally(() => {
        refreshPromise = undefined;
      });
    }
    return refreshPromise;
  };
  const timer = setInterval(() => {
    refresh().catch((failure) => console.error("Failed to refresh goal map", failure));
  }, REFRESH_MS);
  timer.unref?.();

  router.use(auth);
  router.get("/get-goal-map", async (req, res, next) => {
    try {
      await refresh();
      return res.json(readGoalMap(db, req.params.groupName, req.query.character));
    } catch (failure) {
      if (failure instanceof RangeError) {
        return res.status(400).json({ error: "invalid_character", message: failure.message });
      }
      return next(failure);
    }
  });
  router.put("/goal-map/manual-completion", async (req, res, next) => {
    try {
      await refresh();
      const { nodeId, character, complete } = req.body || {};
      if (typeof nodeId !== "string" || typeof character !== "string" || typeof complete !== "boolean") {
        return res.status(400).json({
          error: "invalid_manual_completion",
          message: "nodeId and character must be strings and complete must be a boolean",
        });
      }
      setManualCompletion(db, req.params.groupName, nodeId, character, complete);
      return res.json(readGoalMap(db, req.params.groupName, character));
    } catch (failure) {
      if (failure instanceof RangeError) {
        return res.status(400).json({ error: "invalid_manual_completion", message: failure.message });
      }
      return next(failure);
    }
  });

  return router;
}

module.exports = {
  REFRESH_MINUTES,
  createGoalMapRouter,
  evaluateGroupData,
  evaluateValidator,
  itemTotals,
  levelForXp,
  readGoalMap,
  refreshGoalMap,
};
