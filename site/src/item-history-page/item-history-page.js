import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { Item } from "../data/item";

export class ItemHistoryPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.data = null;
    this.error = null;
    this.render();
    this.subscribeOnce("get-group-data", () => this.loadHistory());
  }

  html() {
    return `{{item-history-page.html}}`;
  }

  async loadHistory(from, to) {
    try {
      this.data = await api.getItemHistory(from, to);
      this.error = null;
    } catch (error) {
      console.error(error);
      this.error = error;
    }
    this.render();
    this.bindControls();
  }

  bindControls() {
    const refreshButton = this.querySelector(".item-history-page__refresh");
    if (refreshButton) this.eventListener(refreshButton, "click", this.handleRefresh.bind(this));
    for (const select of this.querySelectorAll(".item-history-page__date-select")) {
      this.eventListener(select, "change", this.handleDateChange.bind(this));
    }
  }

  async handleRefresh() {
    const from = this.data?.from;
    const to = this.data?.to;
    this.data = null;
    this.error = null;
    this.render();
    await this.loadHistory(from, to);
  }

  async handleDateChange() {
    const from = this.querySelector(".item-history-page__from-date").value;
    const to = this.querySelector(".item-history-page__to-date").value;
    if (from >= to) {
      this.error = new Error("The starting snapshot must be earlier than the ending snapshot.");
      this.render();
      this.bindControls();
      return;
    }
    this.data = null;
    this.error = null;
    this.render();
    await this.loadHistory(from, to);
  }

  renderControls() {
    if (!this.data) return "";
    const storage = this.data.storage;
    const storageText = storage
      ? `${storage.snapshotCount.toLocaleString()} snapshots · ${this.formatBytes(
          storage.snapshotBytes
        )} snapshot data · ${this.formatBytes(storage.databaseBytes)} SQLite database · ${
          storage.retentionDays
        } day retention`
      : "";
    if (this.data.dates.length < 2) {
      return `<div class="item-history-page__storage">${storageText}</div>`;
    }
    const options = (selected) =>
      this.data.dates
        .map(
          (date) => `<option value="${date}"${date === selected ? " selected" : ""}>${this.formatDate(date)}</option>`
        )
        .join("");
    return `
      <div class="item-history-page__controls rsborder-tiny rsbackground">
        <label>From<select class="item-history-page__date-select item-history-page__from-date">${options(
          this.data.from
        )}</select></label>
        <label>To<select class="item-history-page__date-select item-history-page__to-date">${options(
          this.data.to
        )}</select></label>
        <span class="item-history-page__storage">${storageText}</span>
      </div>
    `;
  }

  renderHistory() {
    if (this.error) {
      return `<div class="item-history-page__message rsborder rsbackground">${this.error.message}</div>`;
    }
    if (this.data === null) {
      return '<div class="item-history-page__message rsborder rsbackground">Loading item history...</div>';
    }
    if (this.data.dates.length < 2) {
      return '<div class="item-history-page__message rsborder rsbackground">Today’s snapshot is saved. A second daily snapshot is needed before changes can be shown.</div>';
    }

    return `
      <section class="item-history-page__day rsborder rsbackground">
        <h2>${this.formatDate(this.data.from)} to ${this.formatDate(this.data.to)}</h2>
        <div class="item-history-page__columns">
          ${this.renderChanges("Gained", this.data.gained, "gained")}
          ${this.renderChanges("Lost", this.data.lost, "lost")}
        </div>
      </section>
    `;
  }

  formatDate(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  renderChanges(title, changes, type) {
    const sortedChanges = [...changes].sort((a, b) => b.quantity - a.quantity);
    const items = sortedChanges.length
      ? sortedChanges.map((change) => this.renderItem(change, type)).join("")
      : '<div class="item-history-page__empty">No items</div>';
    return `
      <div class="item-history-page__change-group item-history-page__change-group--${type}">
        <h3>${title} (${changes.length})</h3>
        <div class="item-history-page__items">${items}</div>
      </div>
    `;
  }

  renderItem(change, type) {
    const details = Item.itemDetails?.[change.item_id];
    const name = details?.name || `Item ${change.item_id}`;
    const image = details ? Item.imageUrl(change.item_id, change.quantity) : "";
    const imageHtml = image ? `<img src="${image}" width="36" height="32" loading="lazy" />` : "";
    return `
      <a class="item-history-page__item item-history-page__item--${type}"
         href="https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=${change.item_id}"
         target="_blank">
        ${imageHtml}
        <span class="item-history-page__item-name">${name}</span>
        <strong>${type === "gained" ? "+" : "-"}${change.quantity.toLocaleString()}</strong>
      </a>
    `;
  }
}

customElements.define("item-history-page", ItemHistoryPage);
