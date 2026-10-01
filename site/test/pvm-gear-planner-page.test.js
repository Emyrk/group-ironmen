import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pubsub } from "../src/data/pubsub";

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
  rangedAmmo(9244, "Dragon bolts (e)", 117),
  rangedAmmo(892, "Rune arrow", 49),
  equipment(20220, "Holy blessing", "ammo", 1),
  combatWeapon(4151, "Abyssal whip", "Whip", "slash"),
  combatWeapon(861, "Magic shortbow", "Bow", "ranged", 100),
  combatWeapon(21012, "Dragon hunter crossbow", "Crossbow", "ranged"),
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
  { id: 5779, name: "Giant Mole", version: "", style: ["Crush"], skills: { hp: 200 } },
  {
    id: 8059,
    name: "Vorkath",
    version: "Post-quest",
    style: ["Slash", "Magic", "Ranged", "Dragonfire"],
    attributes: ["dragon"],
    skills: { hp: 750 },
  },
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
      { name: "Fire Surge", spellbook: "standard", max_hit: 24 },
      { name: "Ice Barrage", spellbook: "ancient", max_hit: 30 },
      { name: "Dark Demonbane", spellbook: "arceuus", max_hit: 30 },
      { name: "Saradomin Strike", spellbook: "standard", max_hit: 20 },
      { name: "Ghostly Grasp", spellbook: "arceuus", max_hit: 12 },
      { name: "Bind", spellbook: "standard", max_hit: 0 },
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
        const ammoIds =
          request.player.equipment.weapon === 861 ? [892] : request.player.equipment.weapon === 21012 ? [9244] : [];
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
  ammoSupportsStyle,
  itemFamilyKey,
  itemHasCombatStats,
  itemStatChanges,
  preferCandidateOnTie,
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

async function createPage() {
  const page = document.createElement("pvm-gear-planner-page");
  document.body.appendChild(page);
  pubsub.publish("get-group-data", groupData());
  await vi.waitFor(() =>
    expect(page.querySelector(".pvm-gear-planner-page__results strong")?.textContent).not.toBe("…")
  );
  return page;
}

describe("pvm-gear-planner-page", () => {
  beforeEach(() => {
    requests.length = 0;
    localStorage.clear();
    document.body.innerHTML = "";
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
      .querySelector(".pvm-gear-planner-page__comparison-tooltip");
    expect(fighterTorsoTooltip.textContent).toContain("Compared with Bandos chestplate");
    expect(fighterTorsoTooltip.textContent).toContain("-1 stab attack");
    expect(fighterTorsoTooltip.textContent).toContain("-1 Prayer");
    expect(fighterTorsoTooltip.textContent).not.toContain("magic defence");
    fighterTorsoTooltip.closest("article").dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 80 }));
    expect(fighterTorsoTooltip.style.left).toBe("136px");
    expect(fighterTorsoTooltip.style.top).toBe("96px");

    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")?.textContent).toBe("Equipped"));
    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
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

  it("chooses the best magic spell by mocked DPS rather than max hit", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Fire Surge"));
    expect(page.loadouts.Magic.currentResult.maxHit).toBe(20);
    expect(page.querySelector("[data-style='Magic']").textContent).toContain("Fire Surge");
    expect(page.querySelector("[data-control='spell']")).toBeNull();

    page.querySelector("[data-style='Magic']").click();
    expect(page.querySelector(".pvm-gear-planner-page__selected-spell").textContent).toContain("Fire Surge");
    page.remove();
  });

  it("excludes rune-tagged spell requests and falls back to an unaffected spell", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Fire Surge"));
    requests.length = 0;

    page.querySelector("[data-rune-restriction='wrath']").click();
    await vi.waitFor(() => expect(page.loadouts.Magic.selectedSpell).toBe("Ice Barrage"));
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
    expect(page.querySelectorAll("datalist option")).toHaveLength(monsterEntities.length);
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
