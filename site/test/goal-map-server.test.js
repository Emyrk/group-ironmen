// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appModule from "../server/app";
import goalMapModule from "../server/goal-map";

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

function member(name, bank = []) {
  return {
    name,
    bank,
    inventory: [],
    equipment: [],
    rune_pouch: [],
    seed_vault: [],
    skills: {},
    quests: {},
  };
}

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
    expect(response.body.nodes.find((node) => node.id === "fire-cape")).toMatchObject({
      complete: true,
      scope: "character",
      completedAt: expect.any(String),
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

  it("throttles refreshes for fifteen minutes", async () => {
    const now = new Date("2026-09-17T12:00:00.000Z");
    expect(await refreshGoalMap(db, config, request, now)).toBe(true);
    expect(await refreshGoalMap(db, config, request, new Date("2026-09-17T12:14:59.999Z"))).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(await refreshGoalMap(db, config, request, new Date("2026-09-17T12:15:00.000Z"))).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
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
