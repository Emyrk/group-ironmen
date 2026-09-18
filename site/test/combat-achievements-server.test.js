// @vitest-environment node
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import appModule from "../server/app";

const { createApp } = appModule;

function call(server, method, pathname, body, authorization = "private-token") {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        method,
        path: pathname,
        headers: {
          Authorization: authorization,
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
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

describe("medium combat achievement planner service", () => {
  let directory;
  let server;
  let db;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "combat-achievements-"));
    const created = createApp({
      databasePath: path.join(directory, "test.sqlite3"),
      privateGroupName: "gim",
      privateSyncToken: "private-token",
      upstreamBaseUrl: "https://groupiron.men",
      upstreamGroupName: "upstream",
      upstreamGroupToken: "upstream-token",
    });
    db = created.db;
    db.prepare("UPDATE goal_map_state SET characters=? WHERE singleton=1").run('["Alice","Bob"]');
    server = created.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("serves the verified 64-task Medium catalog behind authentication", async () => {
    expect(await call(server, "GET", "/api/group/gim/combat-achievements/medium", null, "wrong")).toMatchObject({
      status: 401,
    });
    const response = await call(server, "GET", "/api/group/gim/combat-achievements/medium?character=Alice");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tier: "Medium",
      rewardPoints: 169,
      pointsPerTask: 2,
      selectedCharacter: "Alice",
      externalPoints: 0,
      verifiedAt: "2026-09-18",
    });
    expect(response.body.tasks).toHaveLength(64);
    expect(response.body.tasks.find((task) => task.name === "Barrows Champion")).toMatchObject({
      monster: "Barrows",
      description: "Open the Barrows chest 25 times.",
      type: "Kill Count",
      completionPercent: 59.6,
      status: "unplanned",
    });
  });

  it("persists task plans, notes, and external points per character", async () => {
    const progressUrl = "/api/group/gim/combat-achievements/medium/progress";
    const planned = await call(server, "PUT", progressUrl, {
      character: "Alice",
      taskId: "barrows-champion",
      status: "planned",
      notes: "Finish during Barrows runs",
    });
    expect(planned.status).toBe(200);
    expect(planned.body.tasks.find((task) => task.id === "barrows-champion")).toMatchObject({
      status: "planned",
      notes: "Finish during Barrows runs",
    });

    const settings = await call(server, "PUT", "/api/group/gim/combat-achievements/medium/settings", {
      character: "Alice",
      externalPoints: 41,
    });
    expect(settings.body.externalPoints).toBe(41);

    const bob = await call(server, "GET", "/api/group/gim/combat-achievements/medium?character=Bob");
    expect(bob.body.externalPoints).toBe(0);
    expect(bob.body.tasks.find((task) => task.id === "barrows-champion").status).toBe("unplanned");

    expect(
      await call(server, "PUT", progressUrl, {
        character: "Alice",
        taskId: "not-a-task",
        status: "completed",
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_combat_achievement_progress" } });
  });

  it("stores latest exact snapshots for normalized current members and preserves planner data", async () => {
    const progressUrl = "/api/group/gim/combat-achievements/medium/progress";
    await call(server, "PUT", progressUrl, {
      character: "Alice",
      taskId: "barrows-champion",
      status: "planned",
      notes: "Keep this plan",
    });

    const snapshotUrl = "/api/group/gim/combat-achievements/snapshot";
    const uploaded = await call(server, "PUT", snapshotUrl, {
      schemaVersion: 1,
      playerName: " alice ",
      clientRevision: 123,
      achievementPoints: 321,
      completedTaskIds: ["CA_TASK_BARROWS_CHAMPION_COMPLETED"],
    });
    expect(uploaded).toMatchObject({
      status: 200,
      body: {
        schemaVersion: 1,
        playerName: "Alice",
        clientRevision: 123,
        achievementPoints: 321,
        completedTaskIds: ["CA_TASK_BARROWS_CHAMPION_COMPLETED"],
      },
    });

    const snapshots = await call(server, "GET", "/api/group/gim/combat-achievements/snapshots");
    expect(snapshots.body.snapshots).toHaveLength(1);
    expect(snapshots.body.snapshots[0].achievementPoints).toBe(321);
    const planner = await call(server, "GET", "/api/group/gim/combat-achievements/medium?character=Alice");
    expect(planner.body.syncedSnapshot).toMatchObject({ clientRevision: 123, achievementPoints: 321 });
    expect(planner.body.tasks.find((task) => task.id === "barrows-champion")).toMatchObject({
      status: "planned",
      notes: "Keep this plan",
      syncedComplete: true,
    });

    expect(
      await call(server, "PUT", snapshotUrl, {
        schemaVersion: 1,
        playerName: "Alice",
        clientRevision: 122,
        achievementPoints: 300,
        completedTaskIds: [],
      })
    ).toMatchObject({ status: 409, body: { error: "stale_client_revision" } });

    const replacement = await call(server, "PUT", snapshotUrl, {
      schemaVersion: 1,
      playerName: "Alice",
      clientRevision: 124,
      achievementPoints: 400,
      completedTaskIds: [],
    });
    expect(replacement.body).toMatchObject({ achievementPoints: 400, completedTaskIds: [] });
    const replacedPlanner = await call(server, "GET", "/api/group/gim/combat-achievements/medium?character=Alice");
    expect(replacedPlanner.body.syncedSnapshot.achievementPoints).toBe(400);
    expect(replacedPlanner.body.tasks.find((task) => task.id === "barrows-champion")).toMatchObject({
      status: "planned",
      notes: "Keep this plan",
      syncedComplete: false,
    });

    expect(
      await call(server, "PUT", snapshotUrl, {
        schemaVersion: 1,
        playerName: "Mallory",
        clientRevision: 1,
        achievementPoints: 1,
        completedTaskIds: [],
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_player_name" } });

    expect(
      await call(server, "PUT", snapshotUrl, {
        schemaVersion: 1,
        playerName: "Alice",
        clientRevision: 125,
        achievementPoints: 10001,
        completedTaskIds: [],
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_combat_achievement_snapshot" } });
  });
});
