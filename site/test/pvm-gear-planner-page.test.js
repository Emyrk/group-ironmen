import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pubsub } from "../src/data/pubsub";

const requests = [];

function equipment(id, name, slot, score = 0) {
  return {
    id,
    name,
    slot,
    version: "",
    weight: 1,
    speed: slot === "weapon" ? 4 : 0,
    isTwoHanded: false,
    bonuses: { str: score, ranged_str: 0, magic_str: 0, prayer: score },
    offensive: { stab: score, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defensive: { stab: score, slash: score, crush: score, magic: 0, ranged: 0 },
  };
}

const equipmentEntities = [
  equipment(10828, "Helm of Neitiznot", "head", 2),
  equipment(24271, "Neitiznot faceguard", "head", 4),
  equipment(6570, "Fire cape", "cape", 2),
  equipment(6585, "Amulet of fury", "neck", 2),
  equipment(9244, "Dragon bolts (e)", "ammo", 2),
  equipment(4151, "Abyssal whip", "weapon", 4),
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
      const bodyId = request.player.equipment.body;
      const targetModifier = request.monster.id === 8059 ? -1 : 0;
      const styleModifier = request.options.style === "Aggressive" ? 0.5 : 0;
      const dps = 5 + (bodyId === 11832 ? 3 : bodyId === 10551 ? 2 : 1) + targetModifier + styleModifier;
      return {
        version: 1,
        requestId: request.requestId,
        result: {
          dps,
          accuracy: 0.75,
          maxHit: 32,
          attackSpeed: 4,
          expectedTtk: request.monster.id === 8059 ? 100 : 25,
        },
      };
    }),
  };
});

const { PvmGearPlannerPage } = await import("../src/pvm-gear-planner-page/pvm-gear-planner-page");

PvmGearPlannerPage.prototype.html = function () {
  return `
    <header>
      <select data-control="member">${this.renderMemberOptions()}</select>
      <input data-control="target" value="${this.renderSelectedTargetLabel()}" />
      <datalist>${this.renderTargetOptions()}</datalist>
      <select data-control="style">${this.renderStyleOptions()}</select>
    </header>
    ${this.renderStatus()}
    <section class="pvm-gear-planner-page__results">${this.renderResults()}</section>
    <section class="pvm-gear-planner-page__paperdoll">${this.renderPaperdoll()}</section>
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
  };
}

function groupData() {
  return {
    members: new Map([
      [
        "Alice",
        member(
          "Alice",
          [10828, 24271, 6570, 6585, 9244, 4151, 11832, 10551, 9674, 8850, 11834, 7462, 11840, 6737],
          11832
        ),
      ],
      ["Bob", member("Bob", [10828, 6570, 6585, 4151, 10551, 11834, 7462, 11840, 6737], 10551)],
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
    document.body.innerHTML = "";
    window.history.replaceState("", "", "/group/pvm-gear");
  });

  it("registers the authenticated page and navigation entry", () => {
    const index = readFileSync("src/index.html", "utf8");
    const navigation = readFileSync("src/app-navigation/app-navigation.html", "utf8");
    const components = JSON.parse(readFileSync("components.json", "utf8"));

    expect(index).toContain('route-path="/pvm-gear"');
    expect(index).toContain('route-component="pvm-gear-planner-page"');
    expect(navigation).toContain('link-href="/group/pvm-gear"');
    expect(components).toContain("pvm-gear-planner-page");
    expect(customElements.get("pvm-gear-planner-page")).toBe(PvmGearPlannerPage);
  });

  it("initializes all slots from real equipped items and owned defaults", async () => {
    const page = await createPage();

    expect(page.querySelector("[data-control='member']").value).toBe("Alice");
    expect(page.querySelectorAll(".pvm-gear-planner-page__paperdoll-slot")).toHaveLength(11);
    expect(page.querySelector("[data-slot='body']").title).toContain("Bandos chestplate");
    expect(page.querySelector("[data-slot='head']").title).toContain("Neitiznot faceguard");
    expect(page.textContent).toContain("Top owned candidates ranked by real DPS");
    expect(page.textContent).not.toContain("UI prototype");
    page.remove();
  });

  it("ranks owned alternatives by calculator DPS and equips a selection", async () => {
    const page = await createPage();
    await vi.waitFor(() => expect(page.querySelector(".pvm-gear-planner-page__tier")?.textContent).not.toBe("…"));

    const alternatives = [...page.querySelectorAll(".pvm-gear-planner-page__alternative strong")].map(
      (node) => node.textContent
    );
    expect(alternatives[0]).toBe("Bandos chestplate");

    page.querySelector("[data-equip-item='9674']").click();
    await vi.waitFor(() => expect(page.querySelector("[data-equip-item='9674']")?.textContent).toBe("Equipped"));
    expect(page.querySelector("[data-slot='body']").title).toContain("Proselyte hauberk");
    page.remove();
  });

  it("sends synchronized skills, target version, equipment IDs, and attack style", async () => {
    const page = await createPage();
    const target = page.querySelector("[data-control='target']");
    target.value = "Vorkath (Post-quest) [8059]";
    target.dispatchEvent(new Event("change"));
    const style = page.querySelector("[data-control='style']");
    style.value = "Aggressive";
    style.dispatchEvent(new Event("change"));

    await vi.waitFor(() =>
      expect(requests.some((request) => request.monster.id === 8059 && request.options.style === "Aggressive")).toBe(
        true
      )
    );
    const request = requests.find(
      (candidate) => candidate.monster.id === 8059 && candidate.options.style === "Aggressive"
    );
    expect(request.monster.version).toBe("Post-quest");
    expect(request.player.skills.atk).toBe(99);
    expect(request.player.equipment.body).toBe(11832);
    page.remove();
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
