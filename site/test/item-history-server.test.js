// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appModule from "../server/app";
import historyModule from "../server/item-history";

const { createApp } = appModule;
const { ensureSnapshot, history } = historyModule;

function call(server, authorization = "private-token") {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: "/api/group/gim/get-item-history",
        headers: { Authorization: authorization },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("private item history service", () => {
  let directory;
  let server;
  let db;
  let request;
  const config = {
    port: 0,
    privateGroupName: "gim",
    privateSyncToken: "private-token",
    upstreamBaseUrl: "https://groupiron.men",
    upstreamGroupName: "upstream",
    upstreamGroupToken: "upstream-token",
  };
  const groupData = [
    {
      name: "Alice",
      inventory: [4151, 1, 0, 0],
      bank: [995, 1500, 11840, 1],
      equipment: [4151, 1],
      rune_pouch: null,
      seed_vault: [995, 500],
    },
  ];

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "item-history-"));
    config.databasePath = path.join(directory, "test.sqlite3");
    request = vi.fn(async (options) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      data: options.responseType === "json" ? groupData : Readable.from([JSON.stringify(groupData)]),
    }));
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

  it("authenticates, snapshots current upstream items, and handles the route locally", async () => {
    expect(await call(server, "wrong-token")).toMatchObject({ status: 401 });

    const response = await call(server);

    expect(response).toMatchObject({ status: 200, body: [] });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "GET",
      url: "https://groupiron.men/api/group/upstream/get-group-data",
      responseType: "json",
      headers: { authorization: "upstream-token" },
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM item_snapshots").get().count).toBe(1);

    await call(server);
    expect(request).toHaveBeenCalledOnce();
  });

  it("calculates gained and lost items between daily snapshots", async () => {
    db.prepare("INSERT INTO item_snapshots VALUES (?,?,?)").run(
      "2026-09-14",
      JSON.stringify({ 995: 1000, 4151: 3 }),
      "2026-09-14T07:00:00.000Z"
    );

    await ensureSnapshot(db, config, request, "2026-09-15");

    expect(history(db)).toEqual([
      {
        date: "2026-09-15",
        gained: [
          { item_id: 995, quantity: 1000 },
          { item_id: 11840, quantity: 1 },
        ],
        lost: [{ item_id: 4151, quantity: 1 }],
      },
    ]);
  });

  it("keeps only the baseline needed for thirty daily comparisons", async () => {
    for (let day = 1; day <= 31; day += 1) {
      const date = `2026-08-${String(day).padStart(2, "0")}`;
      db.prepare("INSERT INTO item_snapshots VALUES (?,?,?)").run(date, "{}", `${date}T07:00:00.000Z`);
    }

    await ensureSnapshot(db, config, request, "2026-09-01");

    expect(db.prepare("SELECT MIN(snapshot_date) AS date FROM item_snapshots").get().date).toBe("2026-08-02");
    expect(db.prepare("SELECT COUNT(*) AS count FROM item_snapshots").get().count).toBe(31);
  });
});
