import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { Item } from "../data/item";
import { utility } from "../utility";

const LIVE_REFRESH_MS = 15 * 60 * 1000;

export class ItemHistoryPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.data = null;
    this.error = null;
    this.render();
    this.subscribeOnce("get-group-data", () => this.loadHistory());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.historyInterval) window.clearInterval(this.historyInterval);
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
    if (!this.historyInterval && this.data) {
      this.historyInterval = utility.callOnInterval(() => this.refreshLiveHistory(), LIVE_REFRESH_MS, false);
    }
  }

  bindControls() {
    const refreshButton = this.querySelector(".item-history-page__refresh");
    if (refreshButton) this.eventListener(refreshButton, "click", this.handleRefresh.bind(this));
    for (const select of this.querySelectorAll(".item-history-page__date-select")) {
      this.eventListener(select, "change", this.handleDateChange.bind(this));
    }
  }

  async handleRefresh() {
    await this.refreshLiveHistory(true);
  }

  async refreshLiveHistory(showLoader = false) {
    const trackingLive = this.data?.to === this.data?.live?.date;
    const from = trackingLive ? undefined : this.data?.from;
    const to = trackingLive ? undefined : this.data?.to;
    if (showLoader) {
      this.data = null;
      this.error = null;
      this.render();
    }
    await this.loadHistory(from, to);
  }

  async handleDateChange() {
    const from = this.querySelector(".item-history-page__from-date").value;
    const to = this.querySelector(".item-history-page__to-date").value;
    if (from > to) {
      this.error = new Error("The starting snapshot must not be later than the ending snapshot.");
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
    if (this.data.dates.length === 0) {
      return `<div class="item-history-page__storage">${storageText}</div>`;
    }
    const minDate = this.data.dates[0];
    const maxDate = this.data.dates[this.data.dates.length - 1];
    return `
      <div class="item-history-page__controls rsborder-tiny rsbackground">
        <label>From<input type="date" class="item-history-page__date-select item-history-page__from-date"
          value="${this.data.from}" min="${minDate}" max="${maxDate}" /></label>
        <label>To<input type="date" class="item-history-page__date-select item-history-page__to-date"
          value="${this.data.to}" min="${minDate}" max="${maxDate}" /></label>
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
    if (this.data.dates.length === 0) {
      return '<div class="item-history-page__message rsborder rsbackground">No item snapshots are available yet.</div>';
    }

    const liveLabel = this.data.to === this.data.live?.date ? " (Today, live)" : "";
    const title = this.data.singleDay
      ? `${this.formatDate(this.data.to)} daily diff`
      : `${this.formatDate(this.data.from)} to ${this.formatDate(this.data.to)}`;
    const updatedLabel =
      this.data.to === this.data.live?.date && this.data.live.updatedAt
        ? `<span class="item-history-page__live-update">Updated ${new Date(
            this.data.live.updatedAt
          ).toLocaleTimeString()}</span>`
        : "";
    const baselineLabel =
      this.data.singleDay && this.data.baselineAvailable === false
        ? '<span class="item-history-page__live-update">Tracking started on this date, so earlier changes are unavailable.</span>'
        : "";
    return `
      <section class="item-history-page__day rsborder rsbackground">
        <h2>${title}${liveLabel}</h2>
        ${updatedLabel}
        ${baselineLabel}
        ${this.renderChargeChanges(this.data.charge_changes || [])}
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

  renderChargeChanges(changes) {
    if (changes.length === 0) return "";
    const items = changes
      .map((change) => {
        const details = Item.itemDetails?.[change.item_id];
        const image = details ? Item.imageUrl(change.item_id, 1) : "";
        const imageHtml = image ? `<img src="${image}" width="36" height="32" loading="lazy" />` : "";
        const difference = `${change.difference > 0 ? "+" : ""}${change.difference.toLocaleString()}`;
        return `
          <div class="item-history-page__charge-item">
            ${imageHtml}
            <span><strong>${
              change.name
            }</strong> charges went from ${change.from.toLocaleString()} → ${change.to.toLocaleString()}</span>
            <strong class="${change.difference > 0 ? "positive" : "negative"}">${difference}</strong>
          </div>
        `;
      })
      .join("");
    return `
      <div class="item-history-page__charges">
        <h3>Charge changes (${changes.length})</h3>
        <div class="item-history-page__charge-items">${items}</div>
      </div>
    `;
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
