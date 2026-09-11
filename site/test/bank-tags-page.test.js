import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/item", () => ({
  Item: { itemDetails: {}, imageUrl: (id) => `/icons/items/${id}.webp` },
}));

import { Item } from "../src/data/item";
import { BankTagsPage } from "../src/bank-tags-page/bank-tags-page";

const secondTagId = "f40c4538-b158-4c1c-9c8a-7d930886bc96";
const folderId = "874dfb26-63b8-42f1-80a2-01a2a7c7779d";
const secondFolderId = "a8691e24-56a0-4fb7-bfd1-04feca5b449a";

describe("bank tags page", () => {
  let page;
  beforeEach(() => {
    Item.itemDetails = {
      113: { name: "Strength potion(4)" },
      119: { name: "Strength potion(1)" },
      121: { name: "Attack potion(4)" },
      199: { name: "Grimy guam leaf" },
      201: { name: "Grimy marrentill" },
      4151: { name: "Abyssal whip" },
      12006: { name: "Abyssal tentacle" },
    };
    page = new BankTagsPage();
    page.innerHTML = `<button class="bank-tags-page__help-button"></button>
      <p class="bank-tags-page__status"></p><ul class="bank-tags-page__list"></ul><main class="bank-tags-page__editor"></main>
      <div class="bank-tags-page__explorer" hidden><div class="bank-tags-page__explorer-card"><p class="bank-tags-page__explorer-purpose"></p><button class="bank-tags-page__explorer-close"></button><input class="bank-tags-page__explorer-search"><div class="bank-tags-page__explorer-results"></div></div></div>
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
    expect(html).toContain("Remove Grimy guam leaf from tag");
  });

  it("removes an item from the tag and every matching layout slot", () => {
    page.innerHTML += '<button data-remove-id="199"></button>';
    const render = vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    page.handleClick({ target: page.querySelector("[data-remove-id]") });

    expect(page.selectedTag().itemIds).toEqual([201]);
    expect(page.selectedTag().layout).toEqual([-1, -1, 201]);
    expect(render).toHaveBeenCalledOnce();
  });

  it("renders unplaced tagged items above the layout", () => {
    page.renderEditor();
    const editor = page.querySelector(".bank-tags-page__editor");
    expect(editor.innerHTML.indexOf("Tagged items not in the layout")).toBeLessThan(
      editor.innerHTML.indexOf("<h3>Layout</h3>")
    );
  });

  it("treats a placed concrete variant as its tagged variation group", () => {
    page.selectedTag().itemIds = [-113];
    page.selectedTag().layout = [-1, 119];

    page.renderEditor();

    expect(page.querySelector(".bank-tags-page__unplaced").textContent).toContain("Every tagged item is placed.");
    expect(page.querySelector('[data-unplaced-id="-113"]')).toBeNull();
  });

  it("keeps a variation group unplaced when the layout contains an unrelated item", () => {
    page.selectedTag().itemIds = [-113];
    page.selectedTag().layout = [121];

    page.renderEditor();

    expect(page.querySelector('[data-unplaced-id="-113"]')).not.toBeNull();
  });

  it("renders variation groups with a representative item name and image", () => {
    expect(page.itemName(-113)).toBe("All variants of Strength potion(4)");
    expect(page.itemImage(-113)).toContain("/icons/items/113.webp");
    expect(page.itemTile(-113)).toContain("-113");
  });

  it("renders placeholder layout IDs using their canonical item", () => {
    Item.itemDetails[11850] = { name: "Graceful hood" };

    expect(page.itemName(18208)).toBe("Graceful hood");
    expect(page.itemImage(18208)).toContain("/icons/items/11850.webp");
  });

  it("removes equivalent tagged and layout variants together", () => {
    page.selectedTag().itemIds = [1755, 201];
    page.selectedTag().layout = [28414, 201];
    page.innerHTML += '<button data-remove-id="28414"></button>';
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    page.handleClick({ target: page.querySelector('[data-remove-id="28414"]') });

    expect(page.selectedTag().itemIds).toEqual([201]);
    expect(page.selectedTag().layout).toEqual([-1, 201]);
  });

  it("searches partial item names in the modal explorer", () => {
    page.openExplorer();
    page.searchExplorer("abyssal");

    expect(page.explorerResults.map((item) => item.id)).toEqual([4151, 12006]);
    expect(page.querySelectorAll("[data-item-result]")).toHaveLength(2);
    expect(page.querySelector("[data-item-result='4151']").textContent).toContain("Abyssal whip");
  });

  it("opens a visual icon explorer for layout tabs with useful suggestions", () => {
    page.selectedTag().iconItemId = 199;
    page.renderEditor();

    page.handleClick({ target: page.querySelector('[data-action="choose-tag-icon"]') });

    expect(page.querySelector(".bank-tags-page__explorer").classList.contains("bank-tags-page__explorer--icons")).toBe(
      true
    );
    expect(page.explorerResults.slice(0, 2).map((item) => item.id)).toEqual([199, 201]);
    expect(page.querySelector('[data-item-result="199"]').textContent).toContain("Current icon");

    page.searchExplorer("a");
    expect(page.explorerResults.map((item) => item.id)).toContain(4151);
  });

  it("changes a layout tab icon without adding the icon item to the tag", () => {
    page.openTagIconExplorer();
    page.selectExplorerItem(4151);

    expect(page.selectedTag().iconItemId).toBe(4151);
    expect(page.selectedTag().itemIds).toEqual([199, 201]);
    expect(page.querySelector(".bank-tags-page__explorer").hidden).toBe(true);
    expect(page.querySelector(".bank-tags-page__status").textContent).toContain("tab icon");
  });

  it("places explorer selections into a clicked empty slot", () => {
    page.openExplorer(1);
    page.searchExplorer("whip");
    page.selectExplorerItem(4151);

    expect(page.selectedTag().itemIds).toEqual([199, 201, 4151]);
    expect(page.selectedTag().layout).toEqual([199, 4151, 201]);
    expect(page.querySelector(".bank-tags-page__explorer").hidden).toBe(true);
  });

  it("supports keyboard navigation and selection in the explorer", () => {
    page.openExplorer();
    const search = page.querySelector(".bank-tags-page__explorer-search");
    page.searchExplorer("abyssal");
    const preventDefault = vi.fn();

    page.handleKeyDown({ key: "ArrowDown", target: search, preventDefault });
    expect(page.explorerIndex).toBe(1);
    page.handleKeyDown({ key: "Enter", target: search, preventDefault });

    expect(page.selectedTag().itemIds).toEqual([199, 201, 12006]);
    expect(preventDefault).toHaveBeenCalledTimes(2);
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

  it("navigates folder children and keeps collapse state local", () => {
    page.tags.set(secondTagId, {
      ...page.selectedTag(),
      tagId: secondTagId,
      name: "bossing",
      iconItemId: 4151,
    });
    page.order = [page.selectedTagId, secondTagId];
    page.folders.set(folderId, {
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [page.selectedTagId],
      revision: 2,
      deleted: false,
    });
    page.folderOrder = [folderId];

    page.renderList();

    expect(page.querySelector(`[data-select-folder="${folderId}"]`).textContent).toContain("Supplies");
    expect(page.querySelector(".bank-tags-page__folder-tags").textContent).toContain("herblore");
    expect(page.querySelector(".bank-tags-page__list").textContent).toContain("bossing");

    page.handleClick({ target: page.querySelector(`[data-select-folder="${folderId}"]`) });
    expect(page.selectedFolderId).toBe(folderId);
    expect(page.selectedTagId).toBeNull();
    expect(page.querySelector(".bank-tags-page__editor").textContent).toContain("Folder settings");

    page.toggleFolderCollapse(folderId);
    expect(page.querySelector(".bank-tags-page__folder-tags").hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem(page.collapsedStorageKey()))).toEqual([folderId]);
  });

  it("creates an empty synchronized folder at the end of folder order", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(folderId);
    page.openCreateFolderGuard();
    page.querySelector(".bank-tags-page__create-folder-name").value = "Supplies";
    page.querySelector(".bank-tags-page__create-folder-icon").value = "199";
    page.request = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [],
      revision: 1,
      deleted: false,
    });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    await page.createFolder();

    expect(page.request).toHaveBeenCalledWith(`/bank-tag-folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        folderId,
        name: "Supplies",
        iconItemId: 199,
        orderedTagIds: [],
      }),
    });
    expect(page.folderOrder).toEqual([folderId]);
    expect(page.selectedFolderId).toBe(folderId);
    expect(page.selectedTagId).toBeNull();
  });

  it("assigns, orders, renames, and saves folder children with its revision", async () => {
    page.tags.set(secondTagId, {
      ...page.selectedTag(),
      tagId: secondTagId,
      name: "bossing",
      iconItemId: 4151,
    });
    page.order = [page.selectedTagId, secondTagId];
    page.folders.set(folderId, {
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [page.selectedTagId],
      revision: 4,
      deleted: false,
    });
    page.folderOrder = [folderId];
    page.selectedFolderId = folderId;
    page.selectedTagId = null;
    page.renderEditor();

    page.changeFolderTag(secondTagId, true);
    page.moveFolderTag(secondTagId, -1);
    const name = page.querySelector(".bank-tags-page__folder-name");
    name.value = "Shared supplies";
    page.handleInput({ target: name });
    page.request = vi.fn().mockResolvedValue({ ...page.selectedFolder(), revision: 5 });

    await page.saveFolder();

    expect(page.request).toHaveBeenCalledWith(`/bank-tag-folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": '"4"' },
      body: JSON.stringify({
        schemaVersion: 1,
        folderId,
        name: "Shared supplies",
        iconItemId: 199,
        orderedTagIds: [secondTagId, "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721"],
      }),
    });
    expect(page.selectedFolder().revision).toBe(5);
  });

  it("selects a folder icon from the item explorer", () => {
    page.folders.set(folderId, {
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [],
      revision: 1,
      deleted: false,
    });
    page.folderOrder = [folderId];
    page.selectedFolderId = folderId;
    page.selectedTagId = null;

    page.openFolderIconExplorer();
    page.searchExplorer("whip");
    page.selectExplorerItem(4151);

    expect(page.selectedFolder().iconItemId).toBe(4151);
    expect(page.querySelector(".bank-tags-page__explorer").hidden).toBe(true);
    expect(page.querySelector(".bank-tags-page__status").textContent).toContain("folder icon");
  });

  it("saves folder order with the manifest order revision", async () => {
    const folder = {
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [],
      revision: 1,
      deleted: false,
    };
    page.folders.set(folderId, folder);
    page.folders.set(secondFolderId, { ...folder, folderId: secondFolderId, name: "Combat" });
    page.folderOrder = [folderId, secondFolderId];
    page.folderOrderRevision = 6;
    page.folderGroupRevision = 8;
    page.selectedFolderId = folderId;
    page.selectedTagId = null;
    page.request = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      groupRevision: 9,
      orderRevision: 7,
      orderedFolderIds: [secondFolderId, folderId],
      folders: [],
    });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    await page.moveFolder(1);

    expect(page.request).toHaveBeenCalledWith("/bank-folder-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": '"6"' },
      body: JSON.stringify({ schemaVersion: 1, orderedFolderIds: [secondFolderId, folderId] }),
    });
    expect(page.folderOrder).toEqual([secondFolderId, folderId]);
  });

  it("dissolves a folder without deleting its tags", async () => {
    page.folders.set(folderId, {
      schemaVersion: 1,
      folderId,
      name: "Supplies",
      iconItemId: 199,
      orderedTagIds: [page.selectedTagId],
      revision: 3,
      deleted: false,
    });
    page.folderOrder = [folderId];
    page.selectedFolderId = folderId;
    page.selectedTagId = null;
    page.openDeleteFolderGuard();
    page.querySelector(".bank-tags-page__delete-folder-confirm").value = "Supplies";
    page.request = vi.fn().mockResolvedValue({ deleted: true });
    vi.spyOn(page, "renderList").mockImplementation(() => {});
    vi.spyOn(page, "renderEditor").mockImplementation(() => {});

    await page.deleteFolder();

    expect(page.request).toHaveBeenCalledWith(`/bank-tag-folders/${folderId}`, {
      method: "DELETE",
      headers: { "If-Match": '"3"' },
    });
    expect(page.folders.size).toBe(0);
    expect(page.tags.size).toBe(1);
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
