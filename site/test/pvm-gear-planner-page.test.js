import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pubsub } from "../src/data/pubsub";

let delayedAmmoWeaponId = null;
let releaseDelayedAmmo = null;

const requests = [];

function equipment(id, name, slot, score = 0, category = "") {
  return {
    id,
    name,
    slot,
    version: "",
    category,
    weight: 1,
    speed: slot === "weapon" ? 4 : 0,
    isTwoHanded: false,
    bonuses: { str: score, ranged_str: 0, magic_str: 0, prayer: score },
    offensive: { stab: score, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defensive: { stab: score, slash: score, crush: score, magic: 0, ranged: 0 },
  };
}

function combatWeapon(id, name, category, type, score = 80) {
  const item = equipment(id, name, "weapon", 4, category);
  item.offensive = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0, [type]: score };
  return item;
}

function defensiveShield(id, name, defence) {
  const item = equipment(id, name, "shield");
  item.defensive = { stab: defence, slash: defence, crush: defence, magic: defence, ranged: defence };
  return item;
}

function chargedJewellery(id, name, version, score) {
  const item = equipment(id, name, "neck", score);
  item.version = version;
  return item;
}

function rangedAmmo(id, name, rangedStrength) {
  const item = equipment(id, name, "ammo");
  item.bonuses.ranged_str = rangedStrength;
  return item;
}

const equipmentEntities = [
  equipment(10828, "Helm of Neitiznot", "head", 2),
  equipment(24271, "Neitiznot faceguard", "head", 4),
  equipment(6570, "Fire cape", "cape", 2),
  equipment(6585, "Amulet of fury", "neck", 2),
  chargedJewellery(1704, "Amulet of glory", "Uncharged", 1),
  chargedJewellery(11978, "Amulet of glory", "6", 1),
  equipment(11105, "Skills necklace", "neck"),
  rangedAmmo(9244, "Dragonstone bolts (e)", 117),
  rangedAmmo(9144, "Runite bolts", 115),
  rangedAmmo(11212, "Dragon arrow", 60),
  rangedAmmo(892, "Rune arrow", 49),
  rangedAmmo(890, "Adamant arrow", 31),
  rangedAmmo(882, "Bronze arrow", 7),
  rangedAmmo(8882, "Bone bolts", 49),
  equipment(20220, "Holy blessing", "ammo", 1),
  combatWeapon(4151, "Abyssal whip", "Whip", "slash"),
  combatWeapon(861, "Magic shortbow", "Bow", "ranged", 100),
  combatWeapon(21012, "Dragon hunter crossbow", "Crossbow", "ranged"),
  combatWeapon(8880, "Dorgeshuun crossbow", "Crossbow", "ranged", 42),
  combatWeapon(23983, "Crystal bow", "Bow", "ranged", 120),
  combatWeapon(27665, "Accursed sceptre", "Powered Staff", "magic"),
  equipment(11832, "Bandos chestplate", "body", 4),
  equipment(10551, "Fighter torso", "body", 3),
  equipment(9674, "Proselyte hauberk", "body", 1),
  equipment(8850, "Rune defender", "shield", 2),
  defensiveShield(1540, "Anti-dragon shield", 8),
  defensiveShield(1193, "Steel kiteshield", 14),
  defensiveShield(1197, "Mithril kiteshield", 20),
  defensiveShield(1201, "Rune kiteshield", 46),
  equipment(11834, "Bandos tassets", "legs", 3),
  equipment(7462, "Barrows gloves", "hands", 2),
  equipment(11840, "Dragon boots", "feet", 2),
  equipment(6737, "Berserker ring", "ring", 2),
];
const monsterEntities = [
  {
    id: 5779,
    name: "Giant Mole",
    version: "",
    style: ["Crush"],
    weakness: { element: "earth", severity: 50 },
    skills: { hp: 200 },
  },
  {
    id: 8059,
    name: "Vorkath",
    version: "Post-quest",
    style: ["Slash", "Magic", "Ranged", "Dragonfire"],
    attributes: ["dragon"],
    weakness: { element: "fire", severity: 40 },
    skills: { hp: 750 },
  },
  { id: 415, name: "Abyssal demon", version: "Standard", skills: { hp: 150 } },
  { id: 2267, name: "Dagannoth Rex", version: "", skills: { hp: 255 } },
  { id: 2215, name: "General Graardor", version: "", skills: { hp: 255 } },
  { id: 2042, name: "Zulrah", version: "Serpentine", skills: { hp: 500 } },
  { id: 2043, name: "Zulrah", version: "Magma", skills: { hp: 500 } },
  { id: 2044, name: "Zulrah", version: "Tanzanite", skills: { hp: 500 } },
  { id: 12204, name: "The Whisperer", version: "Post-quest", skills: { hp: 900 } },
];

function normalizedEntities() {
  const targets = monsterEntities.map((monster) => ({
    ...monster,
    key: `${monster.id}:${monster.version}`,
    label: `${monster.name}${monster.version ? ` (${monster.version})` : ""} [${monster.id}]`,
  }));
  const equipmentBySlot = new Map();
  for (const item of equipmentEntities) {
    if (!equipmentBySlot.has(item.slot)) equipmentBySlot.set(item.slot, []);
    equipmentBySlot.get(item.slot).push(item);
  }
  return {
    equipment: equipmentEntities,
    spells: [
      { name: "Fire Surge", image: "Fire Surge.png", spellbook: "standard", element: "fire", max_hit: 24 },
      { name: "Ice Barrage", image: "Ice Barrage.png", spellbook: "ancient", max_hit: 30 },
      { name: "Dark Demonbane", image: "Dark Demonbane.png", spellbook: "arceuus", max_hit: 30 },
      { name: "Saradomin Strike", image: "Saradomin Strike.png", spellbook: "standard", max_hit: 20 },
      { name: "Ghostly Grasp", image: "Ghostly Grasp.png", spellbook: "arceuus", max_hit: 12 },
      { name: "Bind", image: "Bind.png", spellbook: "standard", max_hit: 0 },
    ].filter((spell) => spell.max_hit > 0),
    equipmentById: new Map(equipmentEntities.map((item) => [item.id, item])),
    equipmentBySlot,
    monsters: monsterEntities,
    targets,
    targetsByKey: new Map(targets.map((target) => [target.key, target])),
    targetsByLabel: new Map(targets.map((target) => [target.label, target])),
  };
}

vi.mock("../src/pvm/entity-loader", () => ({
  loadPvmEntities: vi.fn(async () => normalizedEntities()),
}));

vi.mock("../src/pvm/calculator-client", async () => {
  const actual = await vi.importActual("../src/pvm/calculator-client");
  return {
    ...actual,
    createWorkerCalculatorTransport: vi.fn(() => async (request) => {
      requests.push(request);
      if (request.action === "compatible-ammo") {
        if (request.player.equipment.weapon === delayedAmmoWeaponId) {
          delayedAmmoWeaponId = null;
          await new Promise((resolve) => {
            releaseDelayedAmmo = resolve;
          });
        }
        const ammoIds =
          standardBowIds.has(request.player.equipment.weapon) || request.player.equipment.weapon === 861
            ? [11212, 892, 890, 882]
            : request.player.equipment.weapon === 21012
            ? [9244, 9144]
            : request.player.equipment.weapon === 8880
            ? [8882]
            : [];
        return {
          version: 1,
          requestId: request.requestId,
          result: { ammoIds, requiresAmmo: ammoIds.length > 0 },
        };
      }
      const bodyId = request.player.equipment.body;
      const targetModifier = request.monster.id === 8059 ? -1 : 0;
      const modeModifier = request.options.mode === "Melee" ? 0.5 : request.options.mode === "Ranged" ? 0.25 : 0;
      const spellDps = {
        "Fire Surge": 10,
        "Ice Barrage": 9,
        "Dark Demonbane": 4,
        "Saradomin Strike": 8,
        "Ghostly Grasp": 5,
      };
      const gearDps =
        request.options.mode === "Melee"
          ? bodyId === 11832
            ? 3
            : bodyId === 10551
            ? 2
            : 1
          : request.options.mode === "Ranged"
          ? bodyId === 10551
            ? 4
            : bodyId === 9674
            ? 2
            : 1
          : bodyId === 9674
          ? 5
          : bodyId === 10551
          ? 2
          : 1;
      const dps =
        request.options.mode === "Magic" ? spellDps[request.options.spell] + gearDps : 5 + gearDps + modeModifier;
      const headDamageTaken =
        request.player.equipment.head === 10828 ? 1 : request.player.equipment.head === 24271 ? 2 : 3;
      const bodyDamageTaken =
        request.player.equipment.body === 11832 ? 4 : request.player.equipment.body === 10551 ? 0.5 : 0;
      const damageTakenPerSecond = headDamageTaken + bodyDamageTaken;
      const finalDps = dps + targetModifier;
      const styleResults =
        request.options.mode === "Melee"
          ? [
              { dps: finalDps, style: { name: "Flick", type: "slash", stance: "Accurate" } },
              { dps: finalDps - 0.25, style: { name: "Lash", type: "slash", stance: "Controlled" } },
              { dps: finalDps - 0.5, style: { name: "Deflect", type: "slash", stance: "Defensive" } },
            ]
          : request.options.mode === "Ranged"
          ? [
              { dps: finalDps, style: { name: "Rapid", type: "ranged", stance: "Rapid" } },
              { dps: finalDps - 0.25, style: { name: "Accurate", type: "ranged", stance: "Accurate" } },
              { dps: finalDps - 0.5, style: { name: "Longrange", type: "ranged", stance: "Longrange" } },
            ]
          : [{ dps: finalDps, style: { name: "Accurate", type: "magic", stance: "Accurate" } }];
      return {
        version: 1,
        requestId: request.requestId,
        result: {
          dps: finalDps,
          damageTakenPerSecond,
          accuracy: 0.75,
          maxHit: request.options.spell === "Fire Surge" ? 20 : 32,
          attackSpeed: 4,
          expectedTtk: request.monster.id === 8059 ? 100 : 25,
          style: styleResults[0].style,
          styleResults,
        },
      };
    }),
  };
});

const {
  PvmGearPlannerPage,
  ammoAllowedByTier,
  ammoSupportsStyle,
  groupSpellResults,
  isCrystalBow,
  itemFamilyKey,
  itemHasCombatStats,
  itemStatChanges,
  preferCandidateOnTie,
  rangedAmmoTier,
  spellDpsComparison,
  spellMagicLevelRequirement,
  spellRuneTags,
  targetNeedsAntiFire,
  targetStyleDefence,
  weaponSupportsStyle,
} = await import("../src/pvm-gear-planner-page/pvm-gear-planner-page");

PvmGearPlannerPage.prototype.html = function () {
  return `
    <header>
      <select data-control="member">${this.renderMemberOptions()}</select>
      <input data-control="target" value="${this.renderSelectedTargetLabel()}" />
      <datalist>${this.renderTargetOptions()}</datalist>
    </header>
    <button data-reset-all>Optimize all</button>
    <section class="pvm-gear-planner-page__style-picker">${this.renderStyleCards()}</section>
    ${this.renderStatus()}
    <section class="pvm-gear-planner-page__results">${this.renderResults()}</section>
    <section class="pvm-gear-planner-page__paperdoll">${this.renderPaperdoll()}</section>
    ${
      this.activeStyle === "Magic"
        ? `<div class="pvm-gear-planner-page__selected-spell">${this.activeLoadout.selectedSpell}</div>`
        : ""
    }
    <section>
      <h2>Top owned candidates ranked by real DPS</h2>
      ${this.renderBankItemSearch()}
      <div class="pvm-gear-planner-page__alternatives">${this.renderAlternatives()}</div>
    </section>`;
};

function item(id) {
  return { id, isValid: () => id > 0 };
}

function member(name, ownedItemIds, equippedBodyId) {
  const owned = new Set(ownedItemIds);
  const equipmentSlots = Array.from({ length: 14 }, () => item(0));
  equipmentSlots[4] = item(equippedBodyId);
  equipmentSlots[13] = item(892);
  return {
    name,
    equipment: equipmentSlots,
    skills: Object.fromEntries(
      ["Attack", "Defence", "Hitpoints", "Magic", "Prayer", "Ranged", "Strength", "Mining", "Herblore"].map((skill) => [
        skill,
        { level: 99 },
      ])
    ),
    totalItemQuantity(itemId) {
      return owned.has(itemId) ? 1 : 0;
    },
    *allItems() {
      for (const itemId of owned) yield { id: itemId, quantity: 1 };
    },
  };
}

function groupData() {
  return {
    members: new Map([
      [
        "Alice",
        member(
          "Alice",
          [
            10828, 24271, 6570, 6585, 1704, 11978, 11105, 892, 9244, 20220, 4151, 861, 21012, 27665, 11832, 10551, 8850,
            1540, 1193, 1197, 1201, 11834, 7462, 11840, 6737,
          ],
          11832
        ),
      ],
      ["Bob", member("Bob", [10828, 6570, 6585, 4151, 10551, 11834, 7462, 11840, 6737], 10551)],
      ["@SHARED", member("@SHARED", [9674], 0)],
    ]),
  };
}

async function createPage(data = groupData()) {
  const page = document.createElement("pvm-gear-planner-page");
  document.body.appendChild(page);
  pubsub.publish("get-group-data", data);
  await vi.waitFor(() =>
    expect(page.querySelector(".pvm-gear-planner-page__results strong")?.textContent).not.toBe("…")
  );
  return page;
}

async function waitForReadyAlternatives(page) {
  await vi.waitFor(() => {
    const rows = [...page.querySelectorAll(".pvm-gear-planner-page__alternative")];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.querySelector(".pvm-gear-planner-page__tier")?.textContent !== "…")).toBe(true);
    expect(rows.every((row) => !row.querySelector("dl")?.textContent.includes("…"))).toBe(true);
  });
}

const extraBodyIds = new Set(Array.from({ length: 13 }, (_, index) => 31000 + index));
const extraRangedWeaponIds = new Set(Array.from({ length: 13 }, (_, index) => 32000 + index));
const standardBowIds = new Set([839, 841, 843, 845, 847, 849, 851, 853, 855, 857, 859]);
const standardScimitarIds = new Set([1321, 1323, 1325, 1327, 1329, 1331, 1333]);
const temporaryEquipmentIds = new Set([
  1123,
  ...extraBodyIds,
  ...extraRangedWeaponIds,
  ...standardBowIds,
  ...standardScimitarIds,
]);

describe("pvm-gear-planner-page", () => {
  beforeEach(() => {
    requests.length = 0;
    delayedAmmoWeaponId = null;
    releaseDelayedAmmo = null;
    localStorage.clear();
    document.body.innerHTML = "";
    for (let index = equipmentEntities.length - 1; index >= 0; index -= 1) {
      if (temporaryEquipmentIds.has(equipmentEntities[index].id)) equipmentEntities.splice(index, 1);
    }
    window.history.replaceState("", "", "/group/pvm-gear");
  });

  it("filters statless items and groups tiered and charged variants", () => {
    expect(itemHasCombatStats(equipmentEntities.find((item) => item.id === 11105))).toBe(false);
    expect(itemHasCombatStats(equipmentEntities.find((item) => item.id === 1540))).toBe(true);
    expect(itemFamilyKey(equipmentEntities.find((item) => item.id === 1193))).toBe(
      itemFamilyKey(equipmentEntities.find((item) => item.id === 1201))
    );
    expect(itemFamilyKey(equipmentEntities.find((item) => item.id === 1704))).toBe(
      itemFamilyKey(equipmentEntities.find((item) => item.id === 11978))
    );
    expect(targetNeedsAntiFire(monsterEntities.find((monster) => monster.id === 8059))).toBe(true);
    expect(targetNeedsAntiFire(monsterEntities.find((monster) => monster.id === 5779))).toBe(false);
  });

  it("breaks equal-offence ties with prayer before raw target-style defence", () => {
    const target = { style: ["Crush", "Ranged", "Dragonfire"] };
    const base = equipment(30001, "Base armour", "body", 4);
    base.bonuses.prayer = 0;
    const defensive = equipment(30002, "Defensive armour", "body", 4);
    defensive.bonuses.prayer = 0;
    defensive.defensive.crush = 12;
    defensive.defensive.ranged = 8;
    const prayer = equipment(30003, "Prayer armour", "body", 4);
    prayer.bonuses.prayer = 1;

    expect(targetStyleDefence(defensive, target)).toBe(20);
    expect(preferCandidateOnTie(defensive, base, "slash", target)).toBe(true);
    expect(preferCandidateOnTie(prayer, defensive, "slash", target)).toBe(true);

    prayer.offensive.slash += 1;
    expect(preferCandidateOnTie(prayer, defensive, "slash", target)).toBe(false);
  });

  it("reports only non-zero item stat changes", () => {
    const equipped = equipment(30004, "Equipped cape", "cape");
    const candidate = equipment(30005, "Candidate cape", "cape");
    candidate.defensive.slash = 1;
    candidate.defensive.magic = -2;
    candidate.bonuses.prayer = 3;

    expect(itemStatChanges(candidate, equipped)).toEqual([
      { label: "slash defence", difference: 1 },
      { label: "magic defence", difference: -2 },
      { label: "Prayer", difference: 3 },
    ]);
  });

  it("groups the top five spells per spellbook and top three per standard element", () => {
    const spellResults = [
      ...Array.from({ length: 4 }, (_, index) => ({
        spell: `Air ${index}`,
        spellbook: "standard",
        element: "air",
        dps: 20 - index,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        spell: `Fire ${index}`,
        spellbook: "standard",
        element: "fire",
        dps: 16 - index,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        spell: `Ancient ${index}`,
        spellbook: "ancient",
        element: null,
        dps: 12 - index,
      })),
    ];

    const groups = groupSpellResults(spellResults);
    expect(groups.map(({ key }) => key)).toEqual(["standard:air", "standard:fire", "ancient"]);
    expect(groups.find(({ key }) => key === "standard:air").spells).toHaveLength(3);
    expect(groups.find(({ key }) => key === "standard:fire").spells).toHaveLength(3);
    expect(groups.find(({ key }) => key === "ancient").spells).toHaveLength(5);
  });

  it("only allows ranged ammunition in Ranged loadouts", () => {
    const arrow = equipmentEntities.find((item) => item.id === 892);
    const bolts = equipmentEntities.find((item) => item.id === 9244);
    const blessing = equipmentEntities.find((item) => item.id === 20220);

    expect(ammoSupportsStyle(arrow, "Melee")).toBe(false);
    expect(ammoSupportsStyle(bolts, "Magic")).toBe(false);
    expect(ammoSupportsStyle(arrow, "Ranged")).toBe(true);
    expect(ammoSupportsStyle(blessing, "Melee")).toBe(true);
    expect(ammoSupportsStyle(blessing, "Magic")).toBe(true);
  });

  it("only treats weapons with real calculator magic styles as magic weapons", () => {
    const equipment = JSON.parse(readFileSync("vendor/osrs-wiki-dps/cdn/json/equipment.json", "utf8"));
    const ibanStaff = equipment.find((item) => item.id === 1409);
    const pharaohSceptre = equipment.find((item) => item.id === 26948);

    expect(ibanStaff).toMatchObject({ name: "Iban's staff", category: "Staff" });
    expect(weaponSupportsStyle(ibanStaff, "Magic")).toBe(true);
    expect(pharaohSceptre).toMatchObject({ name: "Pharaoh's sceptre", category: "Polestaff" });
    expect(weaponSupportsStyle(pharaohSceptre, "Magic")).toBe(false);
  });

  it("classifies every authoritative offensive spell for budget rune filtering", () => {
    const spells = JSON.parse(readFileSync("vendor/osrs-wiki-dps/cdn/json/spells.json", "utf8"));
    for (const spell of spells.filter((candidate) => candidate.max_hit > 0)) {
      expect(() => spellRuneTags(spell.name)).not.toThrow();
      expect(spellMagicLevelRequirement(spell.name)).toBeGreaterThan(0);
    }
    expect([...spellRuneTags("Fire Surge")]).toEqual(["wrath"]);
    expect([...spellRuneTags("Fire Blast")]).toEqual(["death"]);
    expect([...spellRuneTags("Fire Wave")]).toEqual(["blood"]);
  });

  it("registers the authenticated page and navigation entry", () => {
    const index = readFileSync("src/index.html", "utf8");
    const navigation = readFileSync("src/app-navigation/app-navigation.html", "utf8");
    const plannerTemplate = readFileSync("src/pvm-gear-planner-page/pvm-gear-planner-page.html", "utf8");
    const components = JSON.parse(readFileSync("components.json", "utf8"));

    expect(index).toContain('route-path="/pvm-gear"');
    expect(index).toContain('route-component="pvm-gear-planner-page"');
    expect(navigation).toContain('link-href="/group/pvm-gear"');
    expect(plannerTemplate).toContain('class="pvm-gear-planner-page__style-picker"');
    expect(plannerTemplate).not.toContain('class="pvm-gear-planner-page__rune-restrictions"');
    expect(plannerTemplate).toContain("data-reset-all");
    expect(plannerTemplate).not.toContain('data-control="spell"');
    expect(components).toContain("pvm-gear-planner-page");
    expect(customElements.get("pvm-gear-planner-page")).toBe(PvmGearPlannerPage);
  });

  it("renders three always-visible cards and initializes style-appropriate weapons", async () => {
    const page = await createPage();

    expect(page.querySelector("[data-control='member']").value).toBe("Alice");
    expect([...page.querySelectorAll("[data-control='member'] option")].map((option) => option.value)).toEqual([
      "Alice",
      "Bob",
    ]);
    expect([...page.querySelectorAll("[data-style]")].map((card) => card.dataset.style)).toEqual([
      "Melee",
      "Ranged",
      "Magic",
    ]);
    expect(page.loadouts.Melee.items.weapon.id).toBe(4151);
    expect(page.loadouts.Ranged.items.weapon.id).toBe(861);
    expect(page.loadouts.Ranged.items.ammo.id).toBe(892);
    expect(page.loadouts.Magic.items.weapon.id).toBe(27665);
    expect(page.querySelectorAll(".pvm-gear-planner-page__paperdoll-slot")).toHaveLength(11);
    expect(page.querySelector("[data-slot='body']").title).toContain("Bandos chestplate");
    expect(page.textContent).toContain("Top owned candidates ranked by real DPS");
    page.remove();
  });

  it("hides arrows and bolts from Melee and Magic ammo options", async () => {
    const page = await createPage();
    expect(page.loadouts.Melee.items.ammo.id).toBe(20220);
    expect(page.loadouts.Ranged.items.ammo.id).toBe(892);
    expect(page.loadouts.Magic.items.ammo.id).toBe(20220);

    page.querySelector("[data-slot='ammo']").click();
    expect(page.querySelector("[data-equip-item='20220']")).not.toBeNull();
    expect(page.querySelector("[data-equip-item='892']")).toBeNull();
    expect(page.querySelector("[data-equip-item='9244']")).toBeNull();

    page.querySelector("[data-style='Magic']").click();
    page.querySelector("[data-slot='ammo']").click();
    expect(page.querySelector("[data-equip-item='20220']")).not.toBeNull();
    expect(page.querySelector("[data-equip-item='892']")).toBeNull();
    expect(page.querySelector("[data-equip-item='9244']")).toBeNull();
    page.remove();
  });

  it("chooses the highest-DPS weapon style and lists the other Melee and Ranged styles", async () => {
    const page = await createPage();

    const meleeStyles = [...page.querySelectorAll(".pvm-gear-planner-page__attack-style")];
    expect(meleeStyles).toHaveLength(3);
    expect(meleeStyles.find((style) => style.classList.contains("selected")).textContent).toContain("Flick");
    expect(meleeStyles.map((style) => style.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Lash"), expect.stringContaining("Deflect")])
    );
    expect(page.querySelector("[data-style='Melee']").textContent).toContain("Style: Flick (Slash, Accurate)");

    page.querySelector("[data-style='Ranged']").click();
    const rangedStyles = [...page.querySelectorAll(".pvm-gear-planner-page__attack-style")];
    expect(rangedStyles).toHaveLength(3);
    expect(rangedStyles.find((style) => style.classList.contains("selected")).textContent).toContain("Rapid");
    expect(rangedStyles.map((style) => style.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Accurate"), expect.stringContaining("Longrange")])
    );
    expect(page.querySelector("[data-style='Ranged']").textContent).toContain("Style: Rapid (Ranged)");

    page.querySelector("[data-style='Magic']").click();
    expect(page.querySelector(".pvm-gear-planner-page__attack-styles")).toBeNull();
    page.remove();
  });

  it("ranks owned alternatives by calculator DPS and equips a selection", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));

    const alternatives = [...page.querySelectorAll(".pvm-gear-planner-page__alternative strong")].map(
      (node) => node.textContent
    );
    expect(alternatives[0]).toBe("Bandos chestplate");
    expect(page.querySelector("[data-equip-item='9674']").closest("article").textContent).toContain("Shared storage");
    const fighterTorsoTooltip = page
      .querySelector("[data-equip-item='10551']")
      .closest("article")
      .querySelector(".pvm-gear-planner-page__item-stats-tooltip");
    expect(fighterTorsoTooltip.textContent).toContain("Compared with Bandos chestplate");
    expect(fighterTorsoTooltip.textContent).toContain("Attack bonuses");
    expect(fighterTorsoTooltip.textContent).toContain("Defence bonuses");
    expect(fighterTorsoTooltip.textContent).toContain("Other bonuses");
    expect(fighterTorsoTooltip.textContent).toContain("-1");
    expect(fighterTorsoTooltip.querySelector("[title='Stab attack']").classList.contains("negative")).toBe(true);
    expect(fighterTorsoTooltip.querySelector("[title='Magic defence']").classList.contains("neutral")).toBe(true);
    expect(fighterTorsoTooltip.querySelector("[title='Magic defence'] span").textContent).toBe("=");
    fighterTorsoTooltip.closest("article").dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 80 }));
    expect(fighterTorsoTooltip.style.left).toBe("136px");
    expect(fighterTorsoTooltip.style.top).toBe("96px");

    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")?.textContent).toBe("Equipped"));
    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
    page.remove();
  });

  it("uses subtle comparison cell backgrounds for positive, negative, and unchanged stats", () => {
    const styles = readFileSync("src/pvm-gear-planner-page/pvm-gear-planner-page.css", "utf8");
    expect(styles).toContain(
      ".pvm-gear-planner-page__item-stats-tooltip.comparison .pvm-gear-planner-page__item-stat.positive"
    );
    expect(styles).toContain("background: rgb(69 142 71 / 12%);");
    expect(styles).toContain(
      ".pvm-gear-planner-page__item-stats-tooltip.comparison .pvm-gear-planner-page__item-stat.negative"
    );
    expect(styles).toContain("background: rgb(174 65 55 / 12%);");
    expect(styles).toContain(
      ".pvm-gear-planner-page__item-stats-tooltip.comparison .pvm-gear-planner-page__item-stat.neutral"
    );
    expect(styles).toContain("background: rgb(85 79 68 / 8%);");
  });

  it("keeps item tooltip text crisp without inherited shadows or transforms", () => {
    const styles = readFileSync("src/pvm-gear-planner-page/pvm-gear-planner-page.css", "utf8");
    expect(styles).toContain(".pvm-gear-planner-page__item-stats-tooltip *");
    expect(styles).toContain("text-shadow: none !important;");
    expect(styles).not.toContain(
      ".pvm-gear-planner-page__item-stats-tooltip {\n  position: fixed;\n  top: 50vh;\n  left: 50vw;\n  z-index: 20;\n  min-width: 280px;\n  max-width: min(380px, calc(100vw - 24px));\n  overflow: hidden;\n  color: #201b14;\n  font-family: Georgia"
    );
    expect(styles).not.toContain("transform: translateY(4px)");
  });

  it("shows full item stats for paperdoll and equipped alternative items", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));

    const bodySlot = page.querySelector("[data-slot='body']");
    const paperdollTooltip = bodySlot.querySelector(".pvm-gear-planner-page__item-stats-tooltip.full");
    expect(paperdollTooltip.textContent).toContain("Bandos chestplate");
    expect(paperdollTooltip.textContent).toContain("Attack bonuses");
    expect(paperdollTooltip.textContent).toContain("Defence bonuses");
    expect(paperdollTooltip.textContent).toContain("Other bonuses");
    expect(paperdollTooltip.textContent).toContain("Body");
    expect(paperdollTooltip.querySelector("[title='Stab defence'] img").getAttribute("src")).toBe(
      "/icons/items/1277.webp"
    );

    bodySlot.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 80 }));
    expect(paperdollTooltip.style.left).toBe("136px");
    expect(paperdollTooltip.style.top).toBe("96px");

    const equippedTooltip = page
      .querySelector("[data-equip-item='11832']")
      .closest("article")
      .querySelector(".pvm-gear-planner-page__item-stats-tooltip.full");
    expect(equippedTooltip.textContent).toContain("Bandos chestplate");
    expect(equippedTooltip.textContent).not.toContain("Compared with");
    page.remove();
  });

  it("uses damage taken to rank equal-offence gear without overriding higher DPS", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));

    const bandos = page.querySelector("[data-equip-item='11832']").closest("article");
    const fighterTorso = page.querySelector("[data-equip-item='10551']").closest("article");
    expect(bandos.textContent).toContain("Damage taken/s6.00");
    expect(fighterTorso.textContent).toContain("Damage taken/s2.50");
    expect(page.querySelector(".pvm-gear-planner-page__alternative strong").textContent).toBe("Bandos chestplate");

    page.querySelector("[data-slot='head']").click();
    await vi.waitFor(() =>
      expect(
        page
          .querySelector("[data-equip-item='10828']")
          ?.closest("article")
          .querySelector(".pvm-gear-planner-page__tier")?.textContent
      ).toBe("S")
    );
    expect(
      page.querySelector("[data-equip-item='24271']").closest("article").querySelector(".pvm-gear-planner-page__tier")
        .textContent
    ).toBe("C");
    expect(page.querySelector(".pvm-gear-planner-page__alternative strong").textContent).toBe("Helm of Neitiznot");

    page.querySelector("[data-reset-style='Melee']").click();
    await vi.waitFor(() => expect(page.calculating).toBe(false), { timeout: 10000 });
    expect(page.loadouts.Melee.items.body.id).toBe(11832);
    expect(page.loadouts.Melee.items.head.id).toBe(10828);
    expect(page.querySelector(".pvm-gear-planner-page__results").textContent).toContain("Damage taken/s");
    page.remove();
  }, 15000);

  it("switches cards without overwriting independent loadout selections", async () => {
    const page = await createPage();
    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.loadouts.Melee.items.body.id).toBe(9674));

    page.querySelector("[data-style='Ranged']").click();
    expect(page.querySelector("[data-slot='body']").title).toContain("Bandos chestplate");
    page.querySelector("[data-equip-item='10551']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.body.id).toBe(10551));

    page.querySelector("[data-style='Melee']").click();
    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
    expect(page.loadouts.Ranged.items.body.id).toBe(10551);
    page.remove();
  });

  it("optimizes one style by real DPS without changing the active or other loadouts", async () => {
    const page = await createPage();
    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.loadouts.Melee.items.body.id).toBe(9674));

    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.body.id).toBe(9674));
    page.querySelector("[data-style='Melee']").click();

    page.querySelector("[data-reset-style='Ranged']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.body.id).toBe(10551));
    expect(page.activeStyle).toBe("Melee");
    expect(page.loadouts.Melee.items.body.id).toBe(9674);
    page.remove();
  });

  it("optimizes all three loadouts to each style's best DPS gear", async () => {
    const page = await createPage();
    for (const style of ["Melee", "Ranged", "Magic"]) {
      page.querySelector(`[data-style='${style}']`).click();
      page.querySelector("[data-equip-item='10551']").click();
      await vi.waitFor(() => expect(page.loadouts[style].items.body.id).toBe(10551));
    }

    page.querySelector("[data-reset-all]").click();
    expect(page.calculating).toBe(true);
    await vi.waitFor(() => expect(page.calculating).toBe(false), { timeout: 10000 });
    expect(["Melee", "Ranged", "Magic"].map((style) => page.loadouts[style].items.body.id)).toEqual([
      11832, 10551, 9674,
    ]);
    expect(requests.length).toBeLessThan(250);
    page.remove();
  }, 15000);

  it("recalculates every visible alternative after optimizing the active style", async () => {
    const page = await createPage();
    page.querySelector("[data-reset-style='Melee']").click();

    await vi.waitFor(() => expect(page.calculating).toBe(false), { timeout: 10000 });
    await waitForReadyAlternatives(page);
    expect(page.activeLoadout.candidateResults.size).toBe(page.activeCandidates().length);
    page.remove();
  }, 15000);

  it("recalculates every visible alternative after optimizing all styles", async () => {
    const page = await createPage();
    page.querySelector("[data-style='Magic']").click();
    await waitForReadyAlternatives(page);
    page.querySelector("[data-reset-all]").click();

    await vi.waitFor(() => expect(page.calculating).toBe(false), { timeout: 10000 });
    await waitForReadyAlternatives(page);
    expect(page.activeLoadout.candidateResults.size).toBe(page.activeCandidates().length);
    page.remove();
  }, 15000);

  it("keeps locked slots unchanged while optimizing the rest of a style", async () => {
    const page = await createPage();
    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.body.id).toBe(9674));

    page.querySelector("[data-lock-slot='body']").click();
    expect(page.loadouts.Ranged.lockedSlots.has("body")).toBe(true);
    page.querySelector("[data-reset-style='Ranged']").click();
    await vi.waitFor(() => expect(page.calculating).toBe(false));

    expect(page.loadouts.Ranged.items.body.id).toBe(9674);
    expect(page.querySelector("[data-lock-slot='body']").getAttribute("aria-pressed")).toBe("true");
    expect(page.querySelector("[data-lock-slot='body']").textContent).toBe("🔒");
    expect(page.querySelector("[data-slot='body']").classList.contains("slot-locked")).toBe(true);
    page.remove();
  });

  it("shows only the strongest owned family member and highest charged equivalent", async () => {
    const page = await createPage();
    page.querySelector("[data-slot='shield']").click();
    expect(page.querySelector("[data-equip-item='1201']")).not.toBeNull();
    expect(page.querySelector("[data-equip-item='1193']")).toBeNull();
    expect(page.querySelector("[data-equip-item='1197']")).toBeNull();

    page.querySelector("[data-slot='neck']").click();
    expect(page.querySelector("[data-equip-item='11978']")).not.toBeNull();
    expect(page.querySelector("[data-equip-item='1704']")).toBeNull();
    expect(page.querySelector("[data-equip-item='11105']")).toBeNull();
    page.remove();
  });

  it("shows only the strongest owned bronze-through-rune scimitar", async () => {
    const standardScimitars = [
      [1321, "Bronze scimitar", 7, 6],
      [1323, "Iron scimitar", 10, 9],
      [1325, "Steel scimitar", 15, 14],
      [1327, "Black scimitar", 19, 14],
      [1329, "Mithril scimitar", 21, 20],
      [1331, "Adamant scimitar", 29, 28],
      [1333, "Rune scimitar", 45, 44],
    ].map(([id, name, slash, strength]) => {
      const item = combatWeapon(id, name, "Slash Sword", "slash", slash);
      item.bonuses.str = strength;
      return item;
    });
    equipmentEntities.push(...standardScimitars);
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((candidate) => candidate.id),
        11832
      )
    );
    const page = await createPage(data);
    page.querySelector("[data-slot='weapon']").click();

    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='1333']")).not.toBeNull());
    for (const itemId of [1321, 1323, 1325, 1327, 1329, 1331]) {
      expect(page.querySelector(`[data-equip-item='${itemId}']`)).toBeNull();
    }
    page.remove();
  });

  it("shows only the strongest owned standard shortbow and longbow tiers", async () => {
    const standardBows = [
      [841, "Shortbow", 8, 4],
      [843, "Oak shortbow", 14, 4],
      [849, "Willow shortbow", 20, 4],
      [853, "Maple shortbow", 29, 4],
      [857, "Yew shortbow", 47, 4],
      [839, "Longbow", 8, 6],
      [845, "Oak longbow", 14, 6],
      [847, "Willow longbow", 20, 6],
      [851, "Maple longbow", 29, 6],
      [855, "Yew longbow", 47, 6],
      [859, "Magic longbow", 69, 6],
    ].map(([id, name, score, speed]) => ({ ...combatWeapon(id, name, "Bow", "ranged", score), speed }));
    equipmentEntities.push(...standardBows);
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((candidate) => candidate.id),
        11832
      )
    );
    const page = await createPage(data);
    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-slot='weapon']").click();

    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='859']")).not.toBeNull());
    expect(page.querySelector("[data-equip-item='861']")).not.toBeNull();
    for (const itemId of [839, 841, 843, 845, 847, 849, 851, 853, 855, 857]) {
      expect(page.querySelector(`[data-equip-item='${itemId}']`)).toBeNull();
    }
    page.remove();
  });

  it("prioritizes anti-fire protection and caps ordinary shields at B against dragonfire", async () => {
    const page = await createPage();
    const target = page.querySelector("[data-control='target']");
    target.value = "Vorkath (Post-quest) [8059]";
    target.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(page.selectedTarget?.id).toBe(8059));

    page.querySelector("[data-reset-style='Melee']").click();
    await vi.waitFor(() => expect(page.calculating).toBe(false), { timeout: 10000 });
    expect(page.loadouts.Melee.items.shield.id).toBe(1540);

    page.querySelector("[data-slot='shield']").click();
    let ordinaryTier;
    await vi.waitFor(() => {
      ordinaryTier = page
        .querySelector("[data-equip-item='1201']")
        ?.closest("article")
        .querySelector(".pvm-gear-planner-page__tier");
      expect(["B", "C"]).toContain(ordinaryTier?.textContent);
    });
    expect(page.querySelector("[data-equip-item='1540']").closest("article").textContent).toContain(
      "Anti-dragon shield"
    );
    page.remove();
  }, 15000);

  it("refreshes all style cards for target changes with synchronized player data", async () => {
    const page = await createPage();
    const target = page.querySelector("[data-control='target']");
    target.value = "Vorkath (Post-quest) [8059]";
    target.dispatchEvent(new Event("change"));

    await vi.waitFor(() =>
      expect(
        ["Melee", "Ranged", "Magic"].every((mode) =>
          requests.some((request) => request.monster?.id === 8059 && request.options?.mode === mode)
        )
      ).toBe(true)
    );
    const request = requests.find((candidate) => candidate.monster?.id === 8059 && candidate.options?.mode === "Melee");
    expect(request.monster.version).toBe("Post-quest");
    expect(request.player.skills.atk).toBe(99);
    expect(request.player.equipment.body).toBe(11832);
    page.remove();
  });

  it("keeps Proselyte ahead of equivalent non-prayer body armour in the default candidates", async () => {
    const proselyte = equipmentEntities.find((item) => item.id === 9674);
    const equivalentBody = (id, name) => ({
      ...equipment(id, name, "body"),
      bonuses: { ...proselyte.bonuses, prayer: 0 },
      offensive: { ...proselyte.offensive },
      defensive: { ...proselyte.defensive },
    });
    const alternatives = [
      equivalentBody(1123, "Adamant platebody"),
      ...[...extraBodyIds].map((id, index) => equivalentBody(id, `Equivalent body ${index + 1}`)),
    ];
    const proselyteIndex = equipmentEntities.findIndex((item) => item.id === 9674);
    equipmentEntities.splice(proselyteIndex, 0, ...alternatives);
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((candidate) => candidate.id),
        11832
      )
    );
    const page = await createPage(data);

    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")).not.toBeNull());
    const candidateIds = page.activeCandidates().map((candidate) => candidate.id);
    expect(candidateIds).toContain(9674);
    expect(candidateIds.indexOf(9674)).toBeLessThan(candidateIds.indexOf(1123));
    page.remove();
  });

  it("does not force an allowed Crystal bow beyond the normal weapon candidate cutoff", async () => {
    equipmentEntities.push(
      ...[...extraRangedWeaponIds].map((id, index) =>
        combatWeapon(id, `High score bow ${index + 1}`, "Bow", "ranged", 300 - index)
      )
    );
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((candidate) => candidate.id),
        11832
      )
    );
    const page = await createPage(data);
    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-slot='weapon']").click();

    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));
    expect(page.querySelector("[data-equip-item='23983']")).toBeNull();
    expect(page.activeCandidates().some((candidate) => candidate.id === 23983)).toBe(false);
    expect(page.optimizationCandidates("weapon", "Ranged").some((candidate) => candidate.id === 23983)).toBe(false);
    page.remove();
  });

  it("filters Crystal bows and caps standard ammo while preserving special ammo", async () => {
    const dragonArrow = equipmentEntities.find((item) => item.id === 11212);
    const runeArrow = equipmentEntities.find((item) => item.id === 892);
    const adamantArrow = equipmentEntities.find((item) => item.id === 890);
    const boneBolts = equipmentEntities.find((item) => item.id === 8882);
    const crystalBow = equipmentEntities.find((item) => item.id === 23983);
    expect(rangedAmmoTier(dragonArrow)).toBe("dragon");
    expect(rangedAmmoTier(runeArrow)).toBe("rune");
    expect(ammoAllowedByTier(dragonArrow, "adamant")).toBe(false);
    expect(ammoAllowedByTier(adamantArrow, "adamant")).toBe(true);
    expect(rangedAmmoTier(boneBolts)).toBeNull();
    expect(ammoAllowedByTier(boneBolts, "bronze")).toBe(true);
    expect(isCrystalBow(crystalBow)).toBe(true);

    const data = groupData();
    data.members.set(
      "Alice",
      member("Alice", [...equipmentEntities.map((item) => item.id).filter((itemId) => itemId !== 23983), 23985], 11832)
    );
    const page = await createPage(data);
    const rangedCard = page.querySelector("[data-style='Ranged']").closest("article");
    expect(
      [...rangedCard.querySelectorAll("[data-ranged-ammo-tier] option")].map((option) => [
        option.value,
        option.textContent,
      ])
    ).toEqual([
      ["all", "ALL"],
      ["dragon", "Dragon"],
      ["rune", "Rune"],
      ["adamant", "Addy"],
      ["mithril", "Mithril"],
      ["steel", "Steel"],
      ["iron", "Iron"],
      ["bronze", "Bronze"],
    ]);

    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-slot='weapon']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='23983']")).not.toBeNull());

    expect(page.loadouts.Ranged.items.weapon.id).toBe(23983);
    expect(page.loadouts.Ranged.rangedWeaponRequiresAmmo).toBe(false);
    expect(page.querySelector("[data-style='Ranged']").closest("article").textContent).toContain("Ammo: Not required");

    rangedCard.querySelector("[data-ranged-crystal-filter]").click();
    await vi.waitFor(() => {
      expect(page.rangedFilters.omitCrystalBow).toBe(true);
      expect(isCrystalBow(page.loadouts.Ranged.items.weapon)).toBe(false);
    });

    let tier = page.querySelector("[data-ranged-ammo-tier]");
    tier.value = "adamant";
    tier.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.ammo?.id).toBe(890));

    expect(page.querySelector("[data-style='Ranged']").closest("article").textContent).toContain("Ammo: Adamant arrow");

    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-slot='weapon']").click();
    await vi.waitFor(() => {
      expect(page.querySelector("[data-equip-item='23983']")).toBeNull();
      expect(page.querySelector("[data-equip-item='861']").closest("article").textContent).toContain(
        "with Adamant arrow"
      );
      expect(page.querySelector("[data-equip-item='8880']").closest("article").textContent).toContain(
        "with Bone bolts"
      );
    });
    expect(
      requests.some(
        (request) =>
          request.action === "calculate" &&
          request.options?.mode === "Ranged" &&
          request.player.equipment.weapon === 861 &&
          request.player.equipment.ammo === 890
      )
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.action === "calculate" &&
          request.options?.mode === "Ranged" &&
          request.player.equipment.weapon === 8880 &&
          request.player.equipment.ammo === 8882
      )
    ).toBe(true);
    page.remove();
  });

  it("falls back to the highest owned ammo below the selected tier", async () => {
    const data = groupData();
    const ownedIds = equipmentEntities
      .map((item) => item.id)
      .filter((id) => ![11212, 892, 890, 23983, 21012, 8880, 8882].includes(id));
    ownedIds.push(861, 882);
    data.members.set("Alice", member("Alice", ownedIds, 11832));
    const page = await createPage(data);

    const tier = page.querySelector("[data-ranged-ammo-tier]");
    tier.value = "adamant";
    tier.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.ammo?.id).toBe(882));
    expect(page.querySelector("[data-style='Ranged']").closest("article").textContent).toContain("Ammo: Bronze arrow");
    page.remove();
  });

  it("auto-selects and filters compatible ranged ammunition", async () => {
    const page = await createPage();
    page.querySelector("[data-style='Ranged']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.ammo?.id).toBe(892));
    page.querySelector("[data-slot='ammo']").click();
    expect(page.querySelector("[data-equip-item='892']")).not.toBeNull();
    expect(page.querySelector("[data-equip-item='9244']")).toBeNull();

    page.querySelector("[data-slot='weapon']").click();
    page.querySelector("[data-equip-item='21012']").click();
    await vi.waitFor(() => expect(page.loadouts.Ranged.items.ammo?.id).toBe(9244));
    page.querySelector("[data-slot='ammo']").click();
    expect(page.querySelector("[data-equip-item='892']")).toBeNull();
    expect(page.querySelector("[data-equip-item='9244']")).not.toBeNull();
    page.remove();
  });

  it("searches owned bank items and ranks a pinned out-of-bound candidate by evaluated DPS", async () => {
    const extraBodies = [...extraBodyIds].map((id, index) =>
      equipment(id, `High offence body ${index + 1}`, "body", 20 - index)
    );
    equipmentEntities.push(...extraBodies);
    const data = groupData();
    data.members.set("Alice", member("Alice", [...equipmentEntities.map((candidate) => candidate.id), 9674], 11832));
    const page = await createPage(data);
    page.querySelector("[data-style='Magic']").click();
    await waitForReadyAlternatives(page);

    expect(page.querySelector("[data-equip-item='9674']")).toBeNull();
    const search = page.querySelector("[data-bank-item-search]");
    const proselyteLabel = "Proselyte hauberk [9674]";
    expect([...page.querySelectorAll("[data-bank-item-option]")].map((option) => option.value)).toContain(
      proselyteLabel
    );
    search.value = proselyteLabel;
    page.querySelector("[data-bank-item-form]").dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() =>
      expect(
        page.querySelector("[data-equip-item='9674']")?.closest("article").querySelector(".pvm-gear-planner-page__tier")
          .textContent
      ).not.toBe("…")
    );
    expect(page.querySelector(".pvm-gear-planner-page__alternative strong").textContent).toBe("Proselyte hauberk");
    expect(page.querySelectorAll("[data-equip-item='9674']")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("pvmGearPlannerPinnedItems"))).toEqual({ "Magic:body": [9674] });

    const bandosPin = page.querySelector("[data-pin-item='11832']");
    bandosPin.click();
    await vi.waitFor(() =>
      expect(page.querySelector("[data-pin-item='11832']")?.getAttribute("aria-pressed")).toBe("true")
    );
    expect(page.querySelectorAll("[data-equip-item='11832']")).toHaveLength(1);

    page.querySelector("[data-pin-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")).toBeNull());
    page.remove();
  });

  it("persists pins by style and slot while excluding items that are no longer owned", async () => {
    localStorage.setItem("pvmGearPlannerPinnedItems", JSON.stringify({ "Magic:body": [9674], "Melee:head": [10828] }));
    const firstPage = await createPage();
    firstPage.querySelector("[data-style='Magic']").click();
    await vi.waitFor(() =>
      expect(firstPage.querySelector("[data-pin-item='9674']")?.getAttribute("aria-pressed")).toBe("true")
    );
    expect(firstPage.querySelector("[data-pin-item='10828']")).toBeNull();
    firstPage.remove();

    const data = groupData();
    data.members.set("@SHARED", member("@SHARED", [], 0));
    const secondPage = await createPage(data);
    secondPage.querySelector("[data-style='Magic']").click();
    expect(secondPage.querySelector("[data-equip-item='9674']")).toBeNull();
    secondPage.remove();
  });

  it("clears invalid pinned-item storage", async () => {
    localStorage.setItem("pvmGearPlannerPinnedItems", "not-json");
    const page = await createPage();
    expect(page.pinnedItems).toEqual({});
    expect(localStorage.getItem("pvmGearPlannerPinnedItems")).toBeNull();
    page.remove();
  });

  it("does not let a stale ranged ammo response overwrite a newer weapon selection", async () => {
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((candidate) => candidate.id),
        11832
      )
    );
    const page = await createPage(data);
    page.querySelector("[data-style='Ranged']").click();
    page.querySelector("[data-slot='weapon']").click();
    await waitForReadyAlternatives(page);

    let release;
    try {
      delayedAmmoWeaponId = 21012;
      page.querySelector("[data-equip-item='21012']").click();
      await vi.waitFor(() => expect(releaseDelayedAmmo).toBeTypeOf("function"));
      release = releaseDelayedAmmo;
      page.querySelector("[data-equip-item='8880']").click();
      await vi.waitFor(() => {
        expect(page.loadouts.Ranged.items.weapon.id).toBe(8880);
        expect(page.loadouts.Ranged.items.ammo.id).toBe(8882);
        expect(page.calculating).toBe(false);
      });

      release();
      release = null;
      await vi.waitFor(() => {
        expect(page.loadouts.Ranged.items.weapon.id).toBe(8880);
        expect(page.loadouts.Ranged.items.ammo.id).toBe(8882);
      });
      await waitForReadyAlternatives(page);
    } finally {
      release?.();
      page.remove();
    }
  });

  it("restores the most recently selected Ranged and Magic filters", async () => {
    const data = groupData();
    data.members.set(
      "Alice",
      member(
        "Alice",
        equipmentEntities.map((item) => item.id),
        11832
      )
    );
    const firstPage = await createPage(data);
    firstPage.querySelector("[data-ranged-crystal-filter]").click();
    const tier = firstPage.querySelector("[data-ranged-ammo-tier]");
    tier.value = "adamant";
    tier.dispatchEvent(new Event("change"));
    firstPage.querySelector("[data-rune-restriction='wrath']").click();
    firstPage.querySelector("[data-rune-restriction='blood']").click();
    await vi.waitFor(() => expect(firstPage.calculating).toBe(false));

    expect(JSON.parse(localStorage.getItem("pvmGearPlannerFilters"))).toEqual({
      ranged: { omitCrystalBow: true, ammoTier: "adamant" },
      magic: { wrath: true, death: false, blood: true },
    });
    firstPage.remove();

    const restoredPage = await createPage(data);
    expect(restoredPage.rangedFilters).toEqual({ omitCrystalBow: true, ammoTier: "adamant" });
    expect(restoredPage.runeRestrictions).toEqual({ wrath: true, death: false, blood: true });
    expect(restoredPage.querySelector("[data-ranged-ammo-tier]").value).toBe("adamant");
    expect(restoredPage.querySelector("[data-ranged-crystal-filter]").getAttribute("aria-pressed")).toBe("true");
    expect(restoredPage.querySelector("[data-rune-restriction='wrath']").getAttribute("aria-pressed")).toBe("true");
    expect(restoredPage.querySelector("[data-rune-restriction='death']").getAttribute("aria-pressed")).toBe("false");
    expect(restoredPage.querySelector("[data-rune-restriction='blood']").getAttribute("aria-pressed")).toBe("true");
    restoredPage.remove();
  });

  it("falls back to default filters when stored filter data is invalid", async () => {
    localStorage.setItem("pvmGearPlannerFilters", "not-json");
    const page = await createPage();
    expect(page.rangedFilters).toEqual({ omitCrystalBow: false, ammoTier: "all" });
    expect(page.runeRestrictions).toEqual({ wrath: false, death: false, blood: false });
    expect(localStorage.getItem("pvmGearPlannerFilters")).toBeNull();
    page.remove();
  });

  it("renders rune restriction icons inside the Magic loadout card", async () => {
    const page = await createPage();
    const magicCard = page.querySelector("[data-style='Magic']").closest("article");
    const runeControls = magicCard.querySelector(".pvm-gear-planner-page__rune-restrictions");

    expect(runeControls).not.toBeNull();
    expect(page.querySelectorAll(".pvm-gear-planner-page__rune-restrictions")).toHaveLength(1);
    expect(
      [...runeControls.querySelectorAll("[data-rune-restriction]")].map((control) => control.dataset.runeRestriction)
    ).toEqual(["wrath", "blood", "death"]);
    expect(runeControls.querySelector("[data-rune-restriction='wrath'] img").getAttribute("src")).toBe(
      "/icons/items/21880.webp"
    );
    expect(runeControls.querySelector("[data-rune-restriction='death'] img").getAttribute("src")).toBe(
      "/icons/items/560.webp"
    );
    expect(runeControls.querySelector("[data-rune-restriction='blood'] img").getAttribute("src")).toBe(
      "/icons/items/565.webp"
    );

    const wrath = runeControls.querySelector("[data-rune-restriction='wrath']");
    expect(wrath.classList.contains("restricted")).toBe(false);
    expect(wrath.getAttribute("aria-pressed")).toBe("false");
    wrath.click();
    await vi.waitFor(() => {
      const updated = page.querySelector("[data-rune-restriction='wrath']");
      expect(updated.classList.contains("restricted")).toBe(true);
      expect(updated.getAttribute("aria-pressed")).toBe("true");
      expect(updated.getAttribute("aria-label")).toContain("Allow spells using Wrath runes");
    });
    page.remove();
  });

  it("only calculates and shows spells the selected member can cast", async () => {
    expect(spellMagicLevelRequirement("Saradomin Strike")).toBe(60);
    expect(spellMagicLevelRequirement("Dark Demonbane")).toBe(82);
    expect(spellMagicLevelRequirement("Ice Barrage")).toBe(94);
    expect(spellMagicLevelRequirement("Fire Surge")).toBe(95);

    const data = groupData();
    data.members.get("Alice").skills.Magic.level = 60;
    const page = await createPage(data);
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Saradomin Strike"));

    const requestedSpells = new Set(
      requests.filter((request) => request.options?.mode === "Magic").map((request) => request.options.spell)
    );
    expect(requestedSpells).toEqual(new Set(["Saradomin Strike", "Ghostly Grasp"]));

    page.querySelector("[data-style='Magic']").click();
    expect(
      [...page.querySelectorAll(".pvm-gear-planner-page__spell-result strong")].map((node) => node.textContent)
    ).toEqual(["Saradomin Strike", "Ghostly Grasp"]);
    page.remove();
  });

  it("chooses the best magic spell by mocked DPS rather than max hit", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Fire Surge"));
    expect(page.loadouts.Magic.currentResult.maxHit).toBe(20);
    expect(page.querySelector("[data-style='Magic']").textContent).toContain("Fire Surge");
    expect(page.querySelector("[data-control='spell']")).toBeNull();

    page.querySelector("[data-style='Magic']").click();
    expect(page.querySelector(".pvm-gear-planner-page__selected-spell").textContent).toContain("Fire Surge");
    const spellResults = [...page.querySelectorAll(".pvm-gear-planner-page__spell-result")];
    expect(spellResults).toHaveLength(5);
    expect(spellResults.map((result) => result.querySelector("strong").textContent)).toEqual([
      "Fire Surge",
      "Saradomin Strike",
      "Ice Barrage",
      "Ghostly Grasp",
      "Dark Demonbane",
    ]);
    expect(
      [...page.querySelectorAll(".pvm-gear-planner-page__spell-group h3")].map((heading) => heading.textContent)
    ).toEqual(["Standard: Fire", "Standard: Other", "Ancient", "Arceuus"]);
    expect(spellResults[0].classList.contains("selected")).toBe(true);
    expect(spellResults[0].textContent).toContain("11.00 DPS");
    expect(spellResults[0].querySelector("img").getAttribute("src")).toBe(
      "https://oldschool.runescape.wiki/images/Fire_Surge.png"
    );
    page.remove();
  });

  it("scales spell DPS comparison colors by distance from the selected spell", async () => {
    expect(spellDpsComparison(12, 10)).toMatchObject({ direction: "higher", percentage: 20 });
    expect(spellDpsComparison(8, 10)).toMatchObject({ direction: "lower", percentage: -20 });
    expect(spellDpsComparison(10, 10)).toMatchObject({ direction: "equal", percentage: 0 });
    expect(spellDpsComparison(5, 10).lightness).toBeGreaterThan(spellDpsComparison(9, 10).lightness);

    const page = await createPage();
    page.querySelector("[data-style='Magic']").click();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Fire Surge"));
    const rows = [...page.querySelectorAll(".pvm-gear-planner-page__spell-result")];
    const selectedDps = rows.find((row) => row.querySelector("strong").textContent === "Fire Surge").querySelector("b");
    const closeDps = rows.find((row) => row.querySelector("strong").textContent === "Ice Barrage").querySelector("b");
    const distantDps = rows
      .find((row) => row.querySelector("strong").textContent === "Dark Demonbane")
      .querySelector("b");

    expect(selectedDps.classList.contains("equal")).toBe(true);
    expect(closeDps.classList.contains("lower")).toBe(true);
    expect(closeDps.title).toContain("lower than selected");
    expect(distantDps.classList.contains("lower")).toBe(true);
    expect(Number.parseFloat(distantDps.style.getPropertyValue("--dps-lightness"))).toBeGreaterThan(
      Number.parseFloat(closeDps.style.getPropertyValue("--dps-lightness"))
    );
    page.remove();
  });

  it("hides and restores the Magic spell rows without recalculating", async () => {
    const page = await createPage();
    page.querySelector("[data-style='Magic']").click();
    await vi.waitFor(() =>
      expect(page.querySelectorAll(".pvm-gear-planner-page__spell-result").length).toBeGreaterThan(0)
    );
    const requestCount = requests.length;

    let toggle = page.querySelector("[data-toggle-spells]");
    expect(toggle.textContent).toContain("Hide spells");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();

    expect(page.querySelector(".pvm-gear-planner-page__spell-groups")).toBeNull();
    toggle = page.querySelector("[data-toggle-spells]");
    expect(toggle.textContent).toContain("Show spells");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(requests).toHaveLength(requestCount);

    toggle.click();
    expect(page.querySelectorAll(".pvm-gear-planner-page__spell-result").length).toBeGreaterThan(0);
    expect(page.querySelector("[data-toggle-spells]").getAttribute("aria-expanded")).toBe("true");
    expect(requests).toHaveLength(requestCount);
    page.remove();
  });

  it("shows the target weakness and highlights matching compact spell rows", async () => {
    const page = await createPage();
    const target = page.querySelector("[data-control='target']");
    target.value = "Vorkath (Post-quest) [8059]";
    target.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(page.selectedTarget?.id).toBe(8059));

    page.querySelector("[data-style='Magic']").click();
    await vi.waitFor(() => {
      expect(page.querySelector("[data-target-weakness]").textContent).toContain("Fire +40%");
    });
    const fireSurge = [...page.querySelectorAll(".pvm-gear-planner-page__spell-result")].find(
      (row) => row.querySelector("strong").textContent === "Fire Surge"
    );
    const iceBarrage = [...page.querySelectorAll(".pvm-gear-planner-page__spell-result")].find(
      (row) => row.querySelector("strong").textContent === "Ice Barrage"
    );
    expect(fireSurge.classList.contains("weakness-match")).toBe(true);
    expect(fireSurge.querySelector(".pvm-gear-planner-page__spell-badge.weakness").textContent).toBe("Weak +40%");
    expect(iceBarrage.classList.contains("weakness-match")).toBe(false);
    expect(page.querySelectorAll(".pvm-gear-planner-page__spell-result")).toHaveLength(5);
    expect(page.querySelector(".pvm-gear-planner-page__spell-results").textContent).not.toContain("Available");

    target.value = "Abyssal demon (Standard) [415]";
    target.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(page.selectedTarget?.id).toBe(415);
      expect(page.querySelector("[data-target-weakness]").textContent).toContain("No elemental weakness");
      expect(page.querySelectorAll(".pvm-gear-planner-page__spell-result.weakness-match")).toHaveLength(0);
    });
    page.remove();
  });

  it("excludes rune-tagged spell requests and falls back to an unaffected spell", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Fire Surge"));
    requests.length = 0;

    page.querySelector("[data-rune-restriction='wrath']").click();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Ice Barrage"));
    expect(
      [...page.querySelectorAll(".pvm-gear-planner-page__spell-result strong")].map((node) => node.textContent)
    ).not.toContain("Fire Surge");
    expect(
      requests
        .filter((request) => request.options?.mode === "Magic")
        .some((request) => request.options.spell === "Fire Surge")
    ).toBe(false);

    requests.length = 0;
    page.querySelector("[data-rune-restriction='death']").click();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Saradomin Strike"));
    expect(
      requests
        .filter((request) => request.options?.mode === "Magic")
        .some((request) => request.options.spell === "Ice Barrage")
    ).toBe(false);

    requests.length = 0;
    page.querySelector("[data-rune-restriction='blood']").click();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Ghostly Grasp"));
    const requestedSpells = requests
      .filter((request) => request.options?.mode === "Magic")
      .map((request) => request.options.spell);
    expect(requestedSpells).toContain("Ghostly Grasp");
    expect(requestedSpells).not.toContain("Saradomin Strike");
    page.remove();
  });

  it("restores the most recently selected target", async () => {
    const firstPage = await createPage();
    const target = firstPage.querySelector("[data-control='target']");
    target.value = "Vorkath (Post-quest) [8059]";
    target.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(firstPage.selectedTarget?.id).toBe(8059));
    expect(localStorage.getItem("pvmGearPlannerSelectedTarget")).toBe("8059:Post-quest");
    firstPage.remove();

    const restoredPage = await createPage();
    expect(restoredPage.selectedTarget?.id).toBe(8059);
    expect(restoredPage.querySelector("[data-control='target']").value).toBe("Vorkath (Post-quest) [8059]");
    restoredPage.remove();
  });

  it("falls back to the default target when the stored target is unavailable", async () => {
    localStorage.setItem("pvmGearPlannerSelectedTarget", "999999:Removed");
    const page = await createPage();
    expect(page.selectedTarget?.id).toBe(5779);
    expect(page.querySelector("[data-control='target']").value).toBe("Giant Mole [5779]");
    expect(localStorage.getItem("pvmGearPlannerSelectedTarget")).toBeNull();
    page.remove();
  });

  it("restores the most recently selected member", async () => {
    const firstPage = await createPage();
    const player = firstPage.querySelector("[data-control='member']");
    player.value = "Bob";
    player.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(firstPage.selectedMember).toBe("Bob"));
    expect(localStorage.getItem("pvmGearPlannerSelectedMember")).toBe("Bob");
    firstPage.remove();

    const restoredPage = await createPage();
    expect(restoredPage.querySelector("[data-control='member']").value).toBe("Bob");
    restoredPage.remove();
  });

  it("preserves a manual gear choice across unchanged polling updates", async () => {
    const page = await createPage();
    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk"));
    await vi.waitFor(() => expect(page.calculating).toBe(false));
    const requestCount = requests.length;

    pubsub.publish("get-group-data", groupData());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
    expect(requests).toHaveLength(requestCount);
    page.remove();
  });

  it("exposes every authoritative target through search suggestions", async () => {
    const page = await createPage();
    expect(page.querySelectorAll("header datalist option")).toHaveLength(monsterEntities.length);
    expect(page.querySelector("[data-control='target']").value).toBe("Giant Mole [5779]");
    page.remove();
  });

  it("reinitializes to the newly selected member's real equipment", async () => {
    const page = await createPage();
    const player = page.querySelector("[data-control='member']");
    player.value = "Bob";
    player.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(page.querySelector("[data-slot='body']").title).toContain("Fighter torso"));
    expect(page.querySelector("[data-equip-item='11832']")).toBeNull();
    page.remove();
  });
});
