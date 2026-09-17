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
const { centralDate, comparison, ensureSnapshot } = historyModule;

function call(server, authorization = "private-token", url = "/api/group/gim/get-item-history") {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: url,
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
    groupData[0].inventory = [4151, 1, 0, 0];
    groupData[0].bank = [995, 1500, 11840, 1];
    groupData[0].equipment = [4151, 1];
    groupData[0].rune_pouch = null;
    groupData[0].seed_vault = [995, 500];
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

    expect(response).toMatchObject({
      status: 200,
      body: {
        dates: [expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)],
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        singleDay: true,
        baselineAvailable: true,
        gained: [],
        lost: [],
        charge_changes: [],
        storage: { snapshotCount: 1, retentionDays: 365 },
      },
    });
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
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-14",
      JSON.stringify({ 995: 1000, 4151: 3 }),
      "2026-09-14T07:00:00.000Z"
    );
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-15",
      JSON.stringify({ 995: 1200, 4151: 3 }),
      "2026-09-15T12:00:00.000Z"
    );

    await ensureSnapshot(db, config, request, "2026-09-15", new Date("2026-09-15T13:00:00.000Z"));

    expect(comparison(db, "2026-09-14", "2026-09-15", "2026-09-15")).toMatchObject({
      dates: ["2026-09-14", "2026-09-15"],
      from: "2026-09-14",
      to: "2026-09-15",
      gained: [
        { item_id: 995, quantity: 1000 },
        { item_id: 11840, quantity: 1 },
      ],
      lost: [{ item_id: 4151, quantity: 1 }],
      live: { date: "2026-09-15", updatedAt: "2026-09-15T13:00:00.000Z", refreshMinutes: 15 },
      storage: { snapshotCount: 2, retentionDays: 365 },
    });
  });

  it("combines charged jewelry into total charge changes", () => {
    const result = historyModule.changesBetween({ 2552: 50, 2554: 1, 995: 1000 }, { 2552: 50, 2556: 1, 995: 1200 });

    expect(result).toEqual({
      gained: [{ item_id: 995, quantity: 200 }],
      lost: [],
      charge_changes: [
        {
          name: "Ring of dueling",
          item_id: 2552,
          from: 407,
          to: 406,
          difference: -1,
        },
      ],
      high_alch: { gained: 200, lost: 0, net: 200 },
    });
  });

  it("handles spaced, imbued, and zero-charge item variants", () => {
    expect(historyModule.changesBetween({ 11980: 1 }, { 11984: 1 })).toEqual({
      gained: [],
      lost: [],
      charge_changes: [
        {
          name: "Ring of wealth",
          item_id: 11980,
          from: 5,
          to: 3,
          difference: -2,
        },
      ],
      high_alch: { gained: 0, lost: 0, net: 0 },
    });
    expect(historyModule.changesBetween({ 11988: 1 }, { 2572: 1 })).toMatchObject({
      gained: [],
      lost: [],
      charge_changes: [{ name: "Ring of wealth", from: 1, to: 0, difference: -1 }],
    });
    expect(historyModule.changesBetween({ 10360: 1 }, { 10362: 1 })).toMatchObject({
      gained: [],
      lost: [],
      charge_changes: [{ name: "Amulet of glory", from: 1, to: 0, difference: -1 }],
    });
  });

  it("counts newly enchanted jewelry as newly added charges", () => {
    const result = historyModule.changesBetween({}, { 2552: 1 });

    expect(result).toMatchObject({
      gained: [],
      lost: [],
      charge_changes: [{ name: "Ring of dueling", from: 0, to: 8, difference: 8 }],
      high_alch: { gained: 765, lost: 0, net: 765 },
    });
  });

  it("treats matching dates as that day's diff from the previous snapshot", () => {
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-14",
      JSON.stringify({ 995: 1000, 4151: 3 }),
      "2026-09-14T07:00:00.000Z"
    );
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-15",
      JSON.stringify({ 995: 1700, 4151: 1, 11840: 1 }),
      "2026-09-15T07:00:00.000Z"
    );

    expect(comparison(db, "2026-09-15", "2026-09-15", "2026-09-15")).toMatchObject({
      from: "2026-09-15",
      to: "2026-09-15",
      singleDay: true,
      baselineDate: "2026-09-14",
      gained: [
        { item_id: 995, quantity: 700 },
        { item_id: 11840, quantity: 1 },
      ],
      lost: [{ item_id: 4151, quantity: 2 }],
      high_alch: { gained: 12700, lost: 144000, net: -131300 },
    });
    expect(comparison(db, "2026-09-14", "2026-09-14", "2026-09-15")).toMatchObject({
      from: "2026-09-14",
      to: "2026-09-14",
      singleDay: true,
      baselineDate: "2026-09-14",
      baselineAvailable: false,
      gained: [],
      lost: [],
    });
  });

  it("preserves the live day's opening baseline while overwriting current items", async () => {
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-15",
      JSON.stringify({ 995: 1000, 4151: 3 }),
      "2026-09-15T12:00:00.000Z"
    );

    await ensureSnapshot(db, config, request, "2026-09-15", new Date("2026-09-15T13:00:00.000Z"));
    const result = comparison(db, "2026-09-15", "2026-09-15", "2026-09-15");

    expect(result).toMatchObject({
      singleDay: true,
      baselineDate: "2026-09-15",
      baselineAvailable: true,
      gained: [
        { item_id: 995, quantity: 1000 },
        { item_id: 11840, quantity: 1 },
      ],
      lost: [{ item_id: 4151, quantity: 1 }],
    });
    expect(
      JSON.parse(
        db.prepare("SELECT baseline_items FROM item_snapshots WHERE snapshot_date='2026-09-15'").get().baseline_items
      )
    ).toEqual({ 995: 1000, 4151: 3 });
  });

  it("uses a 2 AM Central boundary for the live day", () => {
    expect(centralDate(new Date("2026-09-17T06:59:00.000Z"))).toBe("2026-09-16");
    expect(centralDate(new Date("2026-09-17T07:00:00.000Z"))).toBe("2026-09-17");
  });

  it("overwrites the live snapshot every fifteen minutes and finalizes it at rollover", async () => {
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-16",
      JSON.stringify({ 995: 1000 }),
      "2026-09-16T12:00:00.000Z"
    );

    await ensureSnapshot(db, config, request, "2026-09-16", new Date("2026-09-16T13:00:00.000Z"));
    expect(request).toHaveBeenCalledOnce();
    await ensureSnapshot(db, config, request, "2026-09-16", new Date("2026-09-16T13:10:00.000Z"));
    expect(request).toHaveBeenCalledOnce();

    groupData[0].bank = [995, 2500, 11840, 1];
    await ensureSnapshot(db, config, request, "2026-09-16", new Date("2026-09-16T13:16:00.000Z"));
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(db.prepare("SELECT items FROM item_snapshots WHERE snapshot_date='2026-09-16'").get().items)
    ).toMatchObject({
      995: 3000,
    });

    groupData[0].bank = [995, 3000, 11840, 1];
    await ensureSnapshot(db, config, request, "2026-09-17", new Date("2026-09-17T07:00:00.000Z"));
    const rows = db.prepare("SELECT snapshot_date,items FROM item_snapshots ORDER BY snapshot_date").all();
    expect(rows.map((row) => row.snapshot_date)).toEqual(["2026-09-16", "2026-09-17"]);
    expect(rows.map((row) => JSON.parse(row.items))).toEqual([
      { 995: 3500, 4151: 2, 11840: 1 },
      { 995: 3500, 4151: 2, 11840: 1 },
    ]);
  });

  it("compares any two saved dates through the API", async () => {
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-14",
      JSON.stringify({ 995: 1000, 4151: 3 }),
      "2026-09-14T07:00:00.000Z"
    );
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-15",
      JSON.stringify({ 995: 1200, 4151: 2 }),
      "2026-09-15T07:00:00.000Z"
    );
    db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      "2026-09-16",
      JSON.stringify({ 995: 1700, 11840: 1 }),
      "2026-09-16T07:00:00.000Z"
    );

    const liveDate = centralDate();
    if (!db.prepare("SELECT 1 FROM item_snapshots WHERE snapshot_date=?").get(liveDate)) {
      db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
        liveDate,
        "{}",
        new Date().toISOString()
      );
    }

    const response = await call(
      server,
      "private-token",
      "/api/group/gim/get-item-history?from=2026-09-14&to=2026-09-16"
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        from: "2026-09-14",
        to: "2026-09-16",
        gained: [
          { item_id: 995, quantity: 700 },
          { item_id: 11840, quantity: 1 },
        ],
        lost: [{ item_id: 4151, quantity: 3 }],
      },
    });
    expect(
      await call(server, "private-token", "/api/group/gim/get-item-history?from=2026-09-16&to=2026-09-14")
    ).toMatchObject({ status: 400, body: { error: "invalid_date_range" } });
  });

  it("keeps 365 daily snapshots", async () => {
    const firstDate = new Date("2025-09-01T12:00:00Z");
    for (let offset = 0; offset < 365; offset += 1) {
      const date = new Date(firstDate);
      date.setUTCDate(date.getUTCDate() + offset);
      const snapshotDate = date.toISOString().slice(0, 10);
      db.prepare("INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
        snapshotDate,
        "{}",
        `${snapshotDate}T07:00:00.000Z`
      );
    }

    await ensureSnapshot(db, config, request, "2026-09-01");

    expect(db.prepare("SELECT MIN(snapshot_date) AS date FROM item_snapshots").get().date).toBe("2025-09-02");
    expect(db.prepare("SELECT COUNT(*) AS count FROM item_snapshots").get().count).toBe(365);
  });
});
