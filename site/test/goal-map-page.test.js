import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
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
        evidence: ["All quests complete", { questPoints: 320 }],
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
      evaluated: { complete: false, progress: "2/4", evidence: [] },
    },
    {
      id: "berserker-ring",
      title: "Berserker ring (i)",
      type: "item",
      scope: "character",
      description: "Obtain and imbue the ring.",
      wikiUrl: null,
      evaluated: { complete: false, progress: 0, evidence: null },
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

  it("focuses node details from the text fallback without graph editing controls", async () => {
    vi.spyOn(api, "getGoalMap").mockResolvedValue(goalMap);
    const page = createPage();
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelectorAll(".goal-map-page__fallback-node")).toHaveLength(3));

    page.querySelector('[data-node-id="nightmare-zone"]').click();

    expect(page.querySelector(".goal-map-page__details").textContent).toContain("Nightmare Zone");
    expect(page.querySelector(".goal-map-page__details").textContent).toContain("2/4");
    expect(page.querySelector(".goal-map-page__fallback-node.selected").dataset.nodeId).toBe("nightmare-zone");
    expect(page.querySelector("[contenteditable]")).toBeNull();
    page.remove();
  });
});
