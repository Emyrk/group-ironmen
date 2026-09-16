const express = require("express");

const ITEM_FIELDS = ["inventory", "equipment", "bank", "rune_pouch", "seed_vault"];

function centralDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function history(db) {
  const rows = db.prepare("SELECT snapshot_date,items FROM item_snapshots ORDER BY snapshot_date").all();
  const result = [];
  for (let i = 1; i < rows.length; i += 1) {
    result.push({
      date: rows[i].snapshot_date,
      ...changesBetween(JSON.parse(rows[i - 1].items), JSON.parse(rows[i].items)),
    });
  }
  return result.reverse().slice(0, 30);
}

function retentionCutoff(snapshotDate) {
  const cutoff = new Date(`${snapshotDate}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  return cutoff.toISOString().slice(0, 10);
}

async function ensureSnapshot(db, config, request, snapshotDate = centralDate()) {
  const existing = db.prepare("SELECT 1 FROM item_snapshots WHERE snapshot_date=?").get(snapshotDate);
  if (existing) return false;

  const response = await request({
    method: "GET",
    url: `${config.upstreamBaseUrl}/api/group/${encodeURIComponent(config.upstreamGroupName)}/get-group-data`,
    responseType: "json",
    headers: { authorization: config.upstreamGroupToken },
    params: { from_time: new Date(0).toISOString() },
    timeout: 15000,
    maxContentLength: 10 * 1024 * 1024,
  });
  const items = aggregateItems(response.data);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR IGNORE INTO item_snapshots (snapshot_date,items,created_at) VALUES (?,?,?)").run(
      snapshotDate,
      JSON.stringify(items),
      new Date().toISOString()
    );
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
  router.use(auth);
  router.get("/get-item-history", async (_req, res, next) => {
    try {
      await ensureSnapshot(db, config, request);
      return res.json(history(db));
    } catch (failure) {
      return next(failure);
    }
  });
  return router;
}

module.exports = {
  aggregateItems,
  centralDate,
  changesBetween,
  createItemHistoryRouter,
  ensureSnapshot,
  history,
  retentionCutoff,
};
