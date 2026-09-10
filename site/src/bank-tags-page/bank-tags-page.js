import { BaseElement } from "../base-element/base-element";
import { Item } from "../data/item";
import { storage } from "../data/storage";
import { exportBankLayouts, exportRuneLite, parseBankTag, validateDraft } from "./bank-tag-layout";

export class BankTagsPage extends BaseElement {
  constructor() {
    super();
    this.tags = new Map();
    this.selectedTagId = null;
    this.dragged = null;
  }

  html() {
    return `{{bank-tags-page.html}}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();
    this.eventListener(this, "click", this.handleClick.bind(this));
    this.eventListener(this, "input", this.handleInput.bind(this));
    this.eventListener(this, "dragstart", this.handleDragStart.bind(this));
    this.eventListener(this, "dragover", (event) => event.preventDefault(), { passive: false });
    this.eventListener(this, "drop", this.handleDrop.bind(this), { passive: false });
    this.eventListener(this, "dblclick", this.handleDoubleClick.bind(this));
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
      let body;
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      const failure = new Error(body.message || `HTTP ${response.status}`);
      failure.status = response.status;
      failure.code = body.error;
      failure.current = body.current;
      throw failure;
    }
    return response.json();
  }

  async load(preferredTagId = this.selectedTagId) {
    this.setStatus("Loading synchronized bank tags…");
    try {
      const manifest = await this.request("/bank-tags");
      const live = new Set(manifest.orderedTagIds);
      const documents = await Promise.all(manifest.orderedTagIds.map((id) => this.request(`/bank-tags/${id}`)));
      this.tags = new Map(
        documents.filter((tag) => !tag.deleted && live.has(tag.tagId)).map((tag) => [tag.tagId, tag])
      );
      this.order = manifest.orderedTagIds.filter((id) => this.tags.has(id));
      this.selectedTagId = this.tags.has(preferredTagId) ? preferredTagId : this.order[0] || null;
      this.renderList();
      this.renderEditor();
      this.setStatus(
        this.tags.size
          ? `${this.tags.size} synchronized tag${this.tags.size === 1 ? "" : "s"}`
          : "No synchronized bank tags yet."
      );
    } catch (failure) {
      this.setStatus(`Unable to load bank tags: ${failure.message}`, true);
    }
  }

  selectedTag() {
    return this.tags.get(this.selectedTagId);
  }

  renderList() {
    const list = this.querySelector(".bank-tags-page__list");
    list.innerHTML = this.order
      .map((id) => {
        const tag = this.tags.get(id);
        return `<li><button type="button" class="bank-tags-page__tag ${
          id === this.selectedTagId ? "active" : ""
        }" data-select-tag="${id}">${this.itemImage(tag.iconItemId, tag.name)}<span><strong>${this.escape(
          tag.name
        )}</strong><small>${tag.itemIds.length} items · revision ${tag.revision}</small></span></button></li>`;
      })
      .join("");
  }

  renderEditor() {
    const editor = this.querySelector(".bank-tags-page__editor");
    const tag = this.selectedTag();
    if (!tag) {
      editor.innerHTML = '<p class="bank-tags-page__empty">Select a synchronized bank tag.</p>';
      return;
    }
    const layout = tag.layout || [];
    const placed = new Set(layout.filter((id) => id > 0));
    const unplaced = tag.itemIds.filter((id) => !placed.has(id));
    const slots = [...layout, ...Array(Math.max(8, 8 - (layout.length % 8 || 8))).fill(-1)];
    editor.innerHTML = `
      <div class="bank-tags-page__fields">
        <label>Tag name<input class="bank-tags-page__name" maxlength="50" value="${this.escapeAttribute(
          tag.name
        )}"></label>
        <label>Icon item ID<input class="bank-tags-page__icon" type="number" min="0" value="${tag.iconItemId}"></label>
      </div>
      <div class="bank-tags-page__toolbar">
        <button class="men-button small" type="button" data-action="save">Save changes</button>
        <button class="men-button small" type="button" data-action="add-row">Add row</button>
        <button class="men-button small" type="button" data-action="trim">Trim empty rows</button>
        <button class="men-button small" type="button" data-action="export-runelite">Copy RuneLite export</button>
        <button class="men-button small" type="button" data-action="export-banklayouts">Copy BankLayouts export</button>
      </div>
      <div class="bank-tags-page__add-item">
        <label>Add item by ID or exact name<input class="bank-tags-page__item-search" placeholder="e.g. 4151 or Abyssal whip"></label>
        <button class="men-button small" type="button" data-action="add-item">Add item</button>
      </div>
      <section><h3>Layout</h3><p class="bank-tags-page__hint">Drag items to move or swap them. Double-click a slot to empty it.</p>
        <div class="bank-tags-page__grid">${slots.map((id, index) => this.slot(id, index)).join("")}</div>
      </section>
      <section><h3>Tagged items not in the layout</h3>
        <div class="bank-tags-page__unplaced">${
          unplaced
            .map(
              (id) =>
                `<div class="bank-tags-page__unplaced-item">${this.itemTile(
                  id,
                  `data-unplaced-id="${id}"`
                )}<button type="button" data-remove-id="${id}" title="Remove ${this.escapeAttribute(
                  this.itemName(id)
                )} from tag">×</button></div>`
            )
            .join("") || "<p>Every tagged item is placed.</p>"
        }</div>
      </section>
      <section class="bank-tags-page__import"><h3>Import</h3>
        <textarea class="bank-tags-page__import-text" rows="3" placeholder="Paste a RuneLite or BankLayouts export"></textarea>
        <button class="men-button small" type="button" data-action="import">Load into editor</button>
      </section>`;
  }

  itemName(id) {
    return Item.itemDetails?.[id]?.name || `Item ${id}`;
  }

  itemImage(id, alt = this.itemName(id)) {
    if (id <= 0 || !Item.itemDetails?.[id]) return `<span class="bank-tags-page__unknown">${id}</span>`;
    return `<img src="${Item.imageUrl(id, 1)}" alt="${this.escapeAttribute(alt)}" loading="lazy">`;
  }

  itemTile(id, attributes = "") {
    return `<button class="bank-tags-page__item" type="button" draggable="true" ${attributes} title="${this.escapeAttribute(
      this.itemName(id)
    )} (${id})">${this.itemImage(id)}<small>${id}</small></button>`;
  }

  slot(id, index) {
    return `<div class="bank-tags-page__slot" data-slot="${index}" title="${
      id > 0 ? `${this.escapeAttribute(this.itemName(id))} (${id})` : `Empty slot ${index + 1}`
    }">${id > 0 ? this.itemTile(id, `data-grid-index="${index}"`) : ""}</div>`;
  }

  handleClick(event) {
    const selected = event.target.closest("[data-select-tag]");
    if (selected) {
      this.selectedTagId = selected.dataset.selectTag;
      this.renderList();
      this.renderEditor();
      return;
    }
    if (event.target.closest(".bank-tags-page__refresh")) return this.load();
    const remove = event.target.closest("[data-remove-id]");
    if (remove) {
      const id = Number(remove.dataset.removeId);
      const tag = this.selectedTag();
      tag.itemIds = tag.itemIds.filter((itemId) => itemId !== id);
      tag.layout = (tag.layout || []).map((itemId) => (itemId === id ? -1 : itemId));
      this.renderEditor();
      this.setStatus("Item removed. Save to synchronize the change.");
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "save") this.save();
    if (action === "add-row") this.changeLayout((layout) => layout.push(...Array(8).fill(-1)));
    if (action === "trim")
      this.changeLayout((layout) => {
        while (layout.length && layout.slice(-8).every((id) => id === -1)) layout.splice(-8);
      });
    if (action === "add-item") this.addItem();
    if (action === "import") this.importTag();
    if (action === "export-runelite") this.copy(exportRuneLite(this.selectedTag()), "RuneLite export copied.");
    if (action === "export-banklayouts") this.copy(exportBankLayouts(this.selectedTag()), "BankLayouts export copied.");
  }

  handleInput(event) {
    const tag = this.selectedTag();
    if (!tag) return;
    if (event.target.matches(".bank-tags-page__name")) tag.name = event.target.value;
    if (event.target.matches(".bank-tags-page__icon")) tag.iconItemId = Number(event.target.value);
  }

  handleDragStart(event) {
    const item = event.target.closest(".bank-tags-page__item");
    if (!item) return;
    this.dragged =
      item.dataset.gridIndex !== undefined
        ? { index: Number(item.dataset.gridIndex) }
        : { id: Number(item.dataset.unplacedId) };
  }

  handleDoubleClick(event) {
    const slot = event.target.closest("[data-slot]");
    if (!slot) return;
    this.changeLayout((layout) => {
      layout[Number(slot.dataset.slot)] = -1;
    });
  }

  handleDrop(event) {
    event.preventDefault();
    const target = event.target.closest("[data-slot]");
    if (!target || !this.dragged) return;
    const targetIndex = Number(target.dataset.slot);
    this.changeLayout((layout) => {
      while (layout.length <= targetIndex) layout.push(-1);
      if (this.dragged.index !== undefined) {
        const sourceIndex = this.dragged.index;
        [layout[sourceIndex], layout[targetIndex]] = [layout[targetIndex], layout[sourceIndex]];
      } else {
        layout[targetIndex] = this.dragged.id;
      }
    });
    this.dragged = null;
  }

  changeLayout(change) {
    const tag = this.selectedTag();
    tag.layout = [...(tag.layout || [])];
    change(tag.layout);
    this.renderEditor();
    this.setStatus("Unsaved changes");
  }

  addItem() {
    const input = this.querySelector(".bank-tags-page__item-search");
    const query = input.value.trim().toLowerCase();
    let id = Number(query);
    if (!Number.isInteger(id) && Item.itemDetails) {
      const match = Object.entries(Item.itemDetails).find(([, item]) => item.name.toLowerCase() === query);
      id = match ? Number(match[0]) : NaN;
    }
    if (!Number.isInteger(id) || id === 0) return this.setStatus("Enter a valid item ID or exact item name.", true);
    const tag = this.selectedTag();
    tag.itemIds = [...new Set([...tag.itemIds, id])].sort((a, b) => a - b);
    input.value = "";
    this.renderEditor();
    this.setStatus("Item added. Save to synchronize it.");
  }

  async importTag() {
    try {
      const imported = parseBankTag(this.querySelector(".bank-tags-page__import-text").value);
      Object.assign(this.selectedTag(), imported);
      this.renderEditor();
      this.setStatus("Import loaded. Review it, then save to synchronize.");
    } catch (failure) {
      this.setStatus(`Import failed: ${failure.message}`, true);
    }
  }

  async copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(message);
    } catch {
      this.setStatus("Clipboard access was blocked by the browser.", true);
    }
  }

  async save() {
    const tag = this.selectedTag();
    try {
      const draft = validateDraft(tag);
      this.setStatus("Saving…");
      const saved = await this.request(`/bank-tags/${tag.tagId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${tag.revision}"` },
        body: JSON.stringify({ schemaVersion: 1, tagId: tag.tagId, ...draft }),
      });
      this.tags.set(saved.tagId, saved);
      this.renderList();
      this.renderEditor();
      this.setStatus(`Saved revision ${saved.revision}. RuneLite will receive it on its next sync.`);
    } catch (failure) {
      if (failure.status === 409) {
        this.setStatus(
          "Save conflict: this tag changed elsewhere. Your draft was not overwritten. Refresh before trying again.",
          true
        );
      } else {
        this.setStatus(`Unable to save: ${failure.message}`, true);
      }
    }
  }

  setStatus(message, error = false) {
    const status = this.querySelector(".bank-tags-page__status");
    status.textContent = message;
    status.classList.toggle("bank-tags-page__status--error", error);
  }

  escapeAttribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  escape(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }
}
customElements.define("bank-tags-page", BankTagsPage);
