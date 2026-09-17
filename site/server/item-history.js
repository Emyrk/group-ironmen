const express = require("express");

const ITEM_FIELDS = ["inventory", "equipment", "bank", "rune_pouch", "seed_vault"];
const LIVE_REFRESH_MINUTES = 15;
const LIVE_REFRESH_MS = LIVE_REFRESH_MINUTES * 60 * 1000;

function centralDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  if (Number(values.hour) >= 2) return date;
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function previousDate(date) {
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function addItemPairs(items, totals) {
  if (!Array.isArray(items)) return;
  for (let i = 0; i + 1 < items.length; i += 2) {
    const itemId = items[i];
    const quantity = items[i + 1];
    if (Number.isInteger(itemId) && itemId > 0 && Number.isInteger(quantity) && quantity > 0) {
      totals.set(itemId, (totals.get(itemId) || 0) + quantity);
    }
  }
}

function aggregateItems(members) {
  const totals = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    for (const field of ITEM_FIELDS) addItemPairs(member[field], totals);
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => a - b));
}

function changesBetween(previous, current) {
  const ids = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const gained = [];
  const lost = [];
  for (const id of ids) {
    const itemId = Number(id);
    const difference = (current[id] || 0) - (previous[id] || 0);
    if (difference > 0) gained.push({ item_id: itemId, quantity: difference });
    if (difference < 0) lost.push({ item_id: itemId, quantity: -difference });
  }
  gained.sort((a, b) => a.item_id - b.item_id);
  lost.sort((a, b) => a.item_id - b.item_id);
  return { gained, lost };
}

const RETENTION_DAYS = 365;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function retentionCutoff(snapshotDate) {
  const cutoff = new Date(`${snapshotDate}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
  return cutoff.toISOString().slice(0, 10);
}

function snapshotStorage(db) {
  const snapshots = db
    .prepare(
      "SELECT COUNT(*) AS snapshot_count, COALESCE(SUM(length(items)), 0) AS snapshot_bytes, MIN(snapshot_date) AS oldest_date, MAX(snapshot_date) AS newest_date FROM item_snapshots"
    )
    .get();
  const pageCount = db.prepare("PRAGMA page_count").get().page_count;
  const pageSize = db.prepare("PRAGMA page_size").get().page_size;
  return {
    snapshotCount: snapshots.snapshot_count,
    snapshotBytes: snapshots.snapshot_bytes,
    databaseBytes: pageCount * pageSize,
    oldestDate: snapshots.oldest_date,
    newestDate: snapshots.newest_date,
    retentionDays: RETENTION_DAYS,
  };
}

function comparison(db, requestedFrom, requestedTo, liveDate = centralDate()) {
  const rows = db.prepare("SELECT snapshot_date,items,created_at FROM item_snapshots ORDER BY snapshot_date").all();
  const dates = rows.map((row) => row.snapshot_date);
  const snapshots = new Map(rows.map((row) => [row.snapshot_date, JSON.parse(row.items)]));
  const liveRow = rows.find((row) => row.snapshot_date === liveDate);
  const live = {
    date: liveDate,
    updatedAt: liveRow?.created_at || null,
    refreshMinutes: LIVE_REFRESH_MINUTES,
  };
  if (dates.length < 2) {
    return { dates, from: null, to: null, gained: [], lost: [], live, storage: snapshotStorage(db) };
  }

  const from = requestedFrom || dates[dates.length - 2];
  const to = requestedTo || dates[dates.length - 1];
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw new RangeError("from and to must use YYYY-MM-DD format");
  }
  if (!snapshots.has(from) || !snapshots.has(to)) {
    throw new RangeError("from and to must reference saved snapshot dates");
  }
  if (from >= to) {
    throw new RangeError("from must be earlier than to");
  }

  return {
    dates,
    from,
    to,
    ...changesBetween(snapshots.get(from), snapshots.get(to)),
    live,
    storage: snapshotStorage(db),
  };
}

async function ensureSnapshot(db, config, request, snapshotDate = centralDate(), now = new Date()) {
  const existing = db.prepare("SELECT created_at FROM item_snapshots WHERE snapshot_date=?").get(snapshotDate);
  if (existing && now.getTime() - new Date(existing.created_at).getTime() < LIVE_REFRESH_MS) return false;

  const response = await request({
    method: "GET",
    url: `${config.upstreamBaseUrl}/api/group/${encodeURIComponent(config.upstreamGroupName)}/get-group-data`,
    responseType: "json",
    headers: { authorization: config.upstreamGroupToken },
    params: { from_time: new Date(0).toISOString() },
    timeout: 15000,
    maxContentLength: 10 * 1024 * 1024,
  });
  const items = JSON.stringify(aggregateItems(response.data));
  const updatedAt = now.toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    if (!existing) {
      // At the 2 AM Central rollover, the first refresh becomes the final value for yesterday
      // and the initial value for the new live day. This keeps the boundary diff at zero.
      db.prepare("UPDATE item_snapshots SET items=?,created_at=? WHERE snapshot_date=?").run(
        items,
        updatedAt,
        previousDate(snapshotDate)
      );
    }
    db.prepare(
      "INSERT INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?) ON CONFLICT(snapshot_date) DO UPDATE SET items=excluded.items,created_at=excluded.created_at"
    ).run(snapshotDate, items, updatedAt);
    db.prepare("DELETE FROM item_snapshots WHERE snapshot_date < ?").run(retentionCutoff(snapshotDate));
    db.exec("COMMIT");
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
  return true;
}

function createItemHistoryRouter(db, auth, config, request) {
  const router = express.Router({ mergeParams: true });
  let refreshPromise;
  const refresh = () => {
    if (!refreshPromise) {
      refreshPromise = ensureSnapshot(db, config, request).finally(() => {
        refreshPromise = undefined;
      });
    }
    return refreshPromise;
  };
  const timer = setInterval(() => {
    refresh().catch((failure) => console.error("Failed to refresh live item snapshot", failure));
  }, LIVE_REFRESH_MS);
  timer.unref?.();

  router.use(auth);
  router.get("/get-item-history", async (req, res, next) => {
    try {
      await refresh();
      return res.json(comparison(db, req.query.from, req.query.to));
    } catch (failure) {
      if (failure instanceof RangeError) {
        return res.status(400).json({ error: "invalid_date_range", message: failure.message });
      }
      return next(failure);
    }
  });
  return router;
}

module.exports = {
  LIVE_REFRESH_MINUTES,
  RETENTION_DAYS,
  aggregateItems,
  centralDate,
  changesBetween,
  comparison,
  createItemHistoryRouter,
  ensureSnapshot,
  previousDate,
  retentionCutoff,
  snapshotStorage,
};
