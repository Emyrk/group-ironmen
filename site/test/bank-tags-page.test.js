import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/item", () => ({
  Item: { itemDetails: {}, imageUrl: (id) => `/icons/items/${id}.webp` },
}));

import { BankTagsPage } from "../src/bank-tags-page/bank-tags-page";

describe("bank tags page", () => {
  let page;
  beforeEach(() => {
    page = new BankTagsPage();
    page.innerHTML =
      '<p class="bank-tags-page__status"></p><ul class="bank-tags-page__list"></ul><main class="bank-tags-page__editor"></main>';
    page.selectedTagId = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
    page.tags.set(page.selectedTagId, {
      schemaVersion: 1,
      tagId: page.selectedTagId,
      name: "herblore",
      iconItemId: 952,
      itemIds: [199, 201],
      layout: [199, -1, 201],
      revision: 7,
      deleted: false,
    });
    page.order = [page.selectedTagId];
  });

  it("escapes item names and tag names used in attributes", () => {
    expect(page.escapeAttribute('A "quoted" <item>')).toBe("A &quot;quoted&quot; &lt;item&gt;");
  });

  it("saves with the loaded revision as an HTTP precondition", async () => {
    page.request = vi.fn().mockResolvedValue({ ...page.selectedTag(), revision: 8 });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    await page.save();

    expect(page.request).toHaveBeenCalledWith(`/bank-tags/${page.selectedTagId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": '"7"' },
      body: JSON.stringify({
        schemaVersion: 1,
        tagId: page.selectedTagId,
        name: "herblore",
        iconItemId: 952,
        itemIds: [199, 201],
        layout: [199, -1, 201],
      }),
    });
    expect(page.selectedTag().revision).toBe(8);
  });

  it("preserves the draft and reports a stale-revision conflict", async () => {
    const original = page.selectedTag();
    const failure = Object.assign(new Error("stale"), { status: 409, code: "stale_revision" });
    page.request = vi.fn().mockRejectedValue(failure);

    await page.save();

    expect(page.selectedTag()).toBe(original);
    expect(page.querySelector(".bank-tags-page__status").textContent).toContain("Save conflict");
  });
});
