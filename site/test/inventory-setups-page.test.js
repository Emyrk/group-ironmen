import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/item", () => ({
  Item: { itemDetails: {}, imageUrl: (id) => `/icons/items/${id}.webp` },
}));

vi.mock("../src/data/storage", () => ({
  storage: { getGroup: () => ({ groupName: "group", groupToken: "token" }) },
}));

import { InventorySetupsPage } from "../src/inventory-setups-page/inventory-setups-page";

const setupId = "5e4a8e36-e5f4-4daa-ae7a-e510f3e66721";
const secondSetupId = "f40c4538-b158-4c1c-9c8a-7d930886bc96";
const sectionId = "874dfb26-63b8-42f1-80a2-01a2a7c7779d";

function setupDocument(id = setupId) {
  return {
    schemaVersion: 1,
    setupId: id,
    name: id === setupId ? "Zulrah" : "Barrows",
    notes: "Bring food",
    payload: {
      inventory: [{ id: 385, quantity: 10 }, 12934],
      equipment: [{ itemId: 4151 }],
    },
    revision: 4,
    deleted: false,
    updatedAt: "2026-09-11T00:00:00Z",
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

  it("renders inventory and equipment item sprites from the JSON payload", () => {
    page.renderEditor();

    expect(page.querySelector('[data-grid="inventory"]').innerHTML).toContain("/icons/items/385.webp");
    expect(page.querySelector('[data-grid="inventory"]').innerHTML).toContain("/icons/items/12934.webp");
    expect(page.querySelector('[data-grid="equipment"]').innerHTML).toContain("/icons/items/4151.webp");
  });

  it("saves shared notes and canonical JSON with the setup revision", async () => {
    page.renderEditor();
    page.querySelector("[data-field='name']").value = "Zulrah learner";
    page.querySelector("[data-field='notes']").value = "Two recoils";
    page.querySelector("[data-field='payload']").value = '{"equipment":[4151],"inventory":[385]}';
    const request = vi.spyOn(page, "request").mockResolvedValue({
      ...setupDocument(),
      name: "Zulrah learner",
      notes: "Two recoils",
      revision: 5,
    });

    await page.saveSetup();

    const [path, options] = request.mock.calls[0];
    expect(path).toBe(`/inventory-setups/${setupId}`);
    expect(options.headers["If-Match"]).toBe('"4"');
    expect(JSON.parse(options.body)).toMatchObject({
      setupId,
      name: "Zulrah learner",
      notes: "Two recoils",
      payload: { equipment: [4151], inventory: [385] },
    });
  });

  it("stores collapsed sections locally without transmitting isMaximized", async () => {
    page.renderList();
    page.toggleSection(sectionId);

    expect(JSON.parse(localStorage.getItem("inventory-setup-sections-collapsed:group"))).toEqual([sectionId]);
    page.selectedSectionId = sectionId;
    const request = vi.spyOn(page, "request").mockResolvedValue({ ...sectionDocument(), revision: 4 });
    await page.saveSection();

    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.orderedSetupIds).toEqual([setupId, secondSetupId]);
    expect(body).not.toHaveProperty("isMaximized");
  });

  it("allows a setup to remain in multiple sections", () => {
    const otherSection = { ...sectionDocument(), sectionId: "a8691e24-56a0-4fb7-bfd1-04feca5b449a" };
    page.sections.set(otherSection.sectionId, otherSection);

    expect(page.sectionsContaining(setupId)).toEqual([sectionId, otherSection.sectionId]);
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
    expect(page.setupOrderRevision).toBe(1);
    expect(saveOrder).not.toHaveBeenCalled();
  });
});
