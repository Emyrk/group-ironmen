const ENTITY_URLS = Object.freeze({
  equipment: "/data/pvm/equipment.json",
  monsters: "/data/pvm/monsters.json",
  spells: "/data/pvm/spells.json",
});

let entityPromise;

async function fetchJson(url, fetchImplementation) {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new Error(`Failed to load PvM data from ${url} (${response.status})`);
  return response.json();
}

function targetKey(monster) {
  return `${monster.id}:${monster.version || ""}`;
}

function targetLabel(monster) {
  const version = monster.version ? ` (${monster.version})` : "";
  return `${monster.name}${version} [${monster.id}]`;
}

function normalizeEntities(equipment, monsters, spells) {
  if (!Array.isArray(equipment) || !Array.isArray(monsters) || !Array.isArray(spells)) {
    throw new Error("PvM entity data has an unexpected format");
  }

  const equipmentById = new Map();
  const equipmentBySlot = new Map();
  for (const item of equipment) {
    if (!Number.isSafeInteger(item?.id) || !item.slot) continue;
    if (!equipmentById.has(item.id)) equipmentById.set(item.id, item);
    if (!equipmentBySlot.has(item.slot)) equipmentBySlot.set(item.slot, []);
    equipmentBySlot.get(item.slot).push(item);
  }

  const targets = monsters
    .filter((monster) => Number.isSafeInteger(monster?.id) && monster.name)
    .map((monster) => ({ ...monster, key: targetKey(monster), label: targetLabel(monster) }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

  return {
    equipment,
    equipmentById,
    equipmentBySlot,
    monsters,
    spells: spells.filter((spell) => spell?.name && Number.isFinite(spell.max_hit) && spell.max_hit > 0),
    targets,
    targetsByKey: new Map(targets.map((monster) => [monster.key, monster])),
    targetsByLabel: new Map(targets.map((monster) => [monster.label, monster])),
  };
}

export function loadPvmEntities(fetchImplementation = fetch) {
  if (!entityPromise) {
    entityPromise = Promise.all([
      fetchJson(ENTITY_URLS.equipment, fetchImplementation),
      fetchJson(ENTITY_URLS.monsters, fetchImplementation),
      fetchJson(ENTITY_URLS.spells, fetchImplementation),
    ])
      .then(([equipment, monsters, spells]) => normalizeEntities(equipment, monsters, spells))
      .catch((error) => {
        entityPromise = undefined;
        throw error;
      });
  }
  return entityPromise;
}

export function clearPvmEntityCache() {
  entityPromise = undefined;
}
