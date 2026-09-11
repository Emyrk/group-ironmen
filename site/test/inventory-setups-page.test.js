import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/item", () => ({
  Item: { itemDetails: {}, imageUrl: (id) => `/icons/items/${id}.webp` },
}));

vi.mock("../src/data/storage", () => ({
  storage: { getGroup: () => ({ groupName: "group", groupToken: "token" }) },
}));

import { InventorySetupsPage } from "../src/inventory-setups-page/inventory-setups-page";
import pluginSetupFixture from "./fixtures/inventory-setups/v3/setup.json";

const setupId = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
const secondSetupId = "f40c4538-b158-4c1c-9c8a-7d930886bc96";
const sectionId = "874dfb26-63b8-42f1-80a2-01a2a7c7779d";
const secondSectionId = "a8691e24-56a0-4fb7-bfd1-04feca5b449a";

function setupDocument(id = setupId) {
  return {
    ...structuredClone(pluginSetupFixture),
    setupId: id,
    name: id === setupId ? "Zulrah" : "Barrows",
    notes: "Bring food",
    revision: 4,
  };
}

function sectionDocument() {
  return {
    schemaVersion: 1,
    sectionId,
    name: "Bossing",
    displayColor: -65536,
    orderedSetupIds: [setupId, secondSetupId],
    revision: 3,
    deleted: false,
    updatedAt: "2026-09-11T00:00:00Z",
  };
}

describe("inventory setups page", () => {
  let page;

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    page = new InventorySetupsPage();
    page.innerHTML = `<p class="inventory-setups-page__status"></p>
      <ul class="inventory-setups-page__list"></ul>
      <main class="inventory-setups-page__editor"></main>`;
    page.setups.set(setupId, setupDocument());
    page.setups.set(secondSetupId, setupDocument(secondSetupId));
    page.sections.set(sectionId, sectionDocument());
    page.setupOrder = [setupId, secondSetupId];
    page.sectionOrder = [sectionId];
    page.selectedSetupId = setupId;
  });

  it("loads the combined manifest and documents in their global order", async () => {
    page.setups.clear();
    page.sections.clear();
    page.setupOrder = [];
    page.sectionOrder = [];
    const manifest = {
      schemaVersion: 1,
      groupRevision: 9,
      setupOrderRevision: 5,
      sectionOrderRevision: 4,
      orderedSetupIds: [secondSetupId, setupId],
      orderedSectionIds: [sectionId],
      setups: [],
      sections: [],
    };
    const request = vi.spyOn(page, "request").mockImplementation(async (path) => {
      if (path === "/inventory-setups") return manifest;
      if (path === `/inventory-setups/${setupId}`) return setupDocument();
      if (path === `/inventory-setups/${secondSetupId}`) return setupDocument(secondSetupId);
      if (path === `/inventory-setup-sections/${sectionId}`) return sectionDocument();
      throw new Error(`unexpected request: ${path}`);
    });

    await page.load(null, null);

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/inventory-setups",
      `/inventory-setups/${secondSetupId}`,
      `/inventory-setups/${setupId}`,
      `/inventory-setup-sections/${sectionId}`,
    ]);
    expect(page.setupOrder).toEqual([secondSetupId, setupId]);
    expect(page.sectionOrder).toEqual([sectionId]);
    expect(page.selectedSetupId).toBe(secondSetupId);
    expect(page.groupRevision).toBe(9);
    expect(page.querySelector(".inventory-setups-page__list").textContent).toContain("Bossing");
    expect(page.querySelector(".inventory-setups-page__status").textContent).toBe("2 setups in 1 section.");
  });

  it("loads the plugin v3 fixture and renders compact inventory and equipment items", () => {
    page.renderEditor();

    const inventory = page.querySelector('[data-grid="inventory"]').innerHTML;
    const equipment = page.querySelector('[data-grid="equipment"]').innerHTML;
    expect(inventory).toContain("/icons/items/385.webp");
    expect(inventory).toContain("/icons/items/12934.webp");
    expect(inventory).toContain("<small>8</small>");
    expect(equipment).toContain("/icons/items/11864.webp");
    expect(equipment).toContain("/icons/items/4151.webp");
  });

  it("round-trips the compact plugin payload exactly when editing shared name and notes", async () => {
    const expectedPayload = {
      ...structuredClone(pluginSetupFixture.payload),
      zz: { enabled: true, mode: "future-compact-option" },
    };
    page.setups.get(setupId).payload = expectedPayload;
    page.renderEditor();
    page.querySelector("[data-field='name']").value = "Zulrah learner";
    page.querySelector("[data-field='notes']").value = "Two recoils";
    const request = vi.spyOn(page, "request").mockResolvedValue({
      ...setupDocument(),
      name: "Zulrah learner",
      notes: "Two recoils",
      revision: 5,
    });

    await page.saveSetup();

    const [path, options] = request.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(path).toBe(`/inventory-setups/${setupId}`);
    expect(options.headers["If-Match"]).toBe('"4"');
    expect(body.name).toBe("Zulrah learner");
    expect(body.notes).toBe("Two recoils");
    expect(body.payload).toEqual(expectedPayload);
    expect(body.payload).not.toHaveProperty("inventory");
    expect(body.payload).not.toHaveProperty("equipment");
    expect(body.payload.zz).toEqual({ enabled: true, mode: "future-compact-option" });
  });

  it("stores expansion state by group and section without transmitting it", async () => {
    const storageKey = `inventory-setup-section-collapsed:group:${sectionId}`;
    page.renderList();
    page.toggleSection(sectionId);

    expect(localStorage.getItem(storageKey)).toBe("true");
    page.collapsedSections.clear();
    page.loadCollapsedSections();
    expect(page.collapsedSections.has(sectionId)).toBe(true);

    page.selectSection(sectionId);
    const request = vi.spyOn(page, "request").mockResolvedValue({ ...sectionDocument(), revision: 4 });
    await page.saveSection();

    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.orderedSetupIds).toEqual([setupId, secondSetupId]);
    expect(body).not.toHaveProperty("isMaximized");

    page.toggleSection(sectionId);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("adds a setup to another section without removing its existing membership", async () => {
    const otherSection = {
      ...sectionDocument(),
      sectionId: secondSectionId,
      name: "Favorites",
      orderedSetupIds: [],
    };
    page.sections.set(secondSectionId, otherSection);
    page.sectionOrder.push(secondSectionId);
    page.selectSection(secondSectionId);
    const addMember = page.querySelector("[data-field='add-member']");
    addMember.value = setupId;
    page.handleInput({ target: addMember });
    const request = vi.spyOn(page, "request").mockResolvedValue({
      ...otherSection,
      orderedSetupIds: [setupId],
      revision: 4,
    });

    await page.saveSection();

    expect(JSON.parse(request.mock.calls[0][1].body).orderedSetupIds).toEqual([setupId]);
    expect(page.sectionsContaining(setupId)).toEqual([sectionId, secondSectionId]);
    expect(page.sections.get(sectionId).orderedSetupIds).toEqual([setupId, secondSetupId]);
  });

  it("saves complete setup and section orders with independent revisions", async () => {
    page.sections.set(secondSectionId, {
      ...sectionDocument(),
      sectionId: secondSectionId,
      name: "Favorites",
      orderedSetupIds: [setupId],
    });
    page.sectionOrder = [sectionId, secondSectionId];
    page.setupOrderRevision = 7;
    page.sectionOrderRevision = 11;
    const request = vi
      .spyOn(page, "request")
      .mockResolvedValueOnce({
        groupRevision: 12,
        setupOrderRevision: 8,
        sectionOrderRevision: 11,
        orderedSetupIds: [secondSetupId, setupId],
        orderedSectionIds: [sectionId, secondSectionId],
      })
      .mockResolvedValueOnce({
        groupRevision: 13,
        setupOrderRevision: 8,
        sectionOrderRevision: 12,
        orderedSetupIds: [secondSetupId, setupId],
        orderedSectionIds: [secondSectionId, sectionId],
      });

    await page.moveGlobal("setup", secondSetupId, -1);
    await page.moveGlobal("section", secondSectionId, -1);

    expect(request.mock.calls[0][0]).toBe("/inventory-setup-order");
    expect(request.mock.calls[0][1].headers["If-Match"]).toBe('"7"');
    expect(JSON.parse(request.mock.calls[0][1].body).orderedSetupIds).toEqual([secondSetupId, setupId]);
    expect(request.mock.calls[1][0]).toBe("/inventory-setup-section-order");
    expect(request.mock.calls[1][1].headers["If-Match"]).toBe('"11"');
    expect(JSON.parse(request.mock.calls[1][1].body).orderedSectionIds).toEqual([secondSectionId, sectionId]);
    expect(page.setupOrder).toEqual([secondSetupId, setupId]);
    expect(page.sectionOrder).toEqual([secondSectionId, sectionId]);
  });

  it("restores the accepted global order after a stale-order conflict", async () => {
    page.renderList();
    const failure = Object.assign(new Error("stale"), { status: 409 });
    vi.spyOn(page, "saveSetupOrder").mockRejectedValue(failure);

    await page.moveGlobal("setup", secondSetupId, -1);

    expect(page.setupOrder).toEqual([setupId, secondSetupId]);
    expect(page.querySelector(".inventory-setups-page__status").textContent).toContain("Order conflict");
  });

  it("creates stable IDs with If-None-Match", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("a8691e24-56a0-4fb7-bfd1-04feca5b449a");
    const request = vi.spyOn(page, "request").mockResolvedValue({
      ...setupDocument("a8691e24-56a0-4fb7-bfd1-04feca5b449a"),
      name: "New setup",
      revision: 1,
    });
    const saveOrder = vi.spyOn(page, "saveSetupOrder").mockResolvedValue();

    await page.createSetup();

    expect(request.mock.calls[0][0]).toBe("/inventory-setups/a8691e24-56a0-4fb7-bfd1-04feca5b449a");
    expect(request.mock.calls[0][1].headers["If-None-Match"]).toBe("*");
    expect(JSON.parse(request.mock.calls[0][1].body).payload).toEqual({
      inv: [],
      eq: [],
      rp: null,
      bp: null,
      qv: null,
      afi: {},
      hc: -65536,
    });
    expect(page.setupOrderRevision).toBe(1);
    expect(saveOrder).not.toHaveBeenCalled();
  });
});
