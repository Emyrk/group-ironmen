import { BaseElement } from "../base-element/base-element";
import { Item } from "../data/item";
import { storage } from "../data/storage";

const SCHEMA_VERSION = 1;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

export class InventorySetupsPage extends BaseElement {
  constructor() {
    super();
    this.setups = new Map();
    this.sections = new Map();
    this.setupOrder = [];
    this.sectionOrder = [];
    this.groupRevision = 0;
    this.setupOrderRevision = 0;
    this.sectionOrderRevision = 0;
    this.selectedSetupId = null;
    this.selectedSectionId = null;
    this.collapsedSections = new Set();
  }

  html() {
    return `{{inventory-setups-page.html}}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();
    this.eventListener(this, "click", this.handleClick.bind(this));
    this.eventListener(this, "input", this.handleInput.bind(this));
    this.load();
  }

  credentials() {
    const { groupName, groupToken } = storage.getGroup();
    return { groupName, groupToken, base: `/api/group/${encodeURIComponent(groupName)}` };
  }

  async request(path, options = {}) {
    const { groupToken, base } = this.credentials();
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { Authorization: groupToken, ...options.headers },
    });
    if (!response.ok) {
      let body = {};
      try {
        body = await response.json();
      } catch {
        // Preserve the HTTP status when the response has no JSON body.
      }
      const failure = new Error(body.message || `HTTP ${response.status}`);
      failure.status = response.status;
      failure.code = body.error;
      failure.current = body.current;
      throw failure;
    }
    return response.json();
  }

  async load(preferredSetupId = this.selectedSetupId, preferredSectionId = this.selectedSectionId) {
    this.setStatus("Loading synchronized inventory setups…");
    try {
      const manifest = await this.request("/inventory-setups");
      const [setupDocuments, sectionDocuments] = await Promise.all([
        Promise.all(manifest.orderedSetupIds.map((id) => this.request(`/inventory-setups/${id}`))),
        Promise.all(manifest.orderedSectionIds.map((id) => this.request(`/inventory-setup-sections/${id}`))),
      ]);
      this.setups = new Map(setupDocuments.filter((setup) => !setup.deleted).map((setup) => [setup.setupId, setup]));
      this.sections = new Map(
        sectionDocuments.filter((section) => !section.deleted).map((section) => [section.sectionId, section])
      );
      this.setupOrder = manifest.orderedSetupIds.filter((id) => this.setups.has(id));
      this.sectionOrder = manifest.orderedSectionIds.filter((id) => this.sections.has(id));
      this.groupRevision = manifest.groupRevision;
      this.setupOrderRevision = manifest.setupOrderRevision;
      this.sectionOrderRevision = manifest.sectionOrderRevision;
      this.loadCollapsedSections();
      if (this.setups.has(preferredSetupId)) this.selectSetup(preferredSetupId, false);
      else if (this.sections.has(preferredSectionId)) this.selectSection(preferredSectionId, false);
      else if (this.setupOrder.length) this.selectSetup(this.setupOrder[0], false);
      else if (this.sectionOrder.length) this.selectSection(this.sectionOrder[0], false);
      this.renderList();
      this.renderEditor();
      this.setStatus(
        `${this.setups.size} setup${this.setups.size === 1 ? "" : "s"} in ${this.sections.size} section${
          this.sections.size === 1 ? "" : "s"
        }.`
      );
    } catch (failure) {
      this.setStatus(`Unable to load inventory setups: ${failure.message}`, true);
    }
  }

  collapsedStorageKey(sectionId) {
    const { groupName } = this.credentials();
    return `inventory-setup-section-collapsed:${groupName || "unknown"}:${sectionId}`;
  }

  loadCollapsedSections() {
    this.collapsedSections = new Set(
      [...this.sections.keys()].filter(
        (sectionId) => localStorage.getItem(this.collapsedStorageKey(sectionId)) === "true"
      )
    );
  }

  saveCollapsedSection(sectionId) {
    const key = this.collapsedStorageKey(sectionId);
    if (this.collapsedSections.has(sectionId)) localStorage.setItem(key, "true");
    else localStorage.removeItem(key);
  }

  toggleSection(sectionId) {
    if (this.collapsedSections.has(sectionId)) this.collapsedSections.delete(sectionId);
    else this.collapsedSections.add(sectionId);
    this.saveCollapsedSection(sectionId);
    this.renderList();
  }

  selectedSetup() {
    return this.setups.get(this.selectedSetupId);
  }

  selectedSection() {
    return this.sections.get(this.selectedSectionId);
  }

  selectSetup(id, render = true) {
    this.selectedSetupId = id;
    this.selectedSectionId = null;
    if (render) {
      this.renderList();
      this.renderEditor();
    }
  }

  selectSection(id, render = true) {
    this.selectedSetupId = null;
    this.selectedSectionId = id;
    if (render) {
      this.renderList();
      this.renderEditor();
    }
  }

  sectionsContaining(setupId) {
    return [...this.sections.values()]
      .filter((section) => section.orderedSetupIds.includes(setupId))
      .map((section) => section.sectionId);
  }

  renderList() {
    const list = this.querySelector(".inventory-setups-page__list");
    if (!list) return;
    const sectioned = new Set();
    const sections = this.sectionOrder
      .map((id, index) => {
        const section = this.sections.get(id);
        if (!section) return "";
        const setupIds = section.orderedSetupIds.filter((setupId) => this.setups.has(setupId));
        setupIds.forEach((setupId) => sectioned.add(setupId));
        const collapsed = this.collapsedSections.has(id);
        return `<li class="inventory-setups-page__section">
        <div class="inventory-setups-page__row">
          <button type="button" data-toggle-section="${id}" aria-expanded="${!collapsed}">${
          collapsed ? "▸" : "▾"
        }</button>
          <button type="button" class="${id === this.selectedSectionId ? "active" : ""}" data-select-section="${id}">
            <span class="inventory-setups-page__color" style="background:${this.colorCss(
              section.displayColor
            )}"></span>${this.escape(section.name)}
          </button>
          ${this.orderButtons("section", id, index, this.sectionOrder.length)}
        </div>
        ${collapsed ? "" : `<ul>${setupIds.map((setupId) => this.setupListItem(setupId, true)).join("")}</ul>`}
      </li>`;
      })
      .join("");
    const unsectioned = this.setupOrder.filter((id) => !sectioned.has(id));
    const allSetups = `<li><strong>All setups</strong><ul>${this.setupOrder
      .map((id, index) => this.setupListItem(id, false, index))
      .join("")}</ul></li>`;
    const unsectionedHtml = unsectioned.length
      ? `<li><strong>Unsectioned</strong><ul>${unsectioned
          .map((id) => this.setupListItem(id, true))
          .join("")}</ul></li>`
      : "";
    list.innerHTML = `${sections}${unsectionedHtml}${allSetups}`;
  }

  setupListItem(id, nested, index = null) {
    const setup = this.setups.get(id);
    if (!setup) return "";
    return `<li class="inventory-setups-page__row ${nested ? "nested" : ""}">
      <button type="button" class="${
        id === this.selectedSetupId ? "active" : ""
      }" data-select-setup="${id}">${this.escape(setup.name)}</button>
      ${index === null ? "" : this.orderButtons("setup", id, index, this.setupOrder.length)}
    </li>`;
  }

  orderButtons(kind, id, index, length) {
    return `<span class="inventory-setups-page__order">
      <button type="button" data-move-${kind}="${id}" data-direction="-1" ${
      index === 0 ? "disabled" : ""
    } aria-label="Move up">↑</button>
      <button type="button" data-move-${kind}="${id}" data-direction="1" ${
      index === length - 1 ? "disabled" : ""
    } aria-label="Move down">↓</button>
    </span>`;
  }

  renderEditor() {
    const editor = this.querySelector(".inventory-setups-page__editor");
    if (!editor) return;
    const setup = this.selectedSetup();
    if (setup) {
      editor.innerHTML = `<h3>Edit setup</h3>
        <label>Name<input data-field="name" value="${this.escapeAttribute(setup.name)}"></label>
        <label>Shared notes<textarea data-field="notes" rows="4">${this.escape(setup.notes)}</textarea></label>
        <label>Canonical JSON payload<textarea data-field="payload" rows="12">${this.escape(
          JSON.stringify(canonicalValue(setup.payload), null, 2)
        )}</textarea></label>
        <h4>Inventory</h4><div class="inventory-setups-page__grid" data-grid="inventory">${this.itemGrid(
          setup.payload.inventory
        )}</div>
        <h4>Equipment</h4><div class="inventory-setups-page__grid inventory-setups-page__grid--equipment" data-grid="equipment">${this.itemGrid(
          setup.payload.equipment
        )}</div>
        <div class="inventory-setups-page__actions">
          <button class="men-button small" type="button" data-action="save-setup">Save setup</button>
          <button class="men-button small danger" type="button" data-action="delete-setup">Delete setup</button>
        </div>`;
      return;
    }
    const section = this.selectedSection();
    if (section) {
      editor.innerHTML = `<h3>Edit section</h3>
        <label>Name<input data-field="section-name" value="${this.escapeAttribute(section.name)}"></label>
        <label>Display color (signed ARGB integer or blank)<input data-field="display-color" type="number" value="${
          section.displayColor ?? ""
        }"></label>
        <h4>Ordered setup membership</h4>
        <ol class="inventory-setups-page__members">${section.orderedSetupIds
          .filter((id) => this.setups.has(id))
          .map(
            (id, index) =>
              `<li>${this.escape(this.setups.get(id).name)}${this.orderButtons(
                "member",
                id,
                index,
                section.orderedSetupIds.length
              )}<button type="button" data-remove-member="${id}">Remove</button></li>`
          )
          .join("")}</ol>
        <label>Add setup<select data-field="add-member"><option value="">Choose…</option>${this.setupOrder
          .filter((id) => !section.orderedSetupIds.includes(id))
          .map((id) => `<option value="${id}">${this.escape(this.setups.get(id).name)}</option>`)
          .join("")}</select></label>
        <div class="inventory-setups-page__actions">
          <button class="men-button small" type="button" data-action="save-section">Save section</button>
          <button class="men-button small danger" type="button" data-action="delete-section">Delete section</button>
        </div>`;
      return;
    }
    editor.innerHTML = "<p>Select a setup or section.</p>";
  }

  itemGrid(items) {
    if (!Array.isArray(items) || !items.length)
      return '<p class="inventory-setups-page__empty-grid">No items in payload.</p>';
    return items
      .map((item) => {
        const id = this.itemId(item);
        if (!Number.isInteger(id) || id <= 0) return '<span class="inventory-setups-page__slot"></span>';
        const quantity = typeof item === "object" ? item.quantity ?? item.qty ?? 1 : 1;
        return `<span class="inventory-setups-page__slot"><img src="${Item.imageUrl(
          id,
          quantity
        )}" alt="Item ${id}" loading="lazy"><small>${quantity > 1 ? quantity : ""}</small></span>`;
      })
      .join("");
  }

  itemId(item) {
    if (Number.isInteger(item)) return item;
    if (!item || typeof item !== "object") return null;
    return [item.id, item.itemId, item.item_id].find(Number.isInteger) ?? null;
  }

  colorCss(value) {
    if (value === null || value === undefined) return "transparent";
    const unsigned = value >>> 0;
    return `#${(unsigned & 0xffffff).toString(16).padStart(6, "0")}`;
  }

  handleInput(event) {
    if (event.target.matches("[data-field='add-member']") && event.target.value) {
      const section = this.selectedSection();
      if (!section.orderedSetupIds.includes(event.target.value)) section.orderedSetupIds.push(event.target.value);
      this.renderEditor();
    }
  }

  handleClick(event) {
    const button = event.target.closest("button, a");
    if (!button) return;
    if (button.dataset.selectSetup) return this.selectSetup(button.dataset.selectSetup);
    if (button.dataset.selectSection) return this.selectSection(button.dataset.selectSection);
    if (button.dataset.toggleSection) return this.toggleSection(button.dataset.toggleSection);
    if (button.dataset.moveSetup)
      return this.moveGlobal("setup", button.dataset.moveSetup, Number(button.dataset.direction));
    if (button.dataset.moveSection)
      return this.moveGlobal("section", button.dataset.moveSection, Number(button.dataset.direction));
    if (button.dataset.moveMember) return this.moveMember(button.dataset.moveMember, Number(button.dataset.direction));
    if (button.dataset.removeMember) {
      const section = this.selectedSection();
      section.orderedSetupIds = section.orderedSetupIds.filter((id) => id !== button.dataset.removeMember);
      return this.renderEditor();
    }
    const actions = {
      refresh: () => this.load(),
      "new-setup": () => this.createSetup(),
      "new-section": () => this.createSection(),
      "save-setup": () => this.saveSetup(),
      "save-section": () => this.saveSection(),
      "delete-setup": () => this.deleteSetup(),
      "delete-section": () => this.deleteSection(),
    };
    if (actions[button.dataset.action]) actions[button.dataset.action]();
  }

  async createSetup() {
    const setupId = crypto.randomUUID();
    try {
      const saved = await this.request(`/inventory-setups/${setupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-None-Match": "*" },
        body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, setupId, name: "New setup", notes: "", payload: {} }),
      });
      this.setups.set(setupId, saved);
      this.setupOrder.push(setupId);
      this.groupRevision += 1;
      this.setupOrderRevision += 1;
      this.selectedSetupId = setupId;
      this.selectedSectionId = null;
      this.renderList();
      this.renderEditor();
    } catch (failure) {
      this.setStatus(`Unable to create setup: ${failure.message}`, true);
    }
  }

  async createSection() {
    const sectionId = crypto.randomUUID();
    try {
      const saved = await this.request(`/inventory-setup-sections/${sectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-None-Match": "*" },
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sectionId,
          name: "New section",
          displayColor: null,
          orderedSetupIds: [],
        }),
      });
      this.sections.set(sectionId, saved);
      this.sectionOrder.push(sectionId);
      this.groupRevision += 1;
      this.sectionOrderRevision += 1;
      this.selectedSetupId = null;
      this.selectedSectionId = sectionId;
      this.renderList();
      this.renderEditor();
    } catch (failure) {
      this.setStatus(`Unable to create section: ${failure.message}`, true);
    }
  }

  async saveSetup() {
    const setup = this.selectedSetup();
    try {
      const payload = canonicalValue(JSON.parse(this.querySelector("[data-field='payload']").value));
      if (!payload || Array.isArray(payload) || typeof payload !== "object")
        throw new Error("payload must be a JSON object");
      const body = {
        schemaVersion: SCHEMA_VERSION,
        setupId: setup.setupId,
        name: this.querySelector("[data-field='name']").value,
        notes: this.querySelector("[data-field='notes']").value,
        payload,
      };
      const saved = await this.request(`/inventory-setups/${setup.setupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${setup.revision}"` },
        body: JSON.stringify(body),
      });
      this.setups.set(saved.setupId, saved);
      this.renderList();
      this.renderEditor();
      this.setStatus(`Saved setup revision ${saved.revision}.`);
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Save conflict. Your draft remains in the editor; refresh before retrying."
          : `Unable to save setup: ${failure.message}`,
        true
      );
    }
  }

  async saveSection() {
    const section = this.selectedSection();
    try {
      const colorText = this.querySelector("[data-field='display-color']")?.value ?? "";
      const body = {
        schemaVersion: SCHEMA_VERSION,
        sectionId: section.sectionId,
        name: this.querySelector("[data-field='section-name']")?.value ?? section.name,
        displayColor: colorText === "" ? null : Number(colorText),
        orderedSetupIds: [...section.orderedSetupIds],
      };
      const saved = await this.request(`/inventory-setup-sections/${section.sectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${section.revision}"` },
        body: JSON.stringify(body),
      });
      this.sections.set(saved.sectionId, saved);
      this.renderList();
      this.renderEditor();
      this.setStatus(`Saved section revision ${saved.revision}.`);
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Save conflict. Refresh before retrying."
          : `Unable to save section: ${failure.message}`,
        true
      );
    }
  }

  async deleteSetup() {
    const setup = this.selectedSetup();
    if (!setup || !window.confirm(`Delete shared setup “${setup.name}”?`)) return;
    try {
      await this.request(`/inventory-setups/${setup.setupId}`, {
        method: "DELETE",
        headers: { "If-Match": `"${setup.revision}"` },
      });
      await this.load();
    } catch (failure) {
      this.setStatus(`Unable to delete setup: ${failure.message}`, true);
    }
  }

  async deleteSection() {
    const section = this.selectedSection();
    if (!section || !window.confirm(`Delete shared section “${section.name}”?`)) return;
    try {
      await this.request(`/inventory-setup-sections/${section.sectionId}`, {
        method: "DELETE",
        headers: { "If-Match": `"${section.revision}"` },
      });
      localStorage.removeItem(this.collapsedStorageKey(section.sectionId));
      this.collapsedSections.delete(section.sectionId);
      await this.load();
    } catch (failure) {
      this.setStatus(`Unable to delete section: ${failure.message}`, true);
    }
  }

  async moveGlobal(kind, id, direction) {
    const order = kind === "setup" ? this.setupOrder : this.sectionOrder;
    const previous = [...order];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    try {
      kind === "setup" ? await this.saveSetupOrder() : await this.saveSectionOrder();
      this.renderList();
    } catch (failure) {
      if (kind === "setup") this.setupOrder = previous;
      else this.sectionOrder = previous;
      this.renderList();
      this.setStatus(
        failure.status === 409
          ? "Order conflict. The rejected order was restored; refresh before retrying."
          : `Unable to save order: ${failure.message}`,
        true
      );
    }
  }

  moveMember(id, direction) {
    const order = this.selectedSection().orderedSetupIds;
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.renderEditor();
  }

  async saveSetupOrder() {
    const manifest = await this.request("/inventory-setup-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": `"${this.setupOrderRevision}"` },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, orderedSetupIds: this.setupOrder }),
    });
    this.adoptManifest(manifest);
  }

  async saveSectionOrder() {
    const manifest = await this.request("/inventory-setup-section-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": `"${this.sectionOrderRevision}"` },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, orderedSectionIds: this.sectionOrder }),
    });
    this.adoptManifest(manifest);
  }

  adoptManifest(manifest) {
    this.groupRevision = manifest.groupRevision;
    this.setupOrderRevision = manifest.setupOrderRevision;
    this.sectionOrderRevision = manifest.sectionOrderRevision;
    this.setupOrder = manifest.orderedSetupIds.filter((id) => this.setups.has(id));
    this.sectionOrder = manifest.orderedSectionIds.filter((id) => this.sections.has(id));
  }

  setStatus(message, error = false) {
    const status = this.querySelector(".inventory-setups-page__status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("inventory-setups-page__status--error", error);
  }

  escapeAttribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  escape(value) {
    const element = document.createElement("span");
    element.textContent = value ?? "";
    return element.innerHTML;
  }
}

customElements.define("inventory-setups-page", InventorySetupsPage);
