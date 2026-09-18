// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appModule from "../server/app";
import databaseModule from "../server/database";
import goalMapModule from "../server/goal-map";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { createApp } = appModule;
const { evaluateGroupData, readGoalMap, refreshGoalMap } = goalMapModule;

function call(server, url = "/api/group/gim/get-goal-map", authorization = "private-token") {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: url,
        headers: { Authorization: authorization },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: body ? JSON.parse(body) : null }));
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function put(server, url, body, authorization = "private-token") {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: "PUT",
        path: url,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => (responseBody += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, body: responseBody ? JSON.parse(responseBody) : null })
        );
      }
    );
    request.on("error", reject);
    request.end(payload);
  });
}

function member(name, bank = [], diaryVars = []) {
  return {
    name,
    bank,
    inventory: [],
    equipment: [],
    rune_pouch: [],
    seed_vault: [],
    skills: {},
    quests: {},
    diary_vars: diaryVars,
  };
}

describe("goal map database migration", () => {
  it("adds the definition version after initializing an existing goal map state table", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-map-migration-"));
    const filename = path.join(directory, "test.sqlite3");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE goal_map_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        characters TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT
      );
      INSERT INTO goal_map_state (singleton, characters, updated_at) VALUES (1, '["Alice"]', NULL);
    `);
    legacy.close();

    const migrated = databaseModule.openDatabase(filename);
    expect(
      migrated.prepare("SELECT characters,definition_version FROM goal_map_state WHERE singleton=1").get()
    ).toEqual({
      characters: '["Alice"]',
      definition_version: 0,
    });
    migrated.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("private goal map service", () => {
  let directory;
  let server;
  let db;
  let request;
  let groupData;
  const config = {
    port: 0,
    privateGroupName: "gim",
    privateSyncToken: "private-token",
    upstreamBaseUrl: "https://groupiron.men",
    upstreamGroupName: "upstream",
    upstreamGroupToken: "upstream-token",
  };

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-map-"));
    config.databasePath = path.join(directory, "test.sqlite3");
    groupData = [member("Alice", [6570, 1, 4724, 1, 4726, 1, 995, 1000]), member("Bob", [4728, 1, 4730, 1])];
    request = vi.fn(async () => ({ status: 200, headers: {}, data: groupData }));
    const created = createApp(config, { request });
    db = created.db;
    server = created.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("authenticates and serves the goal map locally with character and group scope", async () => {
    expect(await call(server, "/api/group/gim/get-goal-map", "wrong-token")).toMatchObject({ status: 401 });

    const response = await call(server);

    expect(response.status).toBe(200);
    expect(response.body.characters).toEqual(["Alice", "Bob"]);
    expect(response.body.selectedCharacter).toBe("Alice");
    expect(response.body.updatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(response.body.edges.length).toBeGreaterThan(0);
    expect(response.body.edges.every((edge) => typeof edge.type === "string")).toBe(true);
    expect(response.body.nodes.find((node) => node.id === "fire-cape")).toMatchObject({
      type: "goal",
      complete: true,
      scope: "character",
      wikiUrl: "https://oldschool.runescape.wiki/w/Fire_cape",
      completedAt: expect.any(String),
      evaluated: { complete: true, completedAt: expect.any(String) },
    });
    expect(response.body.nodes.find((node) => node.id === "guthans-set")).toMatchObject({
      complete: true,
      scope: "group",
      progress: { current: 4, target: 4 },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({
      url: "https://groupiron.men/api/group/upstream/get-group-data",
      headers: { authorization: "upstream-token" },
    });
  });

  it("evaluates character nodes for the selected character and rejects unknown names", async () => {
    const bob = await call(server, "/api/group/gim/get-goal-map?character=Bob");
    expect(bob.status).toBe(200);
    expect(bob.body.selectedCharacter).toBe("Bob");
    expect(bob.body.nodes.find((node) => node.id === "fire-cape").complete).toBe(false);
    expect(bob.body.nodes.find((node) => node.id === "guthans-set").complete).toBe(true);

    expect(await call(server, "/api/group/gim/get-goal-map?character=Nobody")).toMatchObject({
      status: 400,
      body: { error: "invalid_character" },
    });
  });

  it("persists manual goal completion per character until it is undone", async () => {
    await call(server);
    const url = "/api/group/gim/goal-map/manual-completion";

    const completed = await put(server, url, {
      nodeId: "fossil-island-teaks",
      character: "Alice",
      complete: true,
    });
    expect(completed.status).toBe(200);
    expect(completed.body.nodes.find((node) => node.id === "fossil-island-teaks")).toMatchObject({
      complete: true,
      automaticComplete: false,
      manualComplete: true,
      manuallyCompletedAt: expect.any(String),
      evaluated: { complete: true, automaticComplete: false, manualComplete: true },
    });

    evaluateGroupData(db, "gim", groupData, new Date("2026-09-18T13:00:00.000Z"));
    const persisted = await call(server, "/api/group/gim/get-goal-map?character=Alice");
    expect(persisted.body.nodes.find((node) => node.id === "fossil-island-teaks").manualComplete).toBe(true);
    const bob = await call(server, "/api/group/gim/get-goal-map?character=Bob");
    expect(bob.body.nodes.find((node) => node.id === "fossil-island-teaks").manualComplete).toBe(false);

    const undone = await put(server, url, {
      nodeId: "fossil-island-teaks",
      character: "Alice",
      complete: false,
    });
    expect(undone.status).toBe(200);
    expect(undone.body.nodes.find((node) => node.id === "fossil-island-teaks")).toMatchObject({
      complete: false,
      manualComplete: false,
      manuallyCompletedAt: null,
    });

    const groupCompleted = await put(server, url, {
      nodeId: "teak-seed",
      character: "Alice",
      complete: true,
    });
    expect(groupCompleted.status).toBe(200);
    expect(groupCompleted.body.nodes.find((node) => node.id === "teak-seed")).toMatchObject({
      complete: true,
      automaticComplete: false,
      manualComplete: true,
    });
    const groupCompletionForBob = await call(server, "/api/group/gim/get-goal-map?character=Bob");
    expect(groupCompletionForBob.body.nodes.find((node) => node.id === "teak-seed").manualComplete).toBe(true);

    const groupUndone = await put(server, url, {
      nodeId: "teak-seed",
      character: "Bob",
      complete: false,
    });
    expect(groupUndone.body.nodes.find((node) => node.id === "teak-seed").manualComplete).toBe(false);
  });

  it("keeps completed_at stable and records only completion transitions", () => {
    const first = new Date("2026-09-17T12:00:00.000Z");
    const second = new Date("2026-09-17T12:20:00.000Z");
    const third = new Date("2026-09-17T12:40:00.000Z");
    evaluateGroupData(db, "gim", [member("Alice", [6570, 1])], first);
    evaluateGroupData(db, "gim", [member("Alice")], second);
    evaluateGroupData(db, "gim", [member("Alice", [6570, 1])], third);
    evaluateGroupData(db, "gim", [member("Alice", [6570, 1])], new Date("2026-09-17T13:00:00.000Z"));

    const progress = db
      .prepare("SELECT complete,completed_at FROM goal_progress WHERE node_id='fire-cape' AND subject_id='Alice'")
      .get();
    const events = db
      .prepare("SELECT complete,occurred_at FROM goal_progress_events WHERE node_id='fire-cape' ORDER BY event_id")
      .all();
    expect(progress).toEqual({ complete: 1, completed_at: first.toISOString() });
    expect(events).toEqual([
      { complete: 0, occurred_at: second.toISOString() },
      { complete: 1, occurred_at: third.toISOString() },
    ]);
  });

  it("tracks each Morytania diary tier from diary variables", () => {
    const diaryVars = Array.from({ length: 62 }, () => 0);
    for (let bit = 1; bit <= 22; bit += 1) diaryVars[15] |= 1 << bit;
    for (let bit = 23; bit <= 30; bit += 1) diaryVars[15] |= 1 << bit;
    diaryVars[16] = (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5);
    const alice = member("Alice", [], diaryVars);
    alice.skills.Defence = 737627;
    alice.skills.Prayer = 668051;
    alice.quests[82] = 2;
    alice.quests[103] = 0;
    evaluateGroupData(db, "gim", [alice], new Date("2026-09-17T12:00:00.000Z"));

    const first = readGoalMap(db, "gim", "Alice");
    expect(first.nodes.find((node) => node.id === "morytania-easy")).toMatchObject({
      complete: true,
      progress: { current: 11, target: 11, unit: "task" },
    });
    expect(first.nodes.find((node) => node.id === "morytania-medium")).toMatchObject({
      complete: true,
      progress: { current: 11, target: 11, unit: "task" },
    });
    expect(first.nodes.find((node) => node.id === "morytania-hard")).toMatchObject({
      complete: false,
      progress: { current: 9, target: 10, unit: "task" },
      evidence: [{ type: "diary", region: "Morytania", tier: "Hard", completed: 9, total: 10 }],
    });
    const easyTasks = first.nodes.find((node) => node.id === "morytania-easy").evidence[0].tasks;
    expect(easyTasks).toHaveLength(11);
    expect(easyTasks[2]).toMatchObject({
      name: "Get a slayer task from the Slayer Master in Canifis.",
      complete: true,
      requirements: [{ type: "combat", requiredLevel: 20 }],
    });
    const hardTasks = first.nodes.find((node) => node.id === "morytania-hard").evidence[0].tasks;
    expect(hardTasks).toHaveLength(10);
    expect(hardTasks[0]).toMatchObject({ name: "Enter the Kharyrll portal in your POH.", complete: true });
    expect(hardTasks[7].requirements).toEqual([
      { type: "skill", skill: "Defence", level: 70, requiredLevel: 70, complete: true },
      { type: "skill", skill: "Prayer", level: 69, requiredLevel: 70, complete: false },
      { type: "quest", name: "Nature Spirit", questId: 103, state: 0, complete: false },
      { type: "quest", name: "King's Ransom", questId: 82, state: 2, complete: true },
    ]);
    expect(hardTasks[9]).toMatchObject({
      name: "Mine some Mithril ore in the Abandoned Mine.",
      complete: false,
    });
    expect(hardTasks[9].requirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "skill", skill: "Mining", requiredLevel: 55 })])
    );
    expect(first.nodes.find((node) => node.id === "morytania-elite")).toMatchObject({
      complete: false,
      progress: { current: 3, target: 6, unit: "task" },
    });
    expect(first.edges).toEqual(
      expect.arrayContaining([
        {
          source: "morytania-easy",
          target: "morytania-medium",
          type: "unlocks",
          label: "Claim the next tier",
        },
        {
          source: "morytania-hard",
          target: "morytania-elite",
          type: "unlocks",
          label: "Claim the next tier",
        },
      ])
    );

    diaryVars[16] |= (1 << 2) | (1 << 6) | (1 << 7) | (1 << 8);
    evaluateGroupData(db, "gim", [member("Alice", [], diaryVars)], new Date("2026-09-17T12:15:00.000Z"));
    const completed = readGoalMap(db, "gim", "Alice");
    expect(completed.nodes.find((node) => node.id === "morytania-hard")).toMatchObject({
      complete: true,
      completedAt: "2026-09-17T12:15:00.000Z",
    });
    expect(completed.nodes.find((node) => node.id === "morytania-elite")).toMatchObject({
      complete: true,
      progress: { current: 6, target: 6, unit: "task" },
    });
  });

  it("tracks 67 Construction as a recommended Guardians of the Rift objective", () => {
    const alice = member("Alice");
    alice.skills.Construction = 547953;
    evaluateGroupData(db, "gim", [alice], new Date("2026-09-17T12:00:00.000Z"));

    const map = readGoalMap(db, "gim", "Alice");
    expect(map.nodes.find((node) => node.id === "house-tablet-construction")).toMatchObject({
      complete: true,
      recommended: true,
      progress: { current: 67, target: 67, unit: "level" },
      evidence: [{ type: "skill", skill: "Construction", level: 67, requiredLevel: 67 }],
      wikiUrl: "https://oldschool.runescape.wiki/w/Teleport_to_house_(tablet)",
    });
    expect(map.edges).toContainEqual({
      source: "house-tablet-construction",
      target: "guardians-of-the-rift",
      type: "improves",
      label: "Convenient teleport",
    });
  });

  it("tracks Miscellania and Fossil Island teak progression with character and group scope", () => {
    const alice = member("Alice");
    alice.quests[123] = 2;
    alice.quests[11] = 2;
    alice.skills.Farming = 22406;
    const bob = member("Bob", [21486, 1]);
    evaluateGroupData(db, "gim", [alice, bob], new Date("2026-09-17T12:00:00.000Z"));

    const map = readGoalMap(db, "gim", "Alice");
    expect(map.nodes.find((node) => node.id === "miscellania-hardwood")).toMatchObject({
      complete: true,
      scope: "character",
      evidence: [{ type: "quest", questId: 123, name: "Royal Trouble", state: 2 }],
    });
    expect(map.nodes.find((node) => node.id === "teak-seed")).toMatchObject({
      complete: true,
      scope: "group",
      progress: { current: 1, target: 1, unit: "item" },
      evidence: [{ type: "item", itemId: 21486, quantity: 1 }],
    });
    expect(map.nodes.find((node) => node.id === "fossil-island-teaks")).toMatchObject({
      complete: false,
      scope: "character",
      progress: { current: 2, target: 3 },
      evidence: [
        { type: "quest", questId: 11, name: "Bone Voyage", state: 2 },
        { type: "skill", skill: "Farming", level: 35, requiredLevel: 35 },
        { type: "unobservable", message: expect.stringContaining("cannot be observed automatically") },
      ],
    });
    expect(map.edges).toEqual(
      expect.arrayContaining([
        {
          source: "teak-seed",
          target: "fossil-island-teaks",
          type: "requires",
          label: "Seed for the sapling",
        },
        {
          source: "fossil-island-teaks",
          target: "house-tablet-construction",
          type: "supplies",
          label: "Renewable teak logs",
        },
      ])
    );
  });

  it("supports source-controlled custom JavaScript validators", () => {
    const result = goalMapModule.evaluateValidator(
      {
        type: "custom",
        evaluate(context) {
          const current = context.items.get(995) || 0;
          return {
            complete: current >= 1000,
            progress: { current, target: 1000, unit: "item" },
            evidence: [{ type: "item", itemId: 995, quantity: current }],
          };
        },
      },
      { items: new Map([[995, 1500]]) }
    );

    expect(result).toEqual({
      complete: true,
      progress: { current: 1500, target: 1000, unit: "item" },
      evidence: [{ type: "item", itemId: 995, quantity: 1500 }],
    });
  });

  it("throttles refreshes for fifteen minutes", async () => {
    const now = new Date("2026-09-17T12:00:00.000Z");
    expect(await refreshGoalMap(db, config, request, now)).toBe(true);
    expect(await refreshGoalMap(db, config, request, new Date("2026-09-17T12:14:59.999Z"))).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(await refreshGoalMap(db, config, request, new Date("2026-09-17T12:15:00.000Z"))).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refreshes immediately when the goal definition version changes", async () => {
    db.prepare("UPDATE goal_map_state SET updated_at=?,definition_version=0 WHERE singleton=1").run(
      "2026-09-17T12:00:00.000Z"
    );

    expect(await refreshGoalMap(db, config, request, new Date("2026-09-17T12:01:00.000Z"))).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT definition_version FROM goal_map_state WHERE singleton=1").get().definition_version).toBe(
      7
    );
  });

  it("coalesces concurrent GET refreshes into a single upstream request", async () => {
    let resolveRequest;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    const first = call(server);
    const second = call(server, "/api/group/gim/get-goal-map?character=Alice");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    resolveRequest({ status: 200, headers: {}, data: groupData });

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
  });

  it("allows an empty group without rejecting a requested character", () => {
    evaluateGroupData(db, "gim", [], new Date("2026-09-17T12:00:00.000Z"));
    expect(readGoalMap(db, "gim", "Nobody")).toMatchObject({ characters: [], selectedCharacter: "Nobody" });
  });
});
