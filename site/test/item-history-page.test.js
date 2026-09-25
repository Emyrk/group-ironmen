import { describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { Item } from "../src/data/item";
import { pubsub } from "../src/data/pubsub";
import { ItemHistoryPage } from "../src/item-history-page/item-history-page";
import { utility } from "../src/utility";

ItemHistoryPage.prototype.html = function () {
  return `
    <button class="item-history-page__refresh"></button>
    ${this.renderControls()}
    <div class="item-history-page__days">${this.renderHistory()}</div>
  `;
};

const storage = {
  snapshotCount: 3,
  snapshotBytes: 2048,
  databaseBytes: 8192,
  oldestDate: "2026-09-14",
  newestDate: "2026-09-16",
  retentionDays: 365,
};
const history = {
  dates: ["2026-09-14", "2026-09-15", "2026-09-16"],
  from: "2026-09-15",
  to: "2026-09-16",
  gained: [{ item_id: 995, quantity: 500 }],
  lost: [{ item_id: 4151, quantity: 1 }],
  charge_changes: [{ name: "Ring of dueling", item_id: 2552, from: 412, to: 410, difference: -2 }],
  high_alch: { gained: 500, lost: 72000, net: -71500 },
  live: { date: "2026-09-16", updatedAt: "2026-09-16T13:15:00.000Z", refreshMinutes: 15 },
  storage,
};

describe("item-history-page", () => {
  it("waits for authenticated group data and refreshes the live diff every fifteen minutes", async () => {
    let intervalCallback;
    const interval = vi.spyOn(utility, "callOnInterval").mockImplementation((callback) => {
      intervalCallback = callback;
      return 99;
    });
    const getItemHistory = vi.spyOn(api, "getItemHistory").mockResolvedValue(history);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);

    expect(getItemHistory).not.toHaveBeenCalled();

    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(getItemHistory).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(page.textContent).toContain("365 day retention"));

    const fromDate = page.querySelector(".item-history-page__from-date");
    const toDate = page.querySelector(".item-history-page__to-date");
    expect(fromDate.type).toBe("date");
    expect(fromDate.min).toBe("2026-09-14");
    expect(toDate.type).toBe("date");
    expect(toDate.max).toBe("2026-09-16");
    expect(page.textContent).toContain("Today, live");
    expect(page.textContent).toContain("Gained HA 500 gp");
    expect(page.textContent).toContain("Lost HA 72,000 gp");
    expect(page.textContent).toContain("Net HA -71,500 gp");
    expect(page.textContent).toContain("Ring of dueling (412 -> 410)");
    expect(page.textContent).toContain("-2");
    expect(page.textContent).toContain("+500");
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000, false);

    await intervalCallback();
    expect(getItemHistory).toHaveBeenCalledTimes(2);
    expect(getItemHistory).toHaveBeenLastCalledWith(undefined, undefined);
    page.remove();
  });

  it("requests and labels a single-day diff when both dates match", async () => {
    const singleDay = {
      ...history,
      from: "2026-09-16",
      to: "2026-09-16",
      singleDay: true,
      baselineDate: "2026-09-15",
    };
    const getItemHistory = vi.spyOn(api, "getItemHistory").mockResolvedValue(singleDay);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".item-history-page__from-date")).not.toBeNull());

    page.querySelector(".item-history-page__from-date").value = "2026-09-16";
    page.querySelector(".item-history-page__to-date").value = "2026-09-16";
    page.querySelector(".item-history-page__to-date").dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(getItemHistory).toHaveBeenLastCalledWith("2026-09-16", "2026-09-16"));
    await vi.waitFor(() => expect(page.textContent).toContain("daily diff"));
    page.remove();
  });

  it("explains when the first snapshot has no earlier baseline", async () => {
    const firstDay = {
      ...history,
      from: "2026-09-14",
      to: "2026-09-14",
      singleDay: true,
      baselineDate: "2026-09-14",
      baselineAvailable: false,
      gained: [],
      lost: [],
    };
    vi.spyOn(api, "getItemHistory").mockResolvedValue(firstDay);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);
    pubsub.publish("get-group-data");

    await vi.waitFor(() => expect(page.textContent).toContain("Tracking started on this date"));
    page.remove();
  });

  it("requests the accumulated diff for selected dates", async () => {
    const getItemHistory = vi.spyOn(api, "getItemHistory").mockResolvedValue(history);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".item-history-page__from-date")).not.toBeNull());

    page.querySelector(".item-history-page__from-date").value = "2026-09-14";
    page.querySelector(".item-history-page__to-date").value = "2026-09-16";
    page.querySelector(".item-history-page__to-date").dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(getItemHistory).toHaveBeenLastCalledWith("2026-09-14", "2026-09-16"));
    page.remove();
  });

  it("ranks items with Alt controls and persists Important and Ignore choices", async () => {
    const rankedHistory = {
      ...history,
      gained: [
        { item_id: 995, quantity: 500 },
        { item_id: 4151, quantity: 1 },
      ],
      lost: [],
    };
    vi.spyOn(api, "getItemHistory").mockResolvedValue(rankedHistory);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector('[data-item-id="995"]')).not.toBeNull());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(page.classList.contains("item-history-page--ranking")).toBe(true);

    page
      .querySelector('[data-item-id="995"] [data-rank-direction="down"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));

    expect(page.querySelector('.item-history-page__ignored [data-item-id="995"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(page.rankingStorageKey))).toEqual({ 995: "ignore" });

    page
      .querySelector('[data-item-id="995"] [data-rank-direction="up"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    page
      .querySelector('[data-item-id="995"] [data-rank-direction="up"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));

    const importantItem = page.querySelector('.item-history-page__items [data-item-id="995"]');
    expect(importantItem.classList.contains("item-history-page__item--important")).toBe(true);
    expect(importantItem.parentElement.firstElementChild).toBe(importantItem);
    expect(JSON.parse(localStorage.getItem(page.rankingStorageKey))).toEqual({ 995: "important" });

    page.itemRankings = new Map();
    page.loadItemRankings();
    page.render();
    expect(page.querySelector('[data-item-id="995"]').classList.contains("item-history-page__item--important")).toBe(
      true
    );

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(page.classList.contains("item-history-page--ranking")).toBe(false);
    page.remove();
  });

  it("filters gained, lost, and charge changes by item name", async () => {
    Item.itemDetails = {
      995: { id: 995, name: "Coins", stacks: null },
      2552: { id: 2552, name: "Ring of dueling", stacks: null },
      4151: { id: 4151, name: "Abyssal whip", stacks: null },
    };
    vi.spyOn(api, "getItemHistory").mockResolvedValue(history);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);
    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(page.querySelector(".item-history-page__search")).not.toBeNull());

    const search = page.querySelector(".item-history-page__search");
    search.value = "WHIP";
    search.dispatchEvent(new Event("input"));

    expect(page.textContent).toContain("Abyssal whip");
    expect(page.textContent).not.toContain("Coins");
    expect(page.textContent).not.toContain("Ring of dueling");
    expect(page.textContent).toContain("Gained (0)");
    expect(page.textContent).toContain("Lost (1)");

    search.value = "ring";
    search.dispatchEvent(new Event("input"));

    expect(page.textContent).toContain("Ring of dueling");
    expect(page.textContent).toContain("Charge changes (1)");
    expect(page.textContent).not.toContain("Abyssal whip");
    page.remove();
  });
});
