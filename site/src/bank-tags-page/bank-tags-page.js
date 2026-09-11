import { BaseElement } from "../base-element/base-element";
import { Item } from "../data/item";
import { areItemsEquivalent, canonicalItemId, isTaggedItemPlaced, itemVariations } from "../data/item-variations";
import { storage } from "../data/storage";
import { exportBankLayouts, exportRuneLite, parseBankTag, validateDraft } from "./bank-tag-layout";

export class BankTagsPage extends BaseElement {
  constructor() {
    super();
    this.tags = new Map();
    this.folders = new Map();
    this.order = [];
    this.folderOrder = [];
    this.folderGroupRevision = 0;
    this.folderOrderRevision = 0;
    this.selectedTagId = null;
    this.selectedFolderId = null;
    this.collapsedFolders = new Set();
    this.dragged = null;
    this.explorerResults = [];
    this.explorerIndex = 0;
    this.explorerSlot = null;
    this.explorerTarget = "tag-item";
    this.explorerReturnFocus = null;
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
    this.eventListener(document, "keydown", this.handleKeyDown.bind(this), { passive: false });
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

  async load(preferredTagId = this.selectedTagId, preferredFolderId = this.selectedFolderId) {
    this.setStatus("Loading synchronized bank tags and folders…");
    try {
      const [tagManifest, folderManifest] = await Promise.all([
        this.request("/bank-tags"),
        this.request("/bank-tag-folders"),
      ]);
      const [tagDocuments, folderDocuments] = await Promise.all([
        Promise.all(tagManifest.orderedTagIds.map((id) => this.request(`/bank-tags/${id}`))),
        Promise.all(folderManifest.orderedFolderIds.map((id) => this.request(`/bank-tag-folders/${id}`))),
      ]);
      const liveTags = new Set(tagManifest.orderedTagIds);
      const liveFolders = new Set(folderManifest.orderedFolderIds);
      this.tags = new Map(
        tagDocuments.filter((tag) => !tag.deleted && liveTags.has(tag.tagId)).map((tag) => [tag.tagId, tag])
      );
      this.folders = new Map(
        folderDocuments
          .filter((folder) => !folder.deleted && liveFolders.has(folder.folderId))
          .map((folder) => [folder.folderId, folder])
      );
      this.order = tagManifest.orderedTagIds.filter((id) => this.tags.has(id));
      this.folderOrder = folderManifest.orderedFolderIds.filter((id) => this.folders.has(id));
      this.folderGroupRevision = folderManifest.groupRevision;
      this.folderOrderRevision = folderManifest.orderRevision;
      this.loadCollapsedFolders();
      if (this.tags.has(preferredTagId)) {
        this.selectedTagId = preferredTagId;
        this.selectedFolderId = null;
      } else if (this.folders.has(preferredFolderId)) {
        this.selectedTagId = null;
        this.selectedFolderId = preferredFolderId;
      } else {
        this.selectedTagId = this.order[0] || null;
        this.selectedFolderId = null;
      }
      this.renderList();
      this.renderEditor();
      this.setStatus(
        `${this.tags.size} synchronized tag${this.tags.size === 1 ? "" : "s"} in ${this.folders.size} folder${
          this.folders.size === 1 ? "" : "s"
        }.`
      );
    } catch (failure) {
      this.setStatus(`Unable to load bank tags: ${failure.message}`, true);
    }
  }

  selectedTag() {
    return this.tags.get(this.selectedTagId);
  }

  selectedFolder() {
    return this.folders.get(this.selectedFolderId);
  }

  collapsedStorageKey() {
    const { groupName } = this.credentials();
    return `bank-tag-folders-collapsed:${groupName || "unknown"}`;
  }

  loadCollapsedFolders() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.collapsedStorageKey()) || "[]");
      this.collapsedFolders = new Set(stored.filter((folderId) => this.folders.has(folderId)));
    } catch {
      this.collapsedFolders = new Set();
    }
  }

  saveCollapsedFolders() {
    localStorage.setItem(this.collapsedStorageKey(), JSON.stringify([...this.collapsedFolders]));
  }

  folderOwner(tagId) {
    return this.folderOrder.find((folderId) => this.folders.get(folderId)?.orderedTagIds.includes(tagId)) || null;
  }

  tagListItem(id, nested = false) {
    const tag = this.tags.get(id);
    if (!tag) return "";
    return `<li><button type="button" class="bank-tags-page__tag ${nested ? "bank-tags-page__tag--nested" : ""} ${
      id === this.selectedTagId ? "active" : ""
    }" data-select-tag="${id}">${this.itemImage(tag.iconItemId, tag.name)}<span><strong>${this.escape(
      tag.name
    )}</strong><small>${tag.itemIds.length} items · revision ${tag.revision}</small></span></button></li>`;
  }

  renderList() {
    const list = this.querySelector(".bank-tags-page__list");
    if (!list) return;
    const folders = this.folderOrder
      .map((folderId) => {
        const folder = this.folders.get(folderId);
        if (!folder) return "";
        const collapsed = this.collapsedFolders.has(folderId);
        const children = folder.orderedTagIds.filter((tagId) => this.tags.has(tagId));
        return `<li class="bank-tags-page__folder">
          <div class="bank-tags-page__folder-row">
            <button class="bank-tags-page__collapse" type="button" data-toggle-folder="${folderId}" aria-expanded="${!collapsed}" aria-label="${
          collapsed ? "Expand" : "Collapse"
        } ${this.escapeAttribute(folder.name)}">${collapsed ? "▸" : "▾"}</button>
            <button type="button" class="bank-tags-page__folder-button ${
              folderId === this.selectedFolderId ? "active" : ""
            }" data-select-folder="${folderId}">${this.itemImage(
          folder.iconItemId,
          folder.name
        )}<span><strong>${this.escape(folder.name)}</strong><small>${children.length} tag${
          children.length === 1 ? "" : "s"
        }</small></span></button>
          </div>
          <ul class="bank-tags-page__folder-tags" ${collapsed ? "hidden" : ""}>${children
          .map((tagId) => this.tagListItem(tagId, true))
          .join("")}</ul>
        </li>`;
      })
      .join("");
    const unfiled = this.order.filter((tagId) => !this.folderOwner(tagId));
    list.innerHTML = `${folders}<li class="bank-tags-page__section-title">Unfiled tags</li>${
      unfiled.map((tagId) => this.tagListItem(tagId)).join("") ||
      '<li class="bank-tags-page__empty-note">No unfiled tags.</li>'
    }`;
  }

  renderEditor() {
    const editor = this.querySelector(".bank-tags-page__editor");
    const folder = this.selectedFolder();
    if (folder) {
      this.renderFolderEditor(editor, folder);
      return;
    }
    const tag = this.selectedTag();
    if (!tag) {
      editor.innerHTML = '<p class="bank-tags-page__empty">Select a synchronized bank tag or folder.</p>';
      return;
    }
    const layout = tag.layout || [];
    const unplaced = tag.itemIds.filter((id) => !isTaggedItemPlaced(id, layout));
    const slots = [...layout, ...Array(Math.max(8, 8 - (layout.length % 8 || 8))).fill(-1)];
    editor.innerHTML = `
      <div class="bank-tags-page__fields">
        <label>Tag name<input class="bank-tags-page__name" maxlength="50" value="${this.escapeAttribute(
          tag.name
        )}"></label>
        <label>Icon item ID<input class="bank-tags-page__icon" type="number" min="0" value="${tag.iconItemId}"></label>
        <button class="men-button small bank-tags-page__icon-choice" type="button" data-action="choose-tag-icon" aria-label="Browse icons for ${this.escapeAttribute(
          tag.name
        )}">${this.itemImage(tag.iconItemId, tag.name)}<span>Browse icons</span></button>
      </div>
      <div class="bank-tags-page__toolbar">
        <button class="men-button small" type="button" data-action="save">Save changes</button>
        <button class="men-button small" type="button" data-action="history">Revision history</button>
        <button class="men-button small bank-tags-page__delete-tag" type="button" data-action="delete-tag">Delete layout tab</button>
        <button class="men-button small" type="button" data-action="add-row">Add row</button>
        <button class="men-button small" type="button" data-action="trim">Trim empty rows</button>
        <button class="men-button small" type="button" data-action="export-runelite">Copy RuneLite export</button>
        <button class="men-button small" type="button" data-action="export-banklayouts">Copy BankLayouts export</button>
      </div>
      <button class="men-button small bank-tags-page__add-item" type="button" data-action="open-explorer">+ Add item</button>
      <section class="bank-tags-page__unplaced-section"><h3>Tagged items not in the layout</h3>
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
            .join("") || '<p class="bank-tags-page__empty-note">Every tagged item is placed.</p>'
        }</div>
      </section>
      <section><h3>Layout</h3><p class="bank-tags-page__hint">Click an empty slot to choose an item. Drag items to move or swap them. Double-click a filled slot to empty it.</p>
        <div class="bank-tags-page__grid">${slots.map((id, index) => this.slot(id, index)).join("")}</div>
      </section>
      <section class="bank-tags-page__import"><h3>Import</h3>
        <textarea class="bank-tags-page__import-text" rows="3" placeholder="Paste a RuneLite or BankLayouts export"></textarea>
        <button class="men-button small" type="button" data-action="import">Load into editor</button>
      </section>`;
  }

  renderFolderEditor(editor, folder) {
    const children = folder.orderedTagIds.filter((tagId) => this.tags.has(tagId));
    const unfiled = this.order.filter((tagId) => !this.folderOwner(tagId));
    const folderIndex = this.folderOrder.indexOf(folder.folderId);
    editor.innerHTML = `
      <div class="bank-tags-page__folder-heading">
        ${this.itemImage(folder.iconItemId, folder.name)}
        <div><h3>Folder settings</h3><p class="bank-tags-page__hint">Folders organize synchronized tags. Collapse state stays in this browser.</p></div>
      </div>
      <div class="bank-tags-page__fields">
        <label>Folder name<input class="bank-tags-page__folder-name" maxlength="50" value="${this.escapeAttribute(
          folder.name
        )}"></label>
        <label>Icon item ID<input class="bank-tags-page__folder-icon" type="number" min="0" value="${
          folder.iconItemId
        }"></label>
        <button class="men-button small bank-tags-page__icon-choice" type="button" data-action="choose-folder-icon" aria-label="Browse icons for ${this.escapeAttribute(
          folder.name
        )}">${this.itemImage(folder.iconItemId, folder.name)}<span>Browse icons</span></button>
      </div>
      <div class="bank-tags-page__toolbar">
        <button class="men-button small" type="button" data-action="save-folder">Save folder</button>
        <button class="men-button small" type="button" data-action="move-folder-up" ${
          folderIndex <= 0 ? "disabled" : ""
        }>Move folder up</button>
        <button class="men-button small" type="button" data-action="move-folder-down" ${
          folderIndex < 0 || folderIndex >= this.folderOrder.length - 1 ? "disabled" : ""
        }>Move folder down</button>
        <button class="men-button small bank-tags-page__danger" type="button" data-action="delete-folder">Dissolve folder</button>
      </div>
      <section class="bank-tags-page__folder-members">
        <h3>Tags in this folder</h3>
        <p class="bank-tags-page__hint">Use the controls to set the child order saved for the group.</p>
        <ol class="bank-tags-page__folder-children">${
          children
            .map((tagId, index) => {
              const tag = this.tags.get(tagId);
              return `<li><span>${this.itemImage(tag.iconItemId, tag.name)}<strong>${this.escape(
                tag.name
              )}</strong></span><span>
                <button class="men-button small" type="button" data-action="move-folder-tag-up" data-tag-id="${tagId}" ${
                index === 0 ? "disabled" : ""
              } aria-label="Move ${this.escapeAttribute(tag.name)} up">↑</button>
                <button class="men-button small" type="button" data-action="move-folder-tag-down" data-tag-id="${tagId}" ${
                index === children.length - 1 ? "disabled" : ""
              } aria-label="Move ${this.escapeAttribute(tag.name)} down">↓</button>
                <button class="men-button small" type="button" data-action="unassign-folder-tag" data-tag-id="${tagId}">Unfile</button>
              </span></li>`;
            })
            .join("") || '<li class="bank-tags-page__empty-note">This folder is empty.</li>'
        }</ol>
      </section>
      <section class="bank-tags-page__folder-members">
        <h3>Unfiled tags</h3>
        <div class="bank-tags-page__assign-list">${
          unfiled
            .map((tagId) => {
              const tag = this.tags.get(tagId);
              return `<button class="men-button small" type="button" data-action="assign-folder-tag" data-tag-id="${tagId}">${this.itemImage(
                tag.iconItemId,
                tag.name
              )}<span>File ${this.escape(tag.name)}</span></button>`;
            })
            .join("") || '<p class="bank-tags-page__empty-note">No unfiled tags are available.</p>'
        }</div>
      </section>`;
  }

  itemRepresentativeId(id) {
    const canonicalId = canonicalItemId(Math.abs(id));
    if (id >= 0 && Item.itemDetails?.[canonicalId]) return canonicalId;
    return itemVariations(id).find((variationId) => Item.itemDetails?.[variationId]) || canonicalId;
  }

  itemName(id) {
    const representativeId = this.itemRepresentativeId(id);
    const name = Item.itemDetails?.[representativeId]?.name;
    if (id < 0) return name ? `All variants of ${name}` : `Variation group ${id}`;
    return name || `Item ${id}`;
  }

  itemImage(id, alt = this.itemName(id)) {
    const representativeId = this.itemRepresentativeId(id);
    if (!Item.itemDetails?.[representativeId]) return `<span class="bank-tags-page__unknown">${id}</span>`;
    return `<img src="${Item.imageUrl(representativeId, 1)}" alt="${this.escapeAttribute(alt)}" loading="lazy">`;
  }

  itemTile(id, attributes = "") {
    return `<button class="bank-tags-page__item" type="button" draggable="true" ${attributes} title="${this.escapeAttribute(
      this.itemName(id)
    )} (${id})">${this.itemImage(id)}<small>${id}</small></button>`;
  }

  slot(id, index) {
    return `<div class="bank-tags-page__slot" data-slot="${index}" title="${
      id > 0 ? `${this.escapeAttribute(this.itemName(id))} (${id})` : `Empty slot ${index + 1}`
    }">${
      id > 0
        ? `${this.itemTile(
            id,
            `data-grid-index="${index}"`
          )}<button class="bank-tags-page__remove" type="button" data-remove-id="${id}" title="Remove ${this.escapeAttribute(
            this.itemName(id)
          )} from tag" aria-label="Remove ${this.escapeAttribute(this.itemName(id))} from tag">×</button>`
        : `<button class="bank-tags-page__empty-slot" type="button" data-action="open-explorer" data-slot="${index}" aria-label="Add an item to slot ${
            index + 1
          }">+</button>`
    }</div>`;
  }

  handleClick(event) {
    const selected = event.target.closest("[data-select-tag]");
    if (selected) {
      this.selectedTagId = selected.dataset.selectTag;
      this.selectedFolderId = null;
      this.renderList();
      this.renderEditor();
      return;
    }
    const selectedFolder = event.target.closest("[data-select-folder]");
    if (selectedFolder) {
      this.selectedFolderId = selectedFolder.dataset.selectFolder;
      this.selectedTagId = null;
      this.renderList();
      this.renderEditor();
      return;
    }
    const toggledFolder = event.target.closest("[data-toggle-folder]");
    if (toggledFolder) return this.toggleFolderCollapse(toggledFolder.dataset.toggleFolder);
    if (event.target.closest(".bank-tags-page__refresh")) return this.load();
    if (event.target.closest(".bank-tags-page__help-button")) return this.openHelp();
    if (event.target.closest(".bank-tags-page__new-tag")) return this.openCreateGuard();
    if (event.target.closest(".bank-tags-page__new-folder")) return this.openCreateFolderGuard();
    if (
      event.target.closest(".bank-tags-page__explorer-close") ||
      event.target === this.querySelector(".bank-tags-page__explorer")
    ) {
      return this.closeExplorer();
    }
    const itemResult = event.target.closest("[data-item-result]");
    if (itemResult) return this.selectExplorerItem(Number(itemResult.dataset.itemResult));
    if (
      event.target.closest(".bank-tags-page__help-close") ||
      event.target === this.querySelector(".bank-tags-page__help")
    ) {
      return this.closeHelp();
    }
    const remove = event.target.closest("[data-remove-id]");
    if (remove) {
      const id = Number(remove.dataset.removeId);
      const tag = this.selectedTag();
      tag.itemIds = tag.itemIds.filter((itemId) => !areItemsEquivalent(itemId, id));
      tag.layout = (tag.layout || []).map((itemId) => (areItemsEquivalent(itemId, id) ? -1 : itemId));
      this.renderEditor();
      this.setStatus("Item removed. Save to synchronize the change.");
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "save") this.save();
    if (action === "save-folder") this.saveFolder();
    if (action === "choose-tag-icon") this.openTagIconExplorer();
    if (action === "choose-folder-icon") this.openFolderIconExplorer();
    if (action === "assign-folder-tag") this.changeFolderTag(event.target.closest("[data-tag-id]").dataset.tagId, true);
    if (action === "unassign-folder-tag")
      this.changeFolderTag(event.target.closest("[data-tag-id]").dataset.tagId, false);
    if (action === "move-folder-tag-up") this.moveFolderTag(event.target.closest("[data-tag-id]").dataset.tagId, -1);
    if (action === "move-folder-tag-down") this.moveFolderTag(event.target.closest("[data-tag-id]").dataset.tagId, 1);
    if (action === "move-folder-up") this.moveFolder(-1);
    if (action === "move-folder-down") this.moveFolder(1);
    if (action === "open-explorer") this.openExplorer(event.target.closest("[data-slot]")?.dataset.slot);
    if (action === "history") this.openHistory();
    if (action === "view-revision") this.viewRevision(Number(event.target.closest("[data-revision]").dataset.revision));
    if (action === "restore-revision")
      this.openRestoreGuard(Number(event.target.closest("[data-revision]").dataset.revision));
    if (action === "confirm-restore")
      this.restoreRevision(Number(event.target.closest("[data-revision]").dataset.revision));
    if (action === "delete-tag") this.openDeleteGuard();
    if (action === "delete-folder") this.openDeleteFolderGuard();
    if (action === "confirm-create") this.createTag();
    if (action === "confirm-create-folder") this.createFolder();
    if (action === "confirm-delete") this.deleteTag();
    if (action === "confirm-delete-folder") this.deleteFolder();
    if (action === "cancel-guard") this.closeGuard();
    if (action === "add-row") this.changeLayout((layout) => layout.push(...Array(8).fill(-1)));
    if (action === "trim")
      this.changeLayout((layout) => {
        while (layout.length && layout.slice(-8).every((id) => id === -1)) layout.splice(-8);
      });
    if (action === "import") this.importTag();
    if (action === "export-runelite") this.copy(exportRuneLite(this.selectedTag()), "RuneLite export copied.");
    if (action === "export-banklayouts") this.copy(exportBankLayouts(this.selectedTag()), "BankLayouts export copied.");
  }

  openHelp() {
    const help = this.querySelector(".bank-tags-page__help");
    help.hidden = false;
    help.querySelector(".bank-tags-page__help-close").focus();
  }

  closeHelp() {
    this.querySelector(".bank-tags-page__help").hidden = true;
    this.querySelector(".bank-tags-page__help-button")?.focus();
  }

  handleKeyDown(event) {
    if (event.target.matches?.(".bank-tags-page__explorer-search") && this.explorerResults.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.explorerIndex =
          (this.explorerIndex + direction + this.explorerResults.length) % this.explorerResults.length;
        this.renderExplorerResults();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.selectExplorerItem(this.explorerResults[this.explorerIndex].id);
        return;
      }
    }
    if (event.key === "Escape") {
      this.closeExplorer();
      this.closeHelp();
      this.closeGuard();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      if (!this.selectedTag() && !this.selectedFolder()) return;
      event.preventDefault();
      if (this.selectedFolder()) this.saveFolder();
      else this.save();
      return;
    }
    const typing = event.target.matches?.("input, textarea, select") || event.target.isContentEditable;
    if (event.key === "?" && !typing) {
      event.preventDefault();
      this.openHelp();
    }
  }

  async openHistory() {
    const tag = this.selectedTag();
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(
      ".bank-tags-page__guard-card"
    ).innerHTML = `<h3 id="bank-tags-guard-title">Revision history for “${this.escape(
      tag.name
    )}”</h3><p>Loading revisions…</p>`;
    guard.hidden = false;
    try {
      const history = await this.request(`/bank-tags/${tag.tagId}/revisions`);
      guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
        <h3 id="bank-tags-guard-title">Revision history for “${this.escape(tag.name)}”</h3>
        <p>Select <strong>Preview</strong> to load a historical revision as an unsaved draft, or <strong>Restore</strong> to publish it as a new revision.</p>
        <ol class="bank-tags-page__revisions">${history.revisions
          .map(
            (revision) => `<li><span><strong>Revision ${revision.revision}</strong><small>${
              revision.itemCount
            } tagged items · ${
              revision.layoutCount === null ? "no layout" : `${revision.layoutCount} layout slots`
            } · ${this.escape(new Date(revision.updatedAt).toLocaleString())}</small></span><span>
              <button class="men-button small" type="button" data-action="view-revision" data-revision="${
                revision.revision
              }">Preview</button>
              ${
                revision.revision === tag.revision || revision.deleted
                  ? ""
                  : `<button class="men-button small" type="button" data-action="restore-revision" data-revision="${revision.revision}">Restore</button>`
              }</span></li>`
          )
          .join("")}</ol>
        <div class="bank-tags-page__guard-actions"><button class="men-button small" type="button" data-action="cancel-guard">Close</button></div>`;
    } catch (failure) {
      guard.querySelector(
        ".bank-tags-page__guard-card"
      ).innerHTML = `<h3>Revision history unavailable</h3><p>${this.escape(
        failure.message
      )}</p><button class="men-button small" type="button" data-action="cancel-guard">Close</button>`;
    }
  }

  async viewRevision(revision) {
    try {
      const historical = await this.request(`/bank-tags/${this.selectedTagId}/revisions/${revision}`);
      const current = this.selectedTag();
      Object.assign(current, {
        name: historical.name,
        iconItemId: historical.iconItemId,
        itemIds: historical.itemIds,
        layout: historical.layout,
      });
      this.closeGuard();
      this.renderEditor();
      this.setStatus(`Previewing revision ${revision} as an unsaved draft. Select Save changes to publish it.`);
    } catch (failure) {
      this.setStatus(`Unable to preview revision: ${failure.message}`, true);
    }
  }

  openRestoreGuard(revision) {
    const tag = this.selectedTag();
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
      <h3 id="bank-tags-guard-title">Restore revision ${revision} of “${this.escape(tag.name)}”?</h3>
      <p>This publishes the historical contents as a new revision for the whole group. The current revision remains in history.</p>
      <label>Type <strong>${this.escape(
        tag.name
      )}</strong> to confirm<input class="bank-tags-page__restore-confirm" autocomplete="off"></label>
      <div class="bank-tags-page__guard-actions">
        <button class="men-button small" type="button" data-action="confirm-restore" data-revision="${revision}">Restore revision ${revision}</button>
        <button class="men-button small" type="button" data-action="cancel-guard">Cancel</button>
      </div>`;
    guard.querySelector(".bank-tags-page__restore-confirm").focus();
  }

  async restoreRevision(revision) {
    const tag = this.selectedTag();
    if (this.querySelector(".bank-tags-page__restore-confirm")?.value.trim() !== tag.name) {
      this.setStatus(`Restore blocked. Type “${tag.name}” exactly to confirm.`, true);
      return;
    }
    try {
      const restored = await this.request(`/bank-tags/${tag.tagId}/revisions/${revision}/restore`, {
        method: "POST",
        headers: { "If-Match": `"${tag.revision}"` },
      });
      this.tags.set(tag.tagId, restored);
      this.closeGuard();
      this.renderList();
      this.renderEditor();
      this.setStatus(`Restored revision ${revision} as new revision ${restored.revision}.`);
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Restore conflict: this tag changed elsewhere. Refresh before trying again."
          : `Unable to restore revision: ${failure.message}`,
        true
      );
    }
  }

  openCreateGuard() {
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
      <h3 id="bank-tags-guard-title">Create a synchronized layout tab?</h3>
      <p>This creates a new empty tag for the whole group. RuneLite clients will receive it during synchronization.</p>
      <label>New tag name<input class="bank-tags-page__create-name" maxlength="50" autocomplete="off"></label>
      <label>Icon item ID<input class="bank-tags-page__create-icon" type="number" min="0" value="0"></label>
      <div class="bank-tags-page__guard-actions">
        <button class="men-button small" type="button" data-action="confirm-create">Create empty tab</button>
        <button class="men-button small" type="button" data-action="cancel-guard">Cancel</button>
      </div>`;
    guard.hidden = false;
    guard.querySelector(".bank-tags-page__create-name").focus();
  }

  openCreateFolderGuard() {
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
      <h3 id="bank-tags-guard-title">Create a synchronized folder?</h3>
      <p>The new folder starts empty and is appended to the shared folder order.</p>
      <label>Folder name<input class="bank-tags-page__create-folder-name" maxlength="50" autocomplete="off"></label>
      <label>Icon item ID<input class="bank-tags-page__create-folder-icon" type="number" min="0" value="0"></label>
      <div class="bank-tags-page__guard-actions">
        <button class="men-button small" type="button" data-action="confirm-create-folder">Create folder</button>
        <button class="men-button small" type="button" data-action="cancel-guard">Cancel</button>
      </div>`;
    guard.hidden = false;
    guard.querySelector(".bank-tags-page__create-folder-name").focus();
  }

  openDeleteGuard() {
    const tag = this.selectedTag();
    if (!tag) return;
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
      <h3 id="bank-tags-guard-title">Permanently delete “${this.escape(tag.name)}”?</h3>
      <p><strong>This affects the whole group.</strong> The tag, its item associations, and its layout will be removed from synchronized RuneLite clients.</p>
      <label>Type <strong>${this.escape(
        tag.name
      )}</strong> to confirm<input class="bank-tags-page__delete-confirm" autocomplete="off"></label>
      <div class="bank-tags-page__guard-actions">
        <button class="men-button small bank-tags-page__danger" type="button" data-action="confirm-delete">Delete synchronized tab</button>
        <button class="men-button small" type="button" data-action="cancel-guard">Cancel</button>
      </div>`;
    guard.hidden = false;
    guard.querySelector(".bank-tags-page__delete-confirm").focus();
  }

  openDeleteFolderGuard() {
    const folder = this.selectedFolder();
    if (!folder) return;
    const guard = this.querySelector(".bank-tags-page__guard");
    guard.querySelector(".bank-tags-page__guard-card").innerHTML = `
      <h3 id="bank-tags-guard-title">Dissolve “${this.escape(folder.name)}”?</h3>
      <p><strong>This affects the whole group.</strong> The folder is deleted, but its tags remain synchronized and become unfiled.</p>
      <label>Type <strong>${this.escape(
        folder.name
      )}</strong> to confirm<input class="bank-tags-page__delete-folder-confirm" autocomplete="off"></label>
      <div class="bank-tags-page__guard-actions">
        <button class="men-button small bank-tags-page__danger" type="button" data-action="confirm-delete-folder">Dissolve folder</button>
        <button class="men-button small" type="button" data-action="cancel-guard">Cancel</button>
      </div>`;
    guard.hidden = false;
    guard.querySelector(".bank-tags-page__delete-folder-confirm").focus();
  }

  closeGuard() {
    const guard = this.querySelector(".bank-tags-page__guard");
    if (guard) guard.hidden = true;
  }

  async createTag() {
    const guard = this.querySelector(".bank-tags-page__guard");
    try {
      const draft = validateDraft({
        name: guard.querySelector(".bank-tags-page__create-name").value,
        iconItemId: Number(guard.querySelector(".bank-tags-page__create-icon").value),
        itemIds: [],
        layout: [],
      });
      const tagId = crypto.randomUUID();
      this.setStatus("Creating synchronized tag…");
      const created = await this.request(`/bank-tags/${tagId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-None-Match": "*" },
        body: JSON.stringify({ schemaVersion: 1, tagId, ...draft }),
      });
      this.tags.set(tagId, created);
      this.order.push(tagId);
      this.selectedTagId = tagId;
      this.closeGuard();
      this.renderList();
      this.renderEditor();
      this.setStatus(`Created “${created.name}”. RuneLite will receive it on its next sync.`);
    } catch (failure) {
      this.setStatus(`Unable to create tag: ${failure.message}`, true);
    }
  }

  validateFolderDraft(folder) {
    const name = typeof folder.name === "string" ? folder.name.trim() : "";
    if (!name || [...name].length > 50) throw new Error("Folder name must be between 1 and 50 characters.");
    const iconItemId = Number(folder.iconItemId);
    if (!Number.isInteger(iconItemId) || iconItemId < 0) throw new Error("Folder icon item ID must be non-negative.");
    const orderedTagIds = [...folder.orderedTagIds];
    if (orderedTagIds.some((tagId) => !this.tags.has(tagId)) || new Set(orderedTagIds).size !== orderedTagIds.length)
      throw new Error("Folder tags must be unique synchronized tags.");
    return { name, iconItemId, orderedTagIds };
  }

  async createFolder() {
    const guard = this.querySelector(".bank-tags-page__guard");
    try {
      const draft = this.validateFolderDraft({
        name: guard.querySelector(".bank-tags-page__create-folder-name").value,
        iconItemId: Number(guard.querySelector(".bank-tags-page__create-folder-icon").value),
        orderedTagIds: [],
      });
      const folderId = crypto.randomUUID();
      this.setStatus("Creating synchronized folder…");
      const created = await this.request(`/bank-tag-folders/${folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-None-Match": "*" },
        body: JSON.stringify({ schemaVersion: 1, folderId, ...draft }),
      });
      this.folders.set(folderId, created);
      this.folderOrder.push(folderId);
      this.folderGroupRevision += 1;
      this.folderOrderRevision += 1;
      this.selectedFolderId = folderId;
      this.selectedTagId = null;
      this.closeGuard();
      this.renderList();
      this.renderEditor();
      this.setStatus(`Created folder “${created.name}”.`);
    } catch (failure) {
      this.setStatus(`Unable to create folder: ${failure.message}`, true);
    }
  }

  async deleteTag() {
    const tag = this.selectedTag();
    const confirmation = this.querySelector(".bank-tags-page__delete-confirm")?.value.trim();
    if (confirmation !== tag.name) {
      this.setStatus(`Deletion blocked. Type “${tag.name}” exactly to confirm.`, true);
      return;
    }
    try {
      this.setStatus(`Deleting “${tag.name}”…`);
      await this.request(`/bank-tags/${tag.tagId}`, {
        method: "DELETE",
        headers: { "If-Match": `"${tag.revision}"` },
      });
      const ownerId = this.folderOwner(tag.tagId);
      if (ownerId) {
        const owner = this.folders.get(ownerId);
        owner.orderedTagIds = owner.orderedTagIds.filter((tagId) => tagId !== tag.tagId);
        owner.revision += 1;
        this.folderGroupRevision += 1;
      }
      this.tags.delete(tag.tagId);
      this.order = this.order.filter((id) => id !== tag.tagId);
      this.selectedTagId = this.order[0] || null;
      this.closeGuard();
      this.renderList();
      this.renderEditor();
      this.setStatus(`Deleted “${tag.name}” from synchronized bank tags.`);
    } catch (failure) {
      if (failure.status === 409) {
        this.setStatus("Delete conflict: this tag changed elsewhere. Refresh before trying again.", true);
      } else {
        this.setStatus(`Unable to delete tag: ${failure.message}`, true);
      }
    }
  }

  toggleFolderCollapse(folderId) {
    if (!this.folders.has(folderId)) return;
    if (this.collapsedFolders.has(folderId)) this.collapsedFolders.delete(folderId);
    else this.collapsedFolders.add(folderId);
    this.saveCollapsedFolders();
    this.renderList();
  }

  changeFolderTag(tagId, assigned) {
    const folder = this.selectedFolder();
    if (!folder || !this.tags.has(tagId)) return;
    if (assigned && this.folderOwner(tagId)) return;
    folder.orderedTagIds = assigned
      ? [...folder.orderedTagIds, tagId]
      : folder.orderedTagIds.filter((id) => id !== tagId);
    this.renderList();
    this.renderEditor();
    this.setStatus("Unsaved folder changes");
  }

  moveFolderTag(tagId, direction) {
    const folder = this.selectedFolder();
    if (!folder) return;
    const index = folder.orderedTagIds.indexOf(tagId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folder.orderedTagIds.length) return;
    [folder.orderedTagIds[index], folder.orderedTagIds[target]] = [
      folder.orderedTagIds[target],
      folder.orderedTagIds[index],
    ];
    this.renderList();
    this.renderEditor();
    this.setStatus("Unsaved folder order changes");
  }

  async saveFolder() {
    const folder = this.selectedFolder();
    try {
      const draft = this.validateFolderDraft(folder);
      this.setStatus("Saving folder…");
      const saved = await this.request(`/bank-tag-folders/${folder.folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${folder.revision}"` },
        body: JSON.stringify({ schemaVersion: 1, folderId: folder.folderId, ...draft }),
      });
      this.folders.set(saved.folderId, saved);
      this.folderGroupRevision += 1;
      this.renderList();
      this.renderEditor();
      this.setStatus(`Saved folder revision ${saved.revision}.`);
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Folder save conflict: folders changed elsewhere. Your draft was not overwritten. Refresh before trying again."
          : `Unable to save folder: ${failure.message}`,
        true
      );
    }
  }

  async moveFolder(direction) {
    const folder = this.selectedFolder();
    const index = this.folderOrder.indexOf(folder?.folderId);
    const target = index + direction;
    if (!folder || index < 0 || target < 0 || target >= this.folderOrder.length) return;
    const orderedFolderIds = [...this.folderOrder];
    [orderedFolderIds[index], orderedFolderIds[target]] = [orderedFolderIds[target], orderedFolderIds[index]];
    try {
      const manifest = await this.request("/bank-folder-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${this.folderOrderRevision}"` },
        body: JSON.stringify({ schemaVersion: 1, orderedFolderIds }),
      });
      this.folderOrder = manifest.orderedFolderIds;
      this.folderGroupRevision = manifest.groupRevision;
      this.folderOrderRevision = manifest.orderRevision;
      this.renderList();
      this.renderEditor();
      this.setStatus("Saved folder order.");
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Folder order conflict: folders changed elsewhere. Refresh before trying again."
          : `Unable to reorder folders: ${failure.message}`,
        true
      );
    }
  }

  async deleteFolder() {
    const folder = this.selectedFolder();
    const confirmation = this.querySelector(".bank-tags-page__delete-folder-confirm")?.value.trim();
    if (confirmation !== folder.name) {
      this.setStatus(`Dissolve blocked. Type “${folder.name}” exactly to confirm.`, true);
      return;
    }
    try {
      await this.request(`/bank-tag-folders/${folder.folderId}`, {
        method: "DELETE",
        headers: { "If-Match": `"${folder.revision}"` },
      });
      this.folders.delete(folder.folderId);
      this.folderOrder = this.folderOrder.filter((folderId) => folderId !== folder.folderId);
      this.folderGroupRevision += 1;
      this.folderOrderRevision += 1;
      this.collapsedFolders.delete(folder.folderId);
      this.saveCollapsedFolders();
      this.selectedFolderId = null;
      this.selectedTagId = this.order[0] || null;
      this.closeGuard();
      this.renderList();
      this.renderEditor();
      this.setStatus(`Dissolved “${folder.name}”. Its tags are now unfiled.`);
    } catch (failure) {
      this.setStatus(
        failure.status === 409
          ? "Folder delete conflict: this folder changed elsewhere. Refresh before trying again."
          : `Unable to dissolve folder: ${failure.message}`,
        true
      );
    }
  }

  handleInput(event) {
    if (event.target.matches(".bank-tags-page__explorer-search")) {
      this.searchExplorer(event.target.value);
      return;
    }
    const folder = this.selectedFolder();
    if (folder) {
      if (event.target.matches(".bank-tags-page__folder-name")) folder.name = event.target.value;
      if (event.target.matches(".bank-tags-page__folder-icon")) folder.iconItemId = Number(event.target.value);
      return;
    }
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

  openExplorer(slot) {
    this.openItemExplorer({
      target: "tag-item",
      slot: slot === undefined ? null : Number(slot),
      title: "Add an item",
      purpose:
        slot === undefined
          ? "Choose an item to add to this tag."
          : `Choose an item for layout slot ${Number(slot) + 1}.`,
    });
  }

  openTagIconExplorer() {
    if (!this.selectedTag()) return;
    this.openItemExplorer({
      target: "tag-icon",
      title: "Choose a tab icon",
      purpose: "Browse item images, or search by item name or ID.",
    });
  }

  openFolderIconExplorer() {
    if (!this.selectedFolder()) return;
    this.openItemExplorer({
      target: "folder-icon",
      title: "Choose a folder icon",
      purpose: "Browse item images, or search by item name or ID.",
    });
  }

  openItemExplorer({ target, slot = null, title, purpose }) {
    const explorer = this.querySelector(".bank-tags-page__explorer");
    this.explorerTarget = target;
    this.explorerSlot = slot;
    this.explorerResults = [];
    this.explorerIndex = 0;
    this.explorerReturnFocus = document.activeElement;
    explorer.classList.toggle("bank-tags-page__explorer--icons", this.isIconExplorer());
    const heading = explorer.querySelector("h3");
    if (heading) heading.textContent = title;
    explorer.querySelector(".bank-tags-page__explorer-purpose").textContent = purpose;
    const hint = explorer.querySelector(".bank-tags-page__explorer-hint");
    if (hint) {
      hint.textContent = this.isIconExplorer()
        ? "Suggested icons appear first. Search at any time, then use ↑/↓ and Enter to select."
        : "Type at least 2 characters. Use ↑/↓ to browse and Enter to select.";
    }
    const search = explorer.querySelector(".bank-tags-page__explorer-search");
    search.value = "";
    explorer.hidden = false;
    this.searchExplorer("");
    search.focus();
  }

  closeExplorer() {
    const explorer = this.querySelector(".bank-tags-page__explorer");
    if (!explorer || explorer.hidden) return;
    explorer.hidden = true;
    this.explorerResults = [];
    this.explorerIndex = 0;
    this.explorerSlot = null;
    this.explorerTarget = "tag-item";
    this.explorerReturnFocus?.focus?.();
    this.explorerReturnFocus = null;
  }

  isIconExplorer() {
    return this.explorerTarget === "tag-icon" || this.explorerTarget === "folder-icon";
  }

  currentExplorerIconId() {
    if (this.explorerTarget === "tag-icon") return this.selectedTag()?.iconItemId;
    if (this.explorerTarget === "folder-icon") return this.selectedFolder()?.iconItemId;
    return null;
  }

  suggestedIconIds() {
    const candidates = [this.currentExplorerIconId()];
    if (this.explorerTarget === "tag-icon") {
      const tag = this.selectedTag();
      candidates.push(...(tag?.itemIds || []), ...(tag?.layout || []));
    } else {
      const folder = this.selectedFolder();
      for (const tagId of folder?.orderedTagIds || []) candidates.push(this.tags.get(tagId)?.iconItemId);
      for (const tag of this.tags.values()) candidates.push(tag.iconItemId);
    }
    const suggested = candidates
      .map((id) => this.itemRepresentativeId(Number(id)))
      .filter((id) => Number.isInteger(id) && id > 0 && Item.itemDetails?.[id]);
    const catalog = Object.keys(Item.itemDetails || {})
      .map(Number)
      .sort((left, right) => Item.itemDetails[left].name.localeCompare(Item.itemDetails[right].name) || left - right);
    return [...new Set([...suggested, ...catalog])].slice(0, 80);
  }

  searchExplorer(value) {
    const query = value.trim().toLowerCase();
    const numeric = /^\d+$/.test(query);
    const minimumLength = this.isIconExplorer() ? 1 : 2;
    if (!Item.itemDetails || (!numeric && query.length < minimumLength)) {
      this.explorerResults =
        this.isIconExplorer() && !query
          ? this.suggestedIconIds().map((id) => ({ id, name: Item.itemDetails[id].name, score: 0 }))
          : [];
      this.explorerIndex = 0;
      this.renderExplorerResults();
      return;
    }
    this.explorerResults = Object.entries(Item.itemDetails)
      .map(([itemId, item]) => {
        const id = Number(itemId);
        const name = item.name.toLowerCase();
        let score = -1;
        if (itemId === query) score = 0;
        else if (name === query) score = 1;
        else if (name.startsWith(query)) score = 2;
        else if (name.split(/\s+/).some((word) => word.startsWith(query))) score = 3;
        else if (name.includes(query)) score = 4;
        return { id, name: item.name, score };
      })
      .filter((item) => item.score >= 0)
      .sort((left, right) => left.score - right.score || left.name.length - right.name.length || left.id - right.id)
      .slice(0, this.isIconExplorer() ? 80 : 40);
    this.explorerIndex = 0;
    this.renderExplorerResults();
  }

  renderExplorerResults() {
    const results = this.querySelector(".bank-tags-page__explorer-results");
    if (!results) return;
    if (!this.explorerResults.length) {
      const query = this.querySelector(".bank-tags-page__explorer-search")?.value.trim();
      results.innerHTML = `<p class="bank-tags-page__explorer-empty">${
        query?.length ? "No matching items." : "Start typing to search the item catalog."
      }</p>`;
      return;
    }
    const tagged = new Set(this.selectedTag()?.itemIds || []);
    const currentIconId = this.currentExplorerIconId();
    results.innerHTML = this.explorerResults
      .map(
        (item, index) => `<button class="bank-tags-page__explorer-result ${
          index === this.explorerIndex ? "active" : ""
        } ${item.id === currentIconId ? "selected" : ""}" type="button" role="option" aria-selected="${
          this.isIconExplorer() ? item.id === currentIconId : index === this.explorerIndex
        }" data-item-result="${item.id}" title="${this.escapeAttribute(item.name)} (Item ID ${item.id})">
          ${this.itemImage(item.id, item.name)}
          <span><strong>${this.escape(item.name)}</strong><small>Item ID ${item.id}</small></span>
          ${
            item.id === currentIconId
              ? '<span class="bank-tags-page__tagged">Current icon</span>'
              : !this.isIconExplorer() && tagged.has(item.id)
              ? '<span class="bank-tags-page__tagged">Already tagged</span>'
              : ""
          }
        </button>`
      )
      .join("");
    results.querySelector(".active")?.scrollIntoView?.({ block: "nearest" });
  }

  selectExplorerItem(id) {
    if (!Number.isInteger(id) || id <= 0 || !Item.itemDetails?.[id]) return;
    if (this.isIconExplorer()) {
      const target = this.explorerTarget === "folder-icon" ? this.selectedFolder() : this.selectedTag();
      if (!target) return;
      const targetName = this.explorerTarget === "folder-icon" ? "folder" : "tab";
      target.iconItemId = id;
      const itemName = this.itemName(id);
      this.closeExplorer();
      this.renderList();
      this.renderEditor();
      this.setStatus(`${itemName} selected as the ${targetName} icon. Save to synchronize.`);
      return;
    }
    const tag = this.selectedTag();
    const alreadyTagged = tag.itemIds.includes(id);
    if (!alreadyTagged) tag.itemIds = [...tag.itemIds, id].sort((a, b) => a - b);
    if (this.explorerSlot !== null) {
      tag.layout = [...(tag.layout || [])];
      while (tag.layout.length <= this.explorerSlot) tag.layout.push(-1);
      tag.layout[this.explorerSlot] = id;
    }
    const itemName = this.itemName(id);
    const placed = this.explorerSlot !== null;
    this.closeExplorer();
    this.renderEditor();
    this.setStatus(
      placed
        ? `${itemName} placed in the layout${alreadyTagged ? "" : " and added to the tag"}. Save to synchronize.`
        : alreadyTagged
        ? `${itemName} is already in this tag.`
        : `${itemName} added. Save to synchronize.`
    );
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
