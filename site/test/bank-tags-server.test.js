// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appModule from "../server/app";

const { createApp } = appModule;

const tagId = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
const tag = { schemaVersion: 1, name: "Herblore", iconItemId: 952, itemIds: [-203, 199, 201], layout: [199, -1, 201] };

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

describe("private bank tag service", () => {
  let directory;
  let server;
  let db;
  let upstreamRequest;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "bank-tags-"));
    upstreamRequest = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      data: Readable.from([JSON.stringify({ proxied: true })]),
    }));
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
      { request: upstreamRequest }
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

  it("authenticates the configured group and starts with an empty manifest", async () => {
    const unauthorized = await call(server, "GET", "/api/group/gim/bank-tags", { headers: { Authorization: "wrong" } });
    expect(unauthorized.status).toBe(401);
    const response = await call(server, "GET", "/api/group/gim/bank-tags");
    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe('"0"');
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      groupRevision: 0,
      orderRevision: 0,
      orderedTagIds: [],
      tags: [],
    });
  });

  it("creates, reads, updates, reorders, and tombstones a tag with revisions", async () => {
    const created = await call(server, "PUT", `/api/group/gim/bank-tags/${tagId}`, {
      headers: { "If-None-Match": "*" },
      body: tag,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ tagId, name: "herblore", revision: 1, deleted: false });
    const stale = await call(server, "PUT", `/api/group/gim/bank-tags/${tagId}`, {
      headers: { "If-Match": '"0"' },
      body: tag,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale_revision");
    const updated = await call(server, "PUT", `/api/group/gim/bank-tags/${tagId}`, {
      headers: { "If-Match": '"1"' },
      body: { ...tag, itemIds: [-203, 199, 201, 203] },
    });
    expect(updated.body.revision).toBe(2);
    const history = await call(server, "GET", `/api/group/gim/bank-tags/${tagId}/revisions`);
    expect(history.body.revisions.map((revision) => revision.revision)).toEqual([2, 1]);
    expect(history.body.revisions[0]).toMatchObject({ itemCount: 4, layoutCount: 3 });
    const historical = await call(server, "GET", `/api/group/gim/bank-tags/${tagId}/revisions/1`);
    expect(historical.body).toMatchObject({ revision: 1, itemIds: [-203, 199, 201] });
    const restored = await call(server, "POST", `/api/group/gim/bank-tags/${tagId}/revisions/1/restore`, {
      headers: { "If-Match": '"2"' },
    });
    expect(restored.body).toMatchObject({ revision: 3, itemIds: [-203, 199, 201] });
    const order = await call(server, "PUT", "/api/group/gim/bank-tag-order", {
      headers: { "If-Match": '"1"' },
      body: { schemaVersion: 1, orderedTagIds: [tagId] },
    });
    expect(order.status).toBe(200);
    expect(order.body.orderRevision).toBe(2);
    const deleted = await call(server, "DELETE", `/api/group/gim/bank-tags/${tagId}`, {
      headers: { "If-Match": '"3"' },
    });
    expect(deleted.body).toMatchObject({ revision: 4, deleted: true, itemIds: [], layout: null });
    const finalHistory = await call(server, "GET", `/api/group/gim/bank-tags/${tagId}/revisions`);
    expect(finalHistory.body.revisions.map((revision) => revision.revision)).toEqual([4, 3, 2, 1]);
    const manifest = await call(server, "GET", "/api/group/gim/bank-tags");
    expect(manifest.body.orderedTagIds).toEqual([]);
    expect(manifest.body.tags[0].deleted).toBe(true);
  });

  it("proxies existing group APIs with server-side upstream credentials", async () => {
    const rejected = await call(server, "GET", "/api/group/gim/am-i-logged-in", {
      headers: { Authorization: "wrong" },
    });
    expect(rejected.status).toBe(401);
    const response = await call(server, "GET", "/api/group/gim/am-i-logged-in", {
      headers: {
        "CF-Connecting-IP": "203.0.113.1",
        "X-Forwarded-For": "203.0.113.1",
        "X-Forwarded-Host": "ironman.masley.com",
      },
    });
    expect(response).toMatchObject({ status: 200, body: { proxied: true } });
    expect(upstreamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://groupiron.men/api/group/upstream/am-i-logged-in",
        headers: expect.objectContaining({ authorization: "upstream-token" }),
      })
    );
    const upstreamHeaders = upstreamRequest.mock.calls[0][0].headers;
    expect(upstreamHeaders).not.toHaveProperty("cf-connecting-ip");
    expect(upstreamHeaders).not.toHaveProperty("x-forwarded-for");
    expect(upstreamHeaders).not.toHaveProperty("x-forwarded-host");
  });

  it("serves a Railway health check", async () => {
    const response = await call(server, "GET", "/health", { headers: { Authorization: undefined } });
    expect(response).toMatchObject({ status: 200, body: { ok: true } });
  });
});
