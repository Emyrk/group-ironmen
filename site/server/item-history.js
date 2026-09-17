const express = require("express");

const itemData = require("../public/data/item_data.json");

const CHARGE_FAMILIES = new Set([
  "Abyssal bracelet",
  "Amulet of glory",
  "Burning amulet",
  "Castle wars bracelet",
  "Combat bracelet",
  "Digsite pendant",
  "Enchanted lyre",
  "Games necklace",
  "Necklace of passage",
  "Ring of dueling",
  "Ring of returning",
  "Ring of wealth",
  "Skills necklace",
  "Slayer ring",
  "Teleport crystal",
]);
const ZERO_CHARGE_VARIANTS = new Map([
  ["Amulet of glory (t)", "Amulet of glory"],
  ["Ring of wealth (i)", "Ring of wealth"],
]);
const chargeItems = new Map();
const chargeFamilies = new Map();
for (const [itemIdValue, details] of Object.entries(itemData)) {
  const match = details.name.match(/^(.*?)\s*\([it]?(\d+)\)$/);
  const family = match?.[1].trim() || ZERO_CHARGE_VARIANTS.get(details.name) || details.name;
  if (!CHARGE_FAMILIES.has(family)) continue;
  const itemId = Number(itemIdValue);
  const charges = match ? Number(match[2]) : 0;
  chargeItems.set(itemId, { family, charges });
  const existing = chargeFamilies.get(family);
  if (!existing || charges > existing.maxCharges) {
    chargeFamilies.set(family, { itemId, maxCharges: charges });
  }
}

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

function chargeTotals(items) {
  const totals = new Map();
  for (const [itemIdValue, quantity] of Object.entries(items)) {
    const chargedItem = chargeItems.get(Number(itemIdValue));
    if (!chargedItem) continue;
    totals.set(chargedItem.family, (totals.get(chargedItem.family) || 0) + quantity * chargedItem.charges);
  }
  return totals;
}

function changesBetween(previous, current) {
  const ids = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const gained = [];
  const lost = [];
  for (const id of ids) {
    const itemId = Number(id);
    if (chargeItems.has(itemId)) continue;
    const difference = (current[id] || 0) - (previous[id] || 0);
    if (difference > 0) gained.push({ item_id: itemId, quantity: difference });
    if (difference < 0) lost.push({ item_id: itemId, quantity: -difference });
  }
  gained.sort((a, b) => a.item_id - b.item_id);
  lost.sort((a, b) => a.item_id - b.item_id);

  const previousCharges = chargeTotals(previous);
  const currentCharges = chargeTotals(current);
  const chargeChanges = [];
  const families = new Set([...previousCharges.keys(), ...currentCharges.keys()]);
  for (const family of families) {
    const from = previousCharges.get(family) || 0;
    const to = currentCharges.get(family) || 0;
    if (from === to) continue;
    chargeChanges.push({
      name: family,
      item_id: chargeFamilies.get(family).itemId,
      from,
      to,
      difference: to - from,
    });
  }
  chargeChanges.sort((a, b) => a.name.localeCompare(b.name));
  return { gained, lost, charge_changes: chargeChanges };
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
  const rows = db
    .prepare("SELECT snapshot_date,items,created_at,baseline_items FROM item_snapshots ORDER BY snapshot_date")
    .all();
  const dates = rows.map((row) => row.snapshot_date);
  const snapshots = new Map(rows.map((row) => [row.snapshot_date, JSON.parse(row.items)]));
  const liveRow = rows.find((row) => row.snapshot_date === liveDate);
  const live = {
    date: liveDate,
    updatedAt: liveRow?.created_at || null,
    refreshMinutes: LIVE_REFRESH_MINUTES,
  };
  if (dates.length === 0) {
    return {
      dates,
      from: null,
      to: null,
      singleDay: false,
      baselineDate: null,
      baselineAvailable: false,
      gained: [],
      lost: [],
      charge_changes: [],
      live,
      storage: snapshotStorage(db),
    };
  }

  const to = requestedTo || dates[dates.length - 1];
  const from = requestedFrom || (dates.length > 1 ? dates[dates.length - 2] : to);
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw new RangeError("from and to must use YYYY-MM-DD format");
  }
  if (!snapshots.has(from) || !snapshots.has(to)) {
    throw new RangeError("from and to must reference saved snapshot dates");
  }
  if (from > to) {
    throw new RangeError("from must not be later than to");
  }

  const singleDay = from === to;
  const selectedIndex = dates.indexOf(to);
  const selectedRow = rows[selectedIndex];
  const storedBaseline = selectedRow.baseline_items ? JSON.parse(selectedRow.baseline_items) : null;
  const previousDateBaseline = selectedIndex > 0 ? snapshots.get(dates[selectedIndex - 1]) : null;
  const baseline = singleDay ? storedBaseline || previousDateBaseline || snapshots.get(to) : snapshots.get(from);
  const baselineDate = singleDay ? (storedBaseline ? to : dates[selectedIndex - 1] || to) : from;
  const baselineAvailable = !singleDay || storedBaseline !== null || previousDateBaseline !== null;

  return {
    dates,
    from,
    to,
    singleDay,
    baselineDate,
    baselineAvailable,
    ...changesBetween(baseline, snapshots.get(to)),
    live,
    storage: snapshotStorage(db),
  };
}

async function ensureSnapshot(db, config, request, snapshotDate = centralDate(), now = new Date()) {
  const existing = db
    .prepare("SELECT created_at,items,baseline_items FROM item_snapshots WHERE snapshot_date=?")
    .get(snapshotDate);
  if (existing && existing.baseline_items === null) {
    db.prepare("UPDATE item_snapshots SET baseline_items=items WHERE snapshot_date=?").run(snapshotDate);
    existing.baseline_items = existing.items;
  }
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
      "INSERT INTO item_snapshots (snapshot_date,items,created_at,baseline_items) VALUES (?,?,?,?) ON CONFLICT(snapshot_date) DO UPDATE SET items=excluded.items,created_at=excluded.created_at,baseline_items=COALESCE(item_snapshots.baseline_items,item_snapshots.items)"
    ).run(snapshotDate, items, updatedAt, items);
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
  chargeTotals,
  changesBetween,
  comparison,
  createItemHistoryRouter,
  ensureSnapshot,
  previousDate,
  retentionCutoff,
  snapshotStorage,
};
