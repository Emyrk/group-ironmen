const express = require("express");
const compression = require("compression");
const path = require("path");
const axios = require("axios");
const { openDatabase } = require("./database");
const { privateAuth } = require("./auth");
const { createBankTagsRouter } = require("./bank-tags");

function createApp(config, options = {}) {
  const app = express();
  const db = options.db || openDatabase(config.databasePath);
  const request = options.request || axios;

  app.use(compression());
  app.use(express.json({ limit: 100000 }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/group/:groupName", createBankTagsRouter(db, privateAuth(config)));

  const proxy = async (req, res, upstreamPath) => {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.referer;
    if (upstreamPath.startsWith("/api/group/")) headers.authorization = config.upstreamGroupToken;
    try {
      const response = await request({
        method: req.method,
        url: `${config.upstreamBaseUrl}${upstreamPath}`,
        responseType: "stream",
        headers,
        data: req.body,
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024,
      });
      res.status(response.status);
      res.set(response.headers);
      response.data.pipe(res);
    } catch (failure) {
      if (failure.response) {
        res.status(failure.response.status);
        res.set(failure.response.headers);
        failure.response.data.pipe(res);
      } else {
        res.status(502).json({ error: "upstream_unavailable" });
      }
    }
  };

  app.use("/api/group/:groupName", privateAuth(config), (req, res) => {
    const suffix = req.originalUrl.slice(`/api/group/${encodeURIComponent(req.params.groupName)}`.length);
    return proxy(req, res, `/api/group/${encodeURIComponent(config.upstreamGroupName)}${suffix}`);
  });
  app.use("/api", (req, res) => proxy(req, res, req.originalUrl));

  app.use(express.static("public"));
  app.use(express.static("."));
  app.get("*", (req, res) => {
    if (req.path.includes("/map") && req.path.includes(".png")) return res.sendStatus(404);
    return res.sendFile(path.resolve("public", "index.html"));
  });

  app.use((failure, _req, res, _next) => {
    if (failure.type === "entity.too.large")
      return res.status(413).json({ error: "payload_too_large", message: "request body exceeds 100000 bytes" });
    if (failure.type === "entity.parse.failed")
      return res.status(400).json({ error: "invalid_tag", message: "request body is not valid JSON" });
    console.error(failure);
    return res.status(500).json({ error: "internal_error" });
  });

  return { app, db };
}

module.exports = { createApp };
