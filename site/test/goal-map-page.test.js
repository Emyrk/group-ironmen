import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { Item } from "../src/data/item";
import { pubsub } from "../src/data/pubsub";
import { GoalMapPage } from "../src/goal-map-page/goal-map-page";

GoalMapPage.prototype.html = function () {
  return `
    <header>
      <div class="goal-map-page__controls">${this.renderControls()}</div>
    </header>
    <div class="goal-map-page__content">${this.renderContent()}</div>
  `;
};

const goalMap = {
  updatedAt: "2026-09-17T12:30:00.000Z",
  characters: ["Alice", "Bob"],
  selectedCharacter: "Alice",
  nodes: [
    {
      id: "quest-cape",
      title: "Quest Cape",
      type: "goal",
      scope: "character",
      description: "Complete every quest.",
      wikiUrl: "https://oldschool.runescape.wiki/w/Quest_point_cape",
      evaluated: {
        complete: true,
        progress: "165/165",
        evidence: [
          "All quests complete",
          { questPoints: 320 },
          { type: "skill", skill: "Agility", level: 68, requiredLevel: 62 },
        ],
        completedAt: "2026-09-16T10:00:00.000Z",
      },
    },
    {
      id: "nightmare-zone",
      title: "Nightmare Zone",
      type: "activity",
      scope: "group",
      description: "Imbue useful rings.",
      wikiUrl: null,
      evaluated: {
        complete: false,
        progress: "2/4",
        evidence: [{ type: "skill", skill: "Magic", level: 60, requiredLevel: 70 }],
      },
    },
    {
      id: "berserker-ring",
      title: "Berserker ring (i)",
      type: "item",
      scope: "character",
      description: "Obtain and imbue the ring.",
      wikiUrl: null,
      evaluated: {
        complete: false,
        progress: 0,
        evidence: [{ type: "item", itemId: 4732, quantity: 1 }],
      },
    },
  ],
  edges: [
    { source: "quest-cape", target: "nightmare-zone", type: "requires", label: "Unlock bosses" },
    { source: "nightmare-zone", target: "berserker-ring", type: "requires" },
  ],
};

function createPage() {
  const page = document.createElement("goal-map-page");
  document.body.appendChild(page);
  return page;
}

describe("goal-map-page", () => {
  beforeEach(() => {
    Item.itemDetails = {
      2434: { id: 2434, name: "Prayer potion(4)", highalch: 48, stacks: null },
      4732: { id: 4732, name: "Karil's coif", highalch: 7800, stacks: null },
    };
  });

  it("is registered on the authenticated /group/goals route", () => {
    const indexHtml = readFileSync("src/index.html", "utf8");
    expect(indexHtml).toContain('route-path="/goals"');
    expect(indexHtml).toContain('route-component="goal-map-page"');
    expect(customElements.get("goal-map-page")).toBe(GoalMapPage);
  });

  it("loads the persisted character and renders summary, completion, evidence, and a jsdom fallback", async () => {
    localStorage.setItem("goalMapSelectedCharacter", "Alice");
    const getGoalMap = vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();

    expect(getGoalMap).not.toHaveBeenCalled();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(getGoalMap).toHaveBeenCalledWith("Alice"));
    await vi.waitFor(() => expect(page.textContent).toContain("Quest Cape"));

    expect(page.querySelector(".goal-map-page__character").value).toBe("Alice");
    expect(page.textContent).toContain("1 complete");
    expect(page.textContent).toContain("1 available");
    expect(page.textContent).toContain("1 blocked");
    expect(page.textContent).toContain("165/165");
    expect(page.textContent).toContain("All quests complete");
    expect(page.textContent).toContain('{"questPoints":320}');
    expect(page.textContent).toContain("Graph view is unavailable");
    expect(page.graph).toBeFalsy();
    page.remove();
  });

  it("persists character changes and reloads the selected character", async () => {
    const bobMap = {
      ...goalMap,
      selectedCharacter: "Bob",
      nodes: [{ ...goalMap.nodes[1], id: "bob-goal", title: "Bob's next goal" }],
      edges: [],
    };
    const getGoalMap = vi.spyOn(api, "getGoalMap").mockResolvedValueOnce(goalMap).mockResolvedValueOnce(bobMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__character")?.value).toBe("Alice"));

    const selector = page.querySelector(".goal-map-page__character");
    selector.value = "Bob";
    selector.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(getGoalMap).toHaveBeenLastCalledWith("Bob"));
    await vi.waitFor(() => expect(page.textContent).toContain("Bob's next goal"));
    expect(localStorage.getItem("goalMapSelectedCharacter")).toBe("Bob");
    page.remove();
  });

  it("uses safe text rendering for server content and rejects unsafe wiki urls", async () => {
    const unsafeMap = {
      ...goalMap,
      nodes: [
        {
          ...goalMap.nodes[0],
          id: "unsafe",
          title: '<img src=x onerror="window.hacked=true">',
          description: "<script>window.hacked=true</script>",
          wikiUrl: "javascript:alert(1)",
          evaluated: { complete: true, progress: "done", evidence: ["<b>not markup</b>"] },
        },
      ],
      edges: [],
    };
    vi.spyOn(api, "getGoalMap").mockResolvedValue(unsafeMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.textContent).toContain('<img src=x onerror="window.hacked=true">'));
    expect(page.querySelector("img")).toBeNull();
    expect(page.querySelector("script")).toBeNull();
    expect(page.querySelector(".goal-map-page__wiki")).toBeNull();
    expect(page.textContent).toContain("<b>not markup</b>");
    expect(window.hacked).toBeUndefined();
    page.remove();
  });

  it("lists every objective and focuses its details without graph editing controls", async () => {
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".goal-map-page__objective-select")).toHaveLength(3));

    page.querySelector('.goal-map-page__objective-select[data-node-id="nightmare-zone"]').click();

    expect(page.querySelector(".goal-map-page__details").textContent).toContain("Nightmare Zone");
    expect(page.querySelector(".goal-map-page__details").textContent).toContain("2/4");
    expect(page.querySelector(".goal-map-page__objective-select.selected").dataset.nodeId).toBe("nightmare-zone");
    expect(page.querySelector(".goal-map-page__fallback-node.selected").dataset.nodeId).toBe("nightmare-zone");
    expect(page.querySelector("[contenteditable]")).toBeNull();
    page.remove();
  });

  it("offers a persistent list layout that explains downstream benefits", async () => {
    const storageKey = `goalMapLayout:${api.groupName || "unknown"}`;
    localStorage.setItem(storageKey, "list");
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.querySelectorAll(".goal-map-page__explorer-goal")).toHaveLength(3));
    expect(page.querySelector(".goal-map-page__graph")).toBeNull();
    expect(page.querySelector('[data-layout="list"]').getAttribute("aria-pressed")).toBe("true");
    expect(
      page.querySelector('[data-node-id="quest-cape"]').closest(".goal-map-page__explorer-goal").textContent
    ).toContain("Required for Nightmare Zone");
    expect(
      page.querySelector('[data-node-id="quest-cape"]').closest(".goal-map-page__explorer-goal").textContent
    ).toContain("Unlock bosses");

    page.querySelector('[data-layout="graph"]').click();
    expect(localStorage.getItem(storageKey)).toBe("graph");
    expect(page.querySelector(".goal-map-page__graph")).not.toBeNull();
    page.remove();
  });

  it("explores goals by skills found in evaluated requirements", async () => {
    localStorage.setItem(`goalMapLayout:${api.groupName || "unknown"}`, "list");
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__skill-filter")).not.toBeNull());

    const filter = page.querySelector(".goal-map-page__skill-filter");
    expect([...filter.options].map((option) => option.textContent)).toEqual(["All skills", "Agility", "Magic"]);
    filter.value = "Magic";
    filter.dispatchEvent(new Event("change"));

    expect(page.querySelectorAll(".goal-map-page__explorer-goal")).toHaveLength(1);
    expect(page.querySelector(".goal-map-page__explorer-goal").textContent).toContain("Nightmare Zone");
    expect(page.querySelector('.goal-map-page__explorer-goal img[alt="Magic"]')).not.toBeNull();
    page.remove();
  });

  it("renders skill requirements as icon level badges with completion colors", async () => {
    localStorage.setItem(`goalMapLayout:${api.groupName || "unknown"}`, "list");
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() =>
      expect(page.querySelectorAll(".goal-map-page__explorer .goal-map-page__skill-requirement")).toHaveLength(2)
    );

    const agility = page.querySelector('[title="Agility: 68/62"]');
    expect(agility.classList.contains("complete")).toBe(true);
    expect(agility.textContent.replace(/\s/g, "")).toBe("68/62");
    expect(agility.querySelector("img").getAttribute("src")).toBe("/ui/204-0.png");

    const magic = page.querySelector('[title="Magic: 60/70"]');
    expect(magic.classList.contains("incomplete")).toBe(true);
    expect(magic.querySelector("img").getAttribute("src")).toBe("/ui/202-0.png");

    page.querySelector('.goal-map-page__explorer-select[data-node-id="nightmare-zone"]').click();
    expect(page.querySelector(".goal-map-page__details").textContent).not.toContain("60/70 level");
    expect(page.querySelector('.goal-map-page__details [title="Magic: 60/70"]')).not.toBeNull();
    page.remove();
  });

  it("shows what the selected goal benefits and how in its details", async () => {
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__details").textContent).toContain("Quest Cape"));

    const details = page.querySelector(".goal-map-page__details");
    expect(details.textContent).toContain("Benefits");
    expect(details.textContent).toContain("Required for Nightmare Zone");
    expect(details.textContent).toContain("Unlock bosses");
    page.remove();
  });

  it("enumerates diary tasks with their completion state", async () => {
    const diaryMap = {
      ...goalMap,
      nodes: [
        {
          id: "morytania-hard",
          title: "Morytania Hard Diary",
          type: "goal",
          scope: "character",
          category: "Morytania Diary",
          description: "Complete all hard tasks.",
          evaluated: {
            complete: false,
            progress: { current: 1, target: 2, unit: "task" },
            evidence: [
              {
                type: "diary",
                region: "Morytania",
                tier: "Hard",
                completed: 1,
                total: 2,
                tasks: [
                  { name: "Enter the Kharyrll portal in your POH.", complete: true },
                  {
                    name: "Pray at the Altar of Nature with Piety activated.",
                    complete: false,
                    requirements: [
                      { type: "skill", skill: "Prayer", level: 69, requiredLevel: 70, complete: false },
                      { type: "quest", name: "King's Ransom", state: 2, complete: true },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
      edges: [],
    };
    localStorage.setItem(`goalMapLayout:${api.groupName || "unknown"}`, "graph");
    vi.spyOn(api, "getGoalMap").mockResolvedValue(diaryMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.querySelectorAll(".goal-map-page__diary-tasks li")).toHaveLength(2));
    expect(page.getNodeStatus(diaryMap.nodes[0])).toBe("blocked");
    expect(page.querySelector('.goal-map-page__fallback-node[data-node-id="morytania-hard"]').classList).toContain(
      "blocked"
    );
    const blockedGraphStyle = page.graphStyles().find((entry) => entry.selector === "node.blocked");
    expect(blockedGraphStyle.style).toMatchObject({
      "background-color": "#6b2828",
      "border-color": "#e26464",
    });

    page.querySelector('[data-layout="list"]').click();
    expect(page.querySelector(".goal-map-page__explorer-goal").classList).toContain("blocked");
    const tasks = page.querySelectorAll(".goal-map-page__diary-tasks li");
    expect(tasks[0].textContent).toContain("Enter the Kharyrll portal in your POH.");
    expect(tasks[0].classList.contains("complete")).toBe(true);
    expect(tasks[1].textContent).toContain("Pray at the Altar of Nature with Piety activated.");
    expect(tasks[1].classList.contains("incomplete")).toBe(true);
    expect(tasks[0].classList.contains("missing-skill-requirements")).toBe(false);
    expect(tasks[1].classList.contains("missing-skill-requirements")).toBe(true);
    const requirements = tasks[1].querySelectorAll(".goal-map-page__diary-requirement");
    expect(requirements).toHaveLength(2);
    expect(requirements[0].textContent).toContain("70 Prayer");
    expect(requirements[0].classList.contains("incomplete")).toBe(true);
    expect(requirements[0].getAttribute("title")).toBe("Prayer: 69/70");
    expect(requirements[0].querySelector("img").getAttribute("src")).toBe("/ui/201-0.png");
    expect(requirements[1].textContent).toContain("King's Ransom");
    expect(requirements[1].classList.contains("complete")).toBe(true);
    expect(page.querySelector(".goal-map-page__diary-evidence").textContent).toContain("Morytania Hard: 1/2 tasks");
    page.remove();
  });

  it("manually completes a goal for the selected character and can undo it", async () => {
    const incompleteMap = {
      ...goalMap,
      nodes: [
        {
          id: "fossil-island-teaks",
          title: "Plant teak on Fossil Island",
          type: "unlock",
          scope: "character",
          description: "Plant a teak sapling.",
          evaluated: {
            complete: false,
            automaticComplete: false,
            manualComplete: false,
            manuallyCompletedAt: null,
            progress: { current: 2, target: 3 },
            evidence: [{ type: "unobservable", message: "Patch state is unavailable." }],
          },
        },
      ],
      edges: [],
    };
    const completedMap = {
      ...incompleteMap,
      nodes: [
        {
          ...incompleteMap.nodes[0],
          complete: true,
          manualComplete: true,
          manuallyCompletedAt: "2026-09-18T12:00:00.000Z",
          evaluated: {
            ...incompleteMap.nodes[0].evaluated,
            complete: true,
            manualComplete: true,
            manuallyCompletedAt: "2026-09-18T12:00:00.000Z",
            completedAt: "2026-09-18T12:00:00.000Z",
          },
        },
      ],
    };
    vi.spyOn(api, "getGoalMap").mockResolvedValue(incompleteMap);
    const setManualCompletion = vi
      .spyOn(api, "setGoalManualCompletion")
      .mockResolvedValueOnce(completedMap)
      .mockResolvedValueOnce(incompleteMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__manual-completion")).not.toBeNull());
    expect(page.querySelector(".goal-map-page__manual-completion").textContent).toContain("Mark complete for Alice");
    page.querySelector(".goal-map-page__manual-completion").click();

    await vi.waitFor(() => expect(setManualCompletion).toHaveBeenCalledWith("fossil-island-teaks", "Alice", true));
    await vi.waitFor(() =>
      expect(page.querySelector(".goal-map-page__manual-completion").textContent).toContain(
        "Undo manual completion for Alice"
      )
    );
    expect(page.getNodeStatus(page.data.nodes[0])).toBe("complete");
    expect(page.querySelector(".goal-map-page__manual-completion-control").textContent).toContain(
      "This remains saved until you undo it."
    );

    page.querySelector(".goal-map-page__manual-completion").click();
    await vi.waitFor(() => expect(setManualCompletion).toHaveBeenLastCalledWith("fossil-island-teaks", "Alice", false));
    await vi.waitFor(() =>
      expect(page.querySelector(".goal-map-page__manual-completion").textContent).toContain("Mark complete for Alice")
    );
    page.remove();
  });

  it("manually completes a group goal for every character", async () => {
    const incompleteMap = {
      ...goalMap,
      nodes: [
        {
          id: "teak-seed",
          title: "Obtain a teak seed",
          type: "item",
          scope: "group",
          description: "The group owns a teak seed.",
          evaluated: {
            complete: false,
            automaticComplete: false,
            manualComplete: false,
            manuallyCompletedAt: null,
            progress: { current: 0, target: 1 },
            evidence: [{ type: "item", itemId: 21486, quantity: 0 }],
          },
        },
      ],
      edges: [],
    };
    const completedMap = {
      ...incompleteMap,
      nodes: [
        {
          ...incompleteMap.nodes[0],
          complete: true,
          manualComplete: true,
          evaluated: {
            ...incompleteMap.nodes[0].evaluated,
            complete: true,
            manualComplete: true,
            manuallyCompletedAt: "2026-09-18T12:00:00.000Z",
          },
        },
      ],
    };
    vi.spyOn(api, "getGoalMap").mockResolvedValue(incompleteMap);
    const setManualCompletion = vi.spyOn(api, "setGoalManualCompletion").mockResolvedValue(completedMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__manual-completion")).not.toBeNull());
    expect(page.querySelector(".goal-map-page__manual-completion").textContent).toContain("Mark complete for the group");
    page.querySelector(".goal-map-page__manual-completion").click();

    await vi.waitFor(() => expect(setManualCompletion).toHaveBeenCalledWith("teak-seed", "Alice", true));
    await vi.waitFor(() =>
      expect(page.querySelector(".goal-map-page__manual-completion").textContent).toContain(
        "Undo manual completion for the group"
      )
    );
    expect(page.querySelector(".goal-map-page__manual-completion-control").textContent).toContain(
      "Manually completed for the group"
    );
    page.remove();
  });

  it("links the Medium Combat Achievements goal to its planner page", async () => {
    const combatMap = {
      ...goalMap,
      nodes: [
        {
          id: "medium-combat-achievements",
          title: "Medium Combat Achievements",
          type: "unlock",
          scope: "character",
          description: "Earn the Medium reward tier.",
          evaluated: { complete: false, progress: { current: 0, target: 1 }, evidence: [] },
        },
      ],
      edges: [],
    };
    vi.spyOn(api, "getGoalMap").mockResolvedValue(combatMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__planner-link")).not.toBeNull());
    expect(page.querySelector(".goal-map-page__planner-link").getAttribute("href")).toBe(
      "/group/combat-achievements"
    );
    page.remove();
  });

  it("renders item evidence with its name and image instead of only its id", async () => {
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".goal-map-page__objective-select")).toHaveLength(3));

    page.querySelector('.goal-map-page__objective-select[data-node-id="berserker-ring"]').click();

    const evidence = page.querySelector(".goal-map-page__item-evidence");
    expect(evidence.textContent).toContain("Karil's coif");
    expect(evidence.textContent).toContain("1 owned");
    expect(evidence.querySelector("img").getAttribute("src")).toBe("/icons/items/4732.webp");
    expect(page.querySelector(".goal-map-page__details").textContent).not.toContain("Item 4732");
    page.remove();
  });

  it("renders prayer potion stock as weighted doses", async () => {
    const potionMap = {
      ...goalMap,
      nodes: [
        {
          id: "prayer-potion-supply",
          title: "Prayer potion supply",
          type: "item",
          scope: "group",
          description: "Own 40 doses.",
          evaluated: {
            complete: false,
            progress: { current: 32, target: 40, unit: "dose" },
            evidence: [{ type: "item", itemId: 2434, quantity: 32, targetQuantity: 40, unit: "dose" }],
          },
        },
      ],
      edges: [],
    };
    vi.spyOn(api, "getGoalMap").mockResolvedValue(potionMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.querySelector(".goal-map-page__item-evidence")).not.toBeNull());
    expect(page.querySelector(".goal-map-page__details").textContent).toContain("32/40 doses");
    expect(page.querySelector(".goal-map-page__item-evidence").textContent).toContain("Prayer potion(4)");
    expect(page.querySelector(".goal-map-page__item-evidence").textContent).toContain("32/40 doses");
    page.remove();
  });

  it("pins objectives locally and restores valid pins above other objectives", async () => {
    const storageKey = `goalMapPinnedObjectives:${api.groupName || "unknown"}`;
    localStorage.setItem(storageKey, JSON.stringify(["nightmare-zone", "removed-objective"]));
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");

    await vi.waitFor(() =>
      expect(page.querySelector(".goal-map-page__objective-section h3")?.textContent).toBe("Pinned")
    );
    expect(localStorage.getItem(storageKey)).toBe('["nightmare-zone"]');
    expect(page.querySelector(".goal-map-page__objective-select").dataset.nodeId).toBe("nightmare-zone");
    expect(
      page.querySelector('.goal-map-page__objective-pin[data-node-id="nightmare-zone"]').getAttribute("aria-pressed")
    ).toBe("true");

    page.querySelector('.goal-map-page__objective-pin[data-node-id="berserker-ring"]').click();

    expect(localStorage.getItem(storageKey)).toBe('["nightmare-zone","berserker-ring"]');
    expect(
      page.querySelectorAll(".goal-map-page__objective-section")[0].querySelectorAll(".goal-map-page__objective")
    ).toHaveLength(2);

    page.querySelector('.goal-map-page__detail-pin[data-node-id="quest-cape"]').click();
    expect(localStorage.getItem(storageKey)).toBe('["nightmare-zone","berserker-ring","quest-cape"]');
    expect(page.querySelector(".goal-map-page__detail-pin").textContent).toContain("Unpin objective");
    page.remove();
  });
});
