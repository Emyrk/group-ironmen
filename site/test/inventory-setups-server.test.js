// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appModule from "../server/app";

const { createApp } = appModule;
const setupId = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
const secondSetupId = "f40c4538-b158-4c1c-9c8a-7d930886bc96";
const sectionId = "874dfb26-63b8-42f1-80a2-01a2a7c7779d";
const secondSectionId = "a8691e24-56a0-4fb7-bfd1-04feca5b449a";
const setup = {
  schemaVersion: 1,
  setupId,
  name: "Vorkath",
  notes: "Bring crumble undead",
  payload: { z: 1, a: { d: 2, b: 1 }, inventory: [1, 2] },
};

function call(server, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = {
      Authorization: "private-token",
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
      ...options.headers,
    };
    for (const [name, value] of Object.entries(headers)) if (value === undefined) delete headers[name];
    const req = http.request({ hostname: "127.0.0.1", port: address.port, method, path: url, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("private inventory setup service", () => {
  let directory;
  let server;
  let db;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-setups-"));
    const created = createApp(
      {
        port: 0,
        databasePath: path.join(directory, "test.sqlite3"),
        privateGroupName: "gim",
        privateSyncToken: "private-token",
        upstreamBaseUrl: "https://groupiron.men",
        upstreamGroupName: "upstream",
        upstreamGroupToken: "upstream-token",
      },
      { request: vi.fn(async () => ({ status: 200, headers: {}, data: Readable.from([]) })) }
    );
    db = created.db;
    server = created.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("authenticates and serves a conditionally cached combined manifest", async () => {
    expect(
      await call(server, "GET", "/api/group/gim/inventory-setups", { headers: { Authorization: "wrong" } })
    ).toMatchObject({ status: 401 });
    expect(await call(server, "GET", "/api/group/other/inventory-setups")).toMatchObject({ status: 404 });
    const response = await call(server, "GET", "/api/group/gim/inventory-setups");
    expect(response).toMatchObject({
      status: 200,
      headers: { etag: '"0"' },
      body: {
        schemaVersion: 1,
        groupRevision: 0,
        setupOrderRevision: 0,
        sectionOrderRevision: 0,
        orderedSetupIds: [],
        orderedSectionIds: [],
        setups: [],
        sections: [],
      },
    });
    expect(
      await call(server, "GET", "/api/group/gim/inventory-setups", { headers: { "If-None-Match": '"0"' } })
    ).toMatchObject({ status: 304, body: null });
  });

  it("creates, reads, updates, reorders, and tombstones setups", async () => {
    const created = await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-None-Match": "*" },
      body: setup,
    });
    expect(created).toMatchObject({
      status: 201,
      headers: { etag: '"1"' },
      body: { ...setup, revision: 1, deleted: false },
    });
    expect(Object.keys(created.body).sort()).toEqual(
      ["schemaVersion", "setupId", "name", "notes", "payload", "revision", "deleted", "updatedAt"].sort()
    );
    expect(db.prepare("SELECT payload FROM inventory_setups WHERE setup_id=?").get(setupId).payload).toBe(
      '{"a":{"b":1,"d":2},"inventory":[1,2],"z":1}'
    );
    expect(await call(server, "GET", `/api/group/gim/inventory-setups/${setupId}`)).toMatchObject({
      status: 200,
      headers: { etag: '"1"' },
      body: created.body,
    });

    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
        headers: { "If-Match": '"0"' },
        body: setup,
      })
    ).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    const updated = await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-Match": '"1"' },
      body: { ...created.body, name: "Vorkath ranged", notes: "Updated notes", payload: { equipment: [3] } },
    });
    expect(updated).toMatchObject({
      status: 200,
      headers: { etag: '"2"' },
      body: { revision: 2, name: "Vorkath ranged" },
    });

    const reordered = await call(server, "PUT", "/api/group/gim/inventory-setup-order", {
      headers: { "If-Match": '"1"' },
      body: { schemaVersion: 1, orderedSetupIds: [setupId] },
    });
    expect(reordered).toMatchObject({ status: 200, headers: { etag: '"2"' }, body: { setupOrderRevision: 2 } });

    const deleted = await call(server, "DELETE", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-Match": '"2"' },
    });
    expect(deleted).toMatchObject({
      status: 200,
      headers: { etag: '"3"' },
      body: { setupId, name: "Vorkath ranged", notes: "Updated notes", payload: {}, revision: 3, deleted: true },
    });
    expect((await call(server, "GET", "/api/group/gim/inventory-setups")).body).toMatchObject({
      groupRevision: 4,
      setupOrderRevision: 3,
      sectionOrderRevision: 0,
      orderedSetupIds: [],
      setups: [{ setupId, name: "Vorkath ranged", revision: 3, deleted: true }],
    });

    const revived = await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-Match": '"3"' },
      body: { ...setup, name: "Vorkath restored" },
    });
    expect(revived).toMatchObject({
      status: 200,
      body: { setupId, name: "Vorkath restored", revision: 4, deleted: false },
    });
    expect((await call(server, "GET", "/api/group/gim/inventory-setups")).body).toMatchObject({
      setupOrderRevision: 4,
      orderedSetupIds: [setupId],
    });
  });

  it("validates exact setup fields, UUIDs, payloads, preconditions, and case-insensitive names", async () => {
    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId.toUpperCase()}`, {
        headers: { "If-None-Match": "*" },
        body: setup,
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_setup_id" } });
    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
        headers: { "If-None-Match": "*" },
        body: { ...setup, payload: [] },
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_setup" } });
    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
        headers: { "If-None-Match": "*" },
        body: { ...setup, isMaximized: true },
      })
    ).toMatchObject({ status: 400, body: { error: "invalid_setup" } });
    await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-None-Match": "*" },
      body: setup,
    });
    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setups/${secondSetupId}`, {
        headers: { "If-None-Match": "*" },
        body: { ...setup, setupId: secondSetupId, name: "vOrKaTh" },
      })
    ).toMatchObject({ status: 409, body: { error: "duplicate_name" } });
    expect(await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, { body: setup })).toMatchObject({
      status: 428,
      body: { error: "precondition_required" },
    });
  });

  it("supports multi-section membership and setup deletion updates every live section", async () => {
    await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-None-Match": "*" },
      body: setup,
    });
    const first = await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${sectionId}`, {
      headers: { "If-None-Match": "*" },
      body: { schemaVersion: 1, sectionId, name: "Bossing", displayColor: -65536, orderedSetupIds: [setupId] },
    });
    expect(first).toMatchObject({
      status: 201,
      headers: { etag: '"1"' },
      body: {
        sectionId,
        name: "Bossing",
        displayColor: -65536,
        orderedSetupIds: [setupId],
        revision: 1,
        deleted: false,
      },
    });
    expect(Object.keys(first.body).sort()).toEqual(
      [
        "schemaVersion",
        "sectionId",
        "name",
        "displayColor",
        "orderedSetupIds",
        "revision",
        "deleted",
        "updatedAt",
      ].sort()
    );
    const second = await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${secondSectionId}`, {
      headers: { "If-None-Match": "*" },
      body: {
        schemaVersion: 1,
        sectionId: secondSectionId,
        name: "Favorites",
        displayColor: null,
        orderedSetupIds: [setupId],
      },
    });
    expect(second.status).toBe(201);
    await call(server, "DELETE", `/api/group/gim/inventory-setups/${setupId}`, { headers: { "If-Match": '"1"' } });
    expect(await call(server, "GET", `/api/group/gim/inventory-setup-sections/${sectionId}`)).toMatchObject({
      body: { revision: 2, orderedSetupIds: [], deleted: false },
    });
    expect(await call(server, "GET", `/api/group/gim/inventory-setup-sections/${secondSectionId}`)).toMatchObject({
      body: { revision: 2, orderedSetupIds: [], deleted: false },
    });
  });

  it("validates, renames, orders, and tombstones sections without deleting setups", async () => {
    await call(server, "PUT", `/api/group/gim/inventory-setups/${setupId}`, {
      headers: { "If-None-Match": "*" },
      body: setup,
    });
    const created = await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${sectionId}`, {
      headers: { "If-None-Match": "*" },
      body: { schemaVersion: 1, sectionId, name: "Bossing", displayColor: 2147483647, orderedSetupIds: [setupId] },
    });
    expect(created.status).toBe(201);
    for (const body of [
      { schemaVersion: 1, sectionId: secondSectionId, name: "Bad", displayColor: 2147483648, orderedSetupIds: [] },
      {
        schemaVersion: 1,
        sectionId: secondSectionId,
        name: "Bad",
        displayColor: null,
        orderedSetupIds: [setupId, setupId],
      },
      {
        schemaVersion: 1,
        sectionId: secondSectionId,
        name: "Bad",
        displayColor: null,
        orderedSetupIds: [],
        isMaximized: false,
      },
      {
        schemaVersion: 1,
        sectionId: secondSectionId,
        name: "Bad",
        displayColor: null,
        orderedSetupIds: [secondSetupId],
      },
    ]) {
      expect(
        await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${secondSectionId}`, {
          headers: { "If-None-Match": "*" },
          body,
        })
      ).toMatchObject({ status: 400, body: { error: "invalid_section" } });
    }
    expect(
      await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${secondSectionId}`, {
        headers: { "If-None-Match": "*" },
        body: {
          schemaVersion: 1,
          sectionId: secondSectionId,
          name: "bOsSiNg",
          displayColor: null,
          orderedSetupIds: [],
        },
      })
    ).toMatchObject({ status: 409, body: { error: "duplicate_name" } });
    const renamed = await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${sectionId}`, {
      headers: { "If-Match": '"1"' },
      body: { ...created.body, name: "Dragons", displayColor: -2147483648 },
    });
    expect(renamed).toMatchObject({ status: 200, body: { sectionId, name: "Dragons", revision: 2 } });
    const reordered = await call(server, "PUT", "/api/group/gim/inventory-setup-section-order", {
      headers: { "If-Match": '"1"' },
      body: { schemaVersion: 1, orderedSectionIds: [sectionId] },
    });
    expect(reordered).toMatchObject({ status: 200, headers: { etag: '"2"' }, body: { sectionOrderRevision: 2 } });
    const deleted = await call(server, "DELETE", `/api/group/gim/inventory-setup-sections/${sectionId}`, {
      headers: { "If-Match": '"2"' },
    });
    expect(deleted).toMatchObject({
      body: { sectionId, name: "Dragons", displayColor: -2147483648, orderedSetupIds: [], revision: 3, deleted: true },
    });
    expect((await call(server, "GET", `/api/group/gim/inventory-setups/${setupId}`)).body.deleted).toBe(false);
    expect((await call(server, "GET", "/api/group/gim/inventory-setups")).body).toMatchObject({
      orderedSectionIds: [],
      sectionOrderRevision: 3,
    });

    const revived = await call(server, "PUT", `/api/group/gim/inventory-setup-sections/${sectionId}`, {
      headers: { "If-Match": '"3"' },
      body: { ...created.body, name: "Dragons restored", displayColor: null },
    });
    expect(revived).toMatchObject({
      status: 200,
      body: { sectionId, name: "Dragons restored", revision: 4, deleted: false },
    });
    expect((await call(server, "GET", "/api/group/gim/inventory-setups")).body).toMatchObject({
      orderedSectionIds: [sectionId],
      sectionOrderRevision: 4,
    });
  });
});
