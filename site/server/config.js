const path = require("path");

function configFromEnv(env = process.env) {
  return {
    port: Number.parseInt(env.PORT || "4000", 10),
    databasePath: env.DATABASE_PATH || path.resolve("data", "group-ironmen.sqlite3"),
    privateGroupName: env.PRIVATE_GROUP_NAME || "",
    privateSyncToken: env.PRIVATE_SYNC_TOKEN || "",
    upstreamBaseUrl: (env.UPSTREAM_BASE_URL || "https://groupiron.men").replace(/\/$/, ""),
    upstreamGroupName: env.UPSTREAM_GROUP_NAME || env.PRIVATE_GROUP_NAME || "",
    upstreamGroupToken: env.UPSTREAM_GROUP_TOKEN || "",
  };
}

module.exports = { configFromEnv };
