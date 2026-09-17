import { describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { pubsub } from "../src/data/pubsub";
import { ItemHistoryPage } from "../src/item-history-page/item-history-page";

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
  storage,
};

describe("item-history-page", () => {
  it("waits for authenticated group data before loading history", async () => {
    const getItemHistory = vi.spyOn(api, "getItemHistory").mockResolvedValue(history);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);

    expect(getItemHistory).not.toHaveBeenCalled();

    pubsub.publish("get-group-data");
    await vi.waitFor(() => expect(getItemHistory).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(page.textContent).toContain("365 day retention"));

    expect(page.textContent).toContain("+500");
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
});
