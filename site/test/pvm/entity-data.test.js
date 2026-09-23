import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearPvmEntityCache, loadPvmEntities } from "../../src/pvm/entity-loader";

const equipment = JSON.parse(readFileSync("vendor/osrs-wiki-dps/cdn/json/equipment.json", "utf8"));
const monsters = JSON.parse(readFileSync("vendor/osrs-wiki-dps/cdn/json/monsters.json", "utf8"));
const spells = JSON.parse(readFileSync("vendor/osrs-wiki-dps/cdn/json/spells.json", "utf8"));

function fetchEntities(url) {
  const data = url.endsWith("equipment.json") ? equipment : url.endsWith("monsters.json") ? monsters : spells;
  return Promise.resolve({ ok: true, json: async () => data });
}

describe("vendored PvM entities", () => {
  it("contains the complete pinned equipment and monster snapshots", () => {
    expect(equipment.length).toBeGreaterThan(5000);
    expect(monsters.length).toBeGreaterThan(2800);
    expect(spells.length).toBeGreaterThan(50);
    expect(equipment).toContainEqual(expect.objectContaining({ id: 11832, name: "Bandos chestplate", slot: "body" }));
    expect(monsters).toContainEqual(expect.objectContaining({ id: 8059, name: "Vorkath", version: "Post-quest" }));
  });

  it("normalizes every supported slot and preserves monster versions", async () => {
    clearPvmEntityCache();
    const entities = await loadPvmEntities(fetchEntities);
    expect([...entities.equipmentBySlot.keys()].sort()).toEqual([
      "ammo",
      "body",
      "cape",
      "feet",
      "hands",
      "head",
      "legs",
      "neck",
      "ring",
      "shield",
      "weapon",
    ]);
    expect(entities.targetsByKey.get("8059:Post-quest")).toMatchObject({ name: "Vorkath", skills: { hp: 750 } });
    expect(entities.targetsByLabel.get("Vorkath (Post-quest) [8059]")).toMatchObject({ id: 8059 });
    expect(entities.spells).toContainEqual(expect.objectContaining({ name: "Fire Surge", spellbook: "standard" }));
    expect(entities.spells).not.toContainEqual(expect.objectContaining({ name: "Bind" }));
  });

  it("allows a failed lazy load to be retried", async () => {
    clearPvmEntityCache();
    await expect(loadPvmEntities(async () => ({ ok: false, status: 503 }))).rejects.toThrow("503");
    const entities = await loadPvmEntities(fetchEntities);
    expect(entities.equipmentById.get(11832)?.name).toBe("Bandos chestplate");
  });
});
