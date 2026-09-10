import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/item", () => ({
  Item: { itemDetails: {}, imageUrl: (id) => `/icons/items/${id}.webp` },
}));

import { BankTagsPage } from "../src/bank-tags-page/bank-tags-page";

describe("bank tags page", () => {
  let page;
  beforeEach(() => {
    page = new BankTagsPage();
    page.innerHTML = `<button class="bank-tags-page__help-button"></button>
      <p class="bank-tags-page__status"></p><ul class="bank-tags-page__list"></ul><main class="bank-tags-page__editor"></main>
      <div class="bank-tags-page__help" hidden><button class="bank-tags-page__help-close"></button></div>
      <div class="bank-tags-page__guard" hidden><div class="bank-tags-page__guard-card"></div></div>`;
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

  it("shows the help dialog and supports its keyboard shortcuts", () => {
    const save = vi.spyOn(page, "save").mockImplementation(() => {});
    const help = page.querySelector(".bank-tags-page__help");

    page.handleKeyDown({ key: "?", target: document.body, preventDefault: vi.fn() });
    expect(help.hidden).toBe(false);

    page.handleKeyDown({ key: "s", ctrlKey: true, metaKey: false, target: document.body, preventDefault: vi.fn() });
    expect(save).toHaveBeenCalledOnce();

    page.handleKeyDown({ key: "Escape", target: document.body });
    expect(help.hidden).toBe(true);
  });

  it("renders removal controls for items placed in the layout", () => {
    const html = page.slot(199, 0);
    expect(html).toContain('data-remove-id="199"');
    expect(html).toContain("Remove Item 199 from tag");
  });

  it("removes an item from the tag and every matching layout slot", () => {
    page.innerHTML += '<button data-remove-id="199"></button>';
    const render = vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    page.handleClick({ target: page.querySelector("[data-remove-id]") });

    expect(page.selectedTag().itemIds).toEqual([201]);
    expect(page.selectedTag().layout).toEqual([-1, -1, 201]);
    expect(render).toHaveBeenCalledOnce();
  });

  it("creates a new synchronized tab only after the guard form is submitted", async () => {
    const tagId = "0d32b760-2450-44cf-8b83-169e16e16cd0";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(tagId);
    page.openCreateGuard();
    page.querySelector(".bank-tags-page__create-name").value = "Bossing";
    page.querySelector(".bank-tags-page__create-icon").value = "4151";
    page.request = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      tagId,
      name: "bossing",
      iconItemId: 4151,
      itemIds: [],
      layout: [],
      revision: 1,
      deleted: false,
    });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    await page.createTag();

    expect(page.request).toHaveBeenCalledWith(`/bank-tags/${tagId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        tagId,
        name: "bossing",
        iconItemId: 4151,
        itemIds: [],
        layout: [],
      }),
    });
    expect(page.selectedTagId).toBe(tagId);
  });

  it("requires the exact tag name before deleting a synchronized tab", async () => {
    const tagId = page.selectedTagId;
    page.openDeleteGuard();
    page.querySelector(".bank-tags-page__delete-confirm").value = "wrong";
    page.request = vi.fn();

    await page.deleteTag();
    expect(page.request).not.toHaveBeenCalled();
    expect(page.querySelector(".bank-tags-page__status").textContent).toContain("Deletion blocked");

    page.querySelector(".bank-tags-page__delete-confirm").value = "herblore";
    page.request.mockResolvedValue({ deleted: true });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});
    await page.deleteTag();

    expect(page.request).toHaveBeenCalledWith(`/bank-tags/${tagId}`, {
      method: "DELETE",
      headers: { "If-Match": '"7"' },
    });
    expect(page.tags.size).toBe(0);
  });

  it("lists historical revisions and previews one as an unsaved draft", async () => {
    page.request = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        tagId: page.selectedTagId,
        revisions: [
          { revision: 7, itemCount: 2, layoutCount: 3, deleted: false, updatedAt: "2026-09-10T15:00:00Z" },
          { revision: 3, itemCount: 1, layoutCount: 1, deleted: false, updatedAt: "2026-09-10T14:00:00Z" },
        ],
      })
      .mockResolvedValueOnce({ name: "old herbs", iconItemId: 4151, itemIds: [199], layout: [199] });

    await page.openHistory();
    expect(page.querySelector(".bank-tags-page__revisions").textContent).toContain("Revision 3");
    await page.viewRevision(3);

    expect(page.selectedTag()).toMatchObject({
      name: "old herbs",
      iconItemId: 4151,
      itemIds: [199],
      layout: [199],
      revision: 7,
    });
    expect(page.querySelector(".bank-tags-page__status").textContent).toContain("unsaved draft");
  });

  it("requires the exact tag name and current revision to restore history", async () => {
    page.openRestoreGuard(3);
    page.request = vi.fn();
    await page.restoreRevision(3);
    expect(page.request).not.toHaveBeenCalled();

    page.querySelector(".bank-tags-page__restore-confirm").value = "herblore";
    page.request.mockResolvedValue({ ...page.selectedTag(), revision: 8, itemIds: [199], layout: [199] });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});
    await page.restoreRevision(3);

    expect(page.request).toHaveBeenCalledWith(`/bank-tags/${page.selectedTagId}/revisions/3/restore`, {
      method: "POST",
      headers: { "If-Match": '"7"' },
    });
    expect(page.selectedTag().revision).toBe(8);
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
