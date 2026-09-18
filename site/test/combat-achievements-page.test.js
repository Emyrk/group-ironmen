import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { pubsub } from "../src/data/pubsub";
import { CombatAchievementsPage } from "../src/combat-achievements-page/combat-achievements-page";

CombatAchievementsPage.prototype.html = function () {
  return `<header>${this.renderHeader()}</header><main>${this.renderContent()}</main>`;
};

const data = {
  tier: "Medium",
  rewardPoints: 169,
  pointsPerTask: 2,
  characters: ["Alice", "Bob"],
  selectedCharacter: "Alice",
  externalPoints: 41,
  tasks: [
    {
      id: "barrows-champion",
      monster: "Barrows",
      name: "Barrows Champion",
      description: "Open the Barrows chest 25 times.",
      type: "Kill Count",
      points: 2,
      completionPercent: 59.6,
      wikiUrl: "https://oldschool.runescape.wiki/w/Barrows_Champion",
      status: "completed",
      notes: "Done",
    },
    {
      id: "pray-for-success",
      monster: "Barrows",
      name: "Pray for Success",
      description: "Take no damage from the brothers.",
      type: "Perfection",
      points: 2,
      completionPercent: 55.6,
      wikiUrl: "https://oldschool.runescape.wiki/w/Pray_for_Success",
      status: "planned",
      notes: "Use freezes",
    },
    {
      id: "giant-mole-champion",
      monster: "Giant Mole",
      name: "Giant Mole Champion",
      description: "Kill the Giant Mole 25 times.",
      type: "Kill Count",
      points: 2,
      completionPercent: 40.4,
      wikiUrl: "https://oldschool.runescape.wiki/w/Giant_Mole_Champion",
      status: "unplanned",
      notes: "",
    },
  ],
};

function createPage() {
  const page = document.createElement("combat-achievements-page");
  document.body.appendChild(page);
  return page;
}

describe("combat-achievements-page", () => {
  beforeEach(() => localStorage.clear());

  it("is registered on the authenticated combat achievements route", () => {
    const html = readFileSync("src/index.html", "utf8");
    expect(html).toContain('route-path="/combat-achievements"');
    expect(html).toContain('route-component="combat-achievements-page"');
    const components = JSON.parse(readFileSync("components.json", "utf8"));
    expect(components).toContain("combat-achievements-page");
    expect(customElements.get("combat-achievements-page")).toBe(CombatAchievementsPage);
  });

  it("calculates earned and planned points and suggests common tasks first", async () => {
    vi.spyOn(api, "getMediumCombatAchievements").mockResolvedValue(data);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(3));

    expect(page.textContent).toContain("43/ 169 points earned");
    expect(page.textContent).toContain("45points with planned tasks");
    expect(page.textContent).toContain("63more Medium tasks needed");
    expect([...page.querySelectorAll(".combat-achievements-page__task h2")].map((node) => node.textContent)).toEqual([
      "Pray for Success",
      "Giant Mole Champion",
      "Barrows Champion",
    ]);
    page.remove();
  });

  it("filters tasks and persists status, notes, external points, and character selection", async () => {
    const get = vi.spyOn(api, "getMediumCombatAchievements").mockResolvedValue(data);
    const updateTask = vi.spyOn(api, "updateMediumCombatAchievement").mockResolvedValue(data);
    const updatePoints = vi.spyOn(api, "updateMediumCombatAchievementPoints").mockResolvedValue(data);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(3));

    const monster = page.querySelector('[data-filter="monster"]');
    monster.value = "Giant Mole";
    monster.dispatchEvent(new Event("input"));
    expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(1);

    monster.value = "";
    monster.dispatchEvent(new Event("input"));
    const row = page.querySelector('[data-task-id="giant-mole-champion"]');
    row.querySelector(".combat-achievements-page__task-status").value = "planned";
    row.querySelector(".combat-achievements-page__notes").value = "Bring stamina";
    row.querySelector(".combat-achievements-page__save-notes").click();
    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith("Alice", "giant-mole-champion", "planned", "Bring stamina")
    );

    const points = page.querySelector(".combat-achievements-page__external-points");
    points.value = "50";
    points.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(updatePoints).toHaveBeenCalledWith("Alice", 50));

    const character = page.querySelector(".combat-achievements-page__character");
    character.value = "Bob";
    character.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(get).toHaveBeenLastCalledWith("Bob"));
    page.remove();
  });

  it("renders synchronized completion separately without overwriting manual plans", async () => {
    const syncedData = {
      ...data,
      syncedSnapshot: { clientRevision: 123, updatedAt: "2026-09-18T12:00:00Z" },
      tasks: data.tasks.map((task) =>
        task.id === "pray-for-success" ? { ...task, syncedComplete: true } : { ...task, syncedComplete: false }
      ),
    };
    vi.spyOn(api, "getMediumCombatAchievements").mockResolvedValue(syncedData);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".combat-achievements-page__synced")).not.toBeNull());

    const row = page.querySelector('[data-task-id="pray-for-success"]');
    expect(row.classList.contains("completed")).toBe(true);
    expect(row.querySelector(".combat-achievements-page__task-status").value).toBe("planned");
    expect(row.querySelector(".combat-achievements-page__notes").value).toBe("Use freezes");
    expect(page.summary()).toMatchObject({ completed: 2, planned: 0 });
    page.remove();
  });

  it("registers a player minibar Combat Achievements component", () => {
    const panel = readFileSync("src/player-panel/player-panel.html", "utf8");
    const components = JSON.parse(readFileSync("components.json", "utf8"));
    expect(panel).toContain('data-component="player-combat-achievements"');
    expect(components).toContain("player-combat-achievements");
  });
});
