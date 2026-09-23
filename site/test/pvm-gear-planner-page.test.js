import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { pubsub } from "../src/data/pubsub";
import { calculatePreview, PvmGearPlannerPage } from "../src/pvm-gear-planner-page/pvm-gear-planner-page";

PvmGearPlannerPage.prototype.html = function () {
  return `
    <header>
      <select data-control="member">${this.renderMemberOptions()}</select>
      <select data-control="target">${this.renderTargetOptions()}</select>
    </header>
    <section class="pvm-gear-planner-page__results">${this.renderResults()}</section>
    <section class="pvm-gear-planner-page__slots">${this.renderSlots()}</section>
    <section>
      <h2>${this.activeSlot === "body" ? "Body" : this.activeSlot} options</h2>
      <div class="pvm-gear-planner-page__alternatives">${this.renderAlternatives()}</div>
    </section>`;
};

function member(name, ownedItemIds) {
  const owned = new Set(ownedItemIds);
  return {
    name,
    totalItemQuantity(itemId) {
      return owned.has(itemId) ? 1 : 0;
    },
  };
}

function groupData() {
  return {
    members: new Map([
      ["Alice", member("Alice", [10828, 11832, 10551, 9674, 11834, 9676])],
      ["Bob", member("Bob", [24271, 10551, 9674, 9676])],
    ]),
  };
}

function createPage() {
  const page = document.createElement("pvm-gear-planner-page");
  document.body.appendChild(page);
  pubsub.publish("get-group-data", groupData());
  return page;
}

describe("pvm-gear-planner-page", () => {
  beforeEach(() => {
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

  it("renders owned contextual alternatives and chooses an available item", () => {
    const page = createPage();

    expect(page.querySelector("[data-control='member']").value).toBe("Alice");
    expect(page.textContent).toContain("Body options");
    expect(page.textContent).toContain("Bandos chestplate");
    expect(page.textContent).toContain("Not found on selected member");

    const initialDps = page.querySelector(".pvm-gear-planner-page__results strong").textContent;
    page.querySelector("[data-equip-item='9674']").click();

    expect(page.querySelector("[data-equip-item='9674']").textContent).toBe("Equipped");
    expect(page.querySelector(".pvm-gear-planner-page__results strong").textContent).not.toBe(initialDps);
    page.remove();
  });

  it("recalculates live when the target or member changes", () => {
    const page = createPage();
    const initialDps = page.querySelector(".pvm-gear-planner-page__results strong").textContent;

    const target = page.querySelector("[data-control='target']");
    target.value = "vorkath";
    target.dispatchEvent(new Event("change"));
    expect(page.querySelector(".pvm-gear-planner-page__results strong").textContent).not.toBe(initialDps);

    const player = page.querySelector("[data-control='member']");
    player.value = "Bob";
    player.dispatchEvent(new Event("change"));
    expect(page.querySelector("[data-control='member']").value).toBe("Bob");
    expect(page.querySelector("[data-equip-item='11832']").disabled).toBe(true);
    page.remove();
  });

  it("calculates target-specific preview outputs as a pure function", () => {
    const loadout = {
      head: { offense: 3, prayer: 3, defence: 45, weight: 2.7, risk: 50000 },
      body: { offense: 4, prayer: 1, defence: 117, weight: 12, risk: 30000000 },
      legs: { offense: 2, prayer: 1, defence: 71, weight: 8, risk: 20000000 },
    };

    const mole = calculatePreview(loadout, "giant-mole");
    const vorkath = calculatePreview(loadout, "vorkath");
    expect(mole.dps).toBeGreaterThan(vorkath.dps);
    expect(mole.prayer).toBe(5);
    expect(mole.defence).toBe(233);
  });
});
