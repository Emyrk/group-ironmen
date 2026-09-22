const crypto = require("crypto");

function safeEqual(actual, expected) {
  const a = Buffer.from(actual || "");
  const b = Buffer.from(expected || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function privateAuth(config) {
  return (req, res, next) => {
    if (!config.privateGroupName || req.params.groupName !== config.privateGroupName) {
      return res.status(404).end();
    }

    const authorization = req.get("Authorization");
    if (req.method === "GET" && authorization === undefined) {
      res.locals.guestMode = true;
      return next();
    }
    if (!config.privateSyncToken || !safeEqual(authorization, config.privateSyncToken)) {
      return res.status(401).end();
    }
    next();
  };
}

module.exports = { privateAuth, safeEqual };
