import { describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { pubsub } from "../src/data/pubsub";
import "../src/item-history-page/item-history-page";

describe("item-history-page", () => {
  it("waits for authenticated group data before loading history", async () => {
    const getItemHistory = vi.spyOn(api, "getItemHistory").mockResolvedValue([]);
    const page = document.createElement("item-history-page");
    document.body.appendChild(page);

    expect(getItemHistory).not.toHaveBeenCalled();

    pubsub.publish("get-group-data");
    await Promise.resolve();

    expect(getItemHistory).toHaveBeenCalledOnce();
    page.remove();
  });
});
