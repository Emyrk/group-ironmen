import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { pubsub } from "../src/data/pubsub";
import { CombatAchievementsPage } from "../src/combat-achievements-page/combat-achievements-page";
import { PlayerCombatAchievements } from "../src/player-combat-achievements/player-combat-achievements";

CombatAchievementsPage.prototype.html = function () {
  return `<header>${this.renderHeader()}</header><main>${this.renderContent()}</main>`;
};

const data = {
  rewardPoints: 2697,
  tiers: [
    { name: "Easy", pointsPerTask: 1, rewardPoints: 41 },
    { name: "Medium", pointsPerTask: 2, rewardPoints: 169 },
    { name: "Hard", pointsPerTask: 3, rewardPoints: 436 },
    { name: "Elite", pointsPerTask: 4, rewardPoints: 1100 },
    { name: "Master", pointsPerTask: 5, rewardPoints: 1965 },
    { name: "Grandmaster", pointsPerTask: 6, rewardPoints: 2697 },
  ],
  characters: ["Alice", "Bob"],
  selectedCharacter: "Alice",
  tasks: [
    {
      id: "barrows-champion",
      tier: "Easy",
      monster: "Barrows",
      name: "Barrows Champion",
      description: "Open the Barrows chest 25 times.",
      type: "Kill Count",
      points: 1,
      completionPercent: 59.6,
      wikiUrl: "https://oldschool.runescape.wiki/w/Barrows_Champion",
      status: "completed",
      notes: "Done",
    },
    {
      id: "pray-for-success",
      tier: "Medium",
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
      tier: "Grandmaster",
      monster: "Giant Mole",
      name: "Giant Mole Champion",
      description: "Kill the Giant Mole 25 times.",
      type: "Kill Count",
      points: 6,
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
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState("", "", "/group");
  });

  it("is registered on the authenticated combat achievements route", () => {
    const html = readFileSync("src/index.html", "utf8");
    expect(html).toContain('route-path="/combat-achievements"');
    expect(html).toContain('route-component="combat-achievements-page"');
    const components = JSON.parse(readFileSync("components.json", "utf8"));
    expect(components).toContain("combat-achievements-page");
    expect(customElements.get("combat-achievements-page")).toBe(CombatAchievementsPage);
  });

  it("calculates earned and planned points and suggests common tasks first", async () => {
    vi.spyOn(api, "getCombatAchievements").mockResolvedValue(data);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(3));

    expect(page.textContent).toContain("1/ 2697 points earned");
    expect(page.textContent).toContain("3points with planned tasks");
    expect(page.textContent).toContain("40points to Easy tier");
    expect([...page.querySelectorAll(".combat-achievements-page__task h2")].map((node) => node.textContent)).toEqual([
      "Pray for Success",
      "Giant Mole Champion",
      "Barrows Champion",
    ]);
    page.remove();
  });

  it("filters by tier and persists status, notes, and character selection", async () => {
    const get = vi.spyOn(api, "getCombatAchievements").mockResolvedValue(data);
    const updateTask = vi.spyOn(api, "updateCombatAchievement").mockResolvedValue(data);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(3));

    const tier = page.querySelector('[data-filter="tier"]');
    tier.value = "Grandmaster";
    tier.dispatchEvent(new Event("input"));
    expect(page.querySelectorAll(".combat-achievements-page__task")).toHaveLength(1);
    expect(page.querySelector(".combat-achievements-page__task h2").textContent).toBe("Giant Mole Champion");

    tier.value = "";
    tier.dispatchEvent(new Event("input"));
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

    const character = page.querySelector(".combat-achievements-page__character");
    character.value = "Bob";
    character.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(get).toHaveBeenLastCalledWith("Bob"));
    page.remove();
  });

  it("renders synchronized completion separately without overwriting manual plans", async () => {
    const syncedData = {
      ...data,
      syncedSnapshot: { clientRevision: 123, achievementPoints: 321, updatedAt: "2026-09-18T12:00:00Z" },
      tasks: data.tasks.map((task) =>
        task.id === "pray-for-success" ? { ...task, syncedComplete: true } : { ...task, syncedComplete: false }
      ),
    };
    vi.spyOn(api, "getCombatAchievements").mockResolvedValue(syncedData);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".combat-achievements-page__synced")).not.toBeNull());

    expect(page.textContent).toContain("115points to Hard tier");

    const row = page.querySelector('[data-task-id="pray-for-success"]');
    expect(row.classList.contains("completed")).toBe(true);
    expect(row.querySelector(".combat-achievements-page__task-status").value).toBe("planned");
    expect(row.querySelector(".combat-achievements-page__notes").value).toBe("Use freezes");
    expect(page.summary()).toMatchObject({ completed: 2, planned: 0 });
    page.remove();
  });

  it("shows when every Combat Achievement tier is unlocked", async () => {
    vi.spyOn(api, "getCombatAchievements").mockResolvedValue({
      ...data,
      syncedSnapshot: { clientRevision: 124, achievementPoints: 2697, updatedAt: "2026-09-20T12:00:00Z" },
    });
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.textContent).toContain("0all tiers unlocked"));
    page.remove();
  });

  it("shows synchronized points and opens the selected player's planner with a styled button", async () => {
    vi.spyOn(api, "getCombatAchievements").mockResolvedValue({
      ...data,
      syncedSnapshot: { clientRevision: 123, achievementPoints: 321, updatedAt: "2026-09-18T12:00:00Z" },
    });
    const summary = document.createElement("player-combat-achievements");
    summary.setAttribute("player-name", "Alice");
    document.body.appendChild(summary);

    await vi.waitFor(() => expect(summary.textContent).toContain("321 Combat Achievement points."));
    expect(summary.textContent).not.toContain("Medium tasks complete");
    const button = summary.querySelector("button.men-button");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(localStorage.getItem("combatAchievementsSelectedCharacter")).toBe("Alice");

    button.click();
    expect(window.location.pathname).toBe("/group/combat-achievements");
    expect(localStorage.getItem("combatAchievementsSelectedCharacter")).toBe("Alice");
    summary.remove();
  });

  it("shows a clear fallback before Combat Achievement points are synchronized", async () => {
    vi.spyOn(api, "getCombatAchievements").mockResolvedValue({ ...data, syncedSnapshot: null });
    const summary = document.createElement("player-combat-achievements");
    summary.setAttribute("player-name", "Bob");
    document.body.appendChild(summary);

    await vi.waitFor(() =>
      expect(summary.textContent).toContain("Combat Achievement points have not synchronized from RuneLite yet.")
    );
    summary.remove();
  });

  it("registers a player minibar Combat Achievements component", () => {
    const panel = readFileSync("src/player-panel/player-panel.html", "utf8");
    const components = JSON.parse(readFileSync("components.json", "utf8"));
    expect(panel).toContain('data-component="player-combat-achievements"');
    expect(panel).toContain('src="/ui/combat-achievements.png"');
    expect(components).toContain("player-combat-achievements");
    expect(customElements.get("player-combat-achievements")).toBe(PlayerCombatAchievements);
  });
});
