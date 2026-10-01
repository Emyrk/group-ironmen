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

const equipmentEntities = [
  equipment(10828, "Helm of Neitiznot", "head", 2),
  equipment(24271, "Neitiznot faceguard", "head", 4),
  equipment(6570, "Fire cape", "cape", 2),
  equipment(6585, "Amulet of fury", "neck", 2),
  equipment(9244, "Dragon bolts (e)", "ammo", 2),
  equipment(892, "Rune arrow", "ammo", 3),
  combatWeapon(4151, "Abyssal whip", "Whip", "slash"),
  combatWeapon(861, "Magic shortbow", "Bow", "ranged", 100),
  combatWeapon(21012, "Dragon hunter crossbow", "Crossbow", "ranged"),
  combatWeapon(27665, "Accursed sceptre", "Powered Staff", "magic"),
  equipment(11832, "Bandos chestplate", "body", 4),
  equipment(10551, "Fighter torso", "body", 3),
  equipment(9674, "Proselyte hauberk", "body", 1),
  equipment(8850, "Rune defender", "shield", 2),
  equipment(11834, "Bandos tassets", "legs", 3),
  equipment(7462, "Barrows gloves", "hands", 2),
  equipment(11840, "Dragon boots", "feet", 2),
  equipment(6737, "Berserker ring", "ring", 2),
];
const monsterEntities = [
  { id: 5779, name: "Giant Mole", version: "", skills: { hp: 200 } },
  { id: 8059, name: "Vorkath", version: "Post-quest", skills: { hp: 750 } },
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
      const gearDps = bodyId === 11832 ? 3 : bodyId === 10551 ? 2 : 1;
      const dps =
        request.options.mode === "Magic" ? spellDps[request.options.spell] + gearDps : 5 + gearDps + modeModifier;
      return {
        version: 1,
        requestId: request.requestId,
        result: {
          dps: dps + targetModifier,
          accuracy: 0.75,
          maxHit: request.options.spell === "Fire Surge" ? 20 : 32,
          attackSpeed: 4,
          expectedTtk: request.monster.id === 8059 ? 100 : 25,
        },
      };
    }),
  };
});

const { PvmGearPlannerPage, spellRuneTags } = await import("../src/pvm-gear-planner-page/pvm-gear-planner-page");

PvmGearPlannerPage.prototype.html = function () {
  return `
    <header>
      <select data-control="member">${this.renderMemberOptions()}</select>
      <input data-control="target" value="${this.renderSelectedTargetLabel()}" />
      <datalist>${this.renderTargetOptions()}</datalist>
    </header>
    <section class="pvm-gear-planner-page__style-picker">${this.renderStyleCards()}</section>
    <div class="pvm-gear-planner-page__rune-restrictions">${this.renderRuneRestrictions()}</div>
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
          [10828, 24271, 6570, 6585, 892, 9244, 4151, 861, 21012, 27665, 11832, 10551, 8850, 11834, 7462, 11840, 6737],
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
    expect(plannerTemplate).toContain('class="pvm-gear-planner-page__rune-restrictions"');
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

  it("ranks owned alternatives by calculator DPS and equips a selection", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));

    const alternatives = [...page.querySelectorAll(".pvm-gear-planner-page__alternative strong")].map(
      (node) => node.textContent
    );
    expect(alternatives[0]).toBe("Bandos chestplate");
    expect(page.querySelector("[data-equip-item='9674']").closest("article").textContent).toContain("Shared storage");

    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")?.textContent).toBe("Equipped"));
    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
    page.remove();
  });

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
