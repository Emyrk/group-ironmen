import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { Item } from "../data/item";
import { utility } from "../utility";

const LIVE_REFRESH_MS = 15 * 60 * 1000;
const ITEM_RANKINGS_KEY = "itemHistoryRankings";
const ITEM_RANKS = ["ignore", "normal", "important"];

export class ItemHistoryPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.data = null;
    this.error = null;
    this.altMode = false;
    this.searchQuery = "";
    this.itemRankings = new Map();
    this.render();
    this.eventListener(window, "keydown", this.handleKeyDown.bind(this));
    this.eventListener(window, "keyup", this.handleKeyUp.bind(this));
    this.eventListener(window, "blur", this.disableAltMode.bind(this));
    this.eventListener(this, "click", this.handleRankingClick.bind(this), { passive: false });
    this.subscribeOnce("get-group-data", () => {
      this.loadItemRankings();
      this.loadHistory();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.historyInterval) window.clearInterval(this.historyInterval);
  }

  html() {
    return `{{item-history-page.html}}`;
  }

  get rankingStorageKey() {
    return `${ITEM_RANKINGS_KEY}:${api.groupName || "unknown"}`;
  }

  loadItemRankings() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.rankingStorageKey) || "{}");
      this.itemRankings = new Map(
        Object.entries(stored).filter(([, rank]) => rank === "important" || rank === "ignore")
      );
    } catch {
      this.itemRankings = new Map();
    }
  }

  saveItemRankings() {
    localStorage.setItem(this.rankingStorageKey, JSON.stringify(Object.fromEntries(this.itemRankings)));
  }

  itemRank(itemId) {
    return this.itemRankings.get(String(itemId)) || "normal";
  }

  setAltMode(enabled) {
    this.altMode = enabled;
    this.classList.toggle("item-history-page--ranking", enabled);
  }

  handleKeyDown(event) {
    if (event.key === "Alt" || event.altKey) this.setAltMode(true);
  }

  handleKeyUp(event) {
    if (event.key === "Alt") this.disableAltMode();
  }

  disableAltMode() {
    this.setAltMode(false);
  }

  handleRankingClick(event) {
    const button = event.target.closest("[data-rank-direction]");
    if (!button || (!event.altKey && !this.altMode)) return;
    event.preventDefault();
    const item = button.closest("[data-item-id]");
    if (!item) return;
    this.changeItemRank(item.dataset.itemId, button.dataset.rankDirection === "up" ? 1 : -1);
  }

  changeItemRank(itemId, direction) {
    const currentIndex = ITEM_RANKS.indexOf(this.itemRank(itemId));
    const nextRank = ITEM_RANKS[Math.max(0, Math.min(ITEM_RANKS.length - 1, currentIndex + direction))];
    if (nextRank === "normal") this.itemRankings.delete(String(itemId));
    else this.itemRankings.set(String(itemId), nextRank);
    this.saveItemRankings();
    this.render();
    this.bindControls();
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
    const search = this.querySelector(".item-history-page__search");
    if (search) this.eventListener(search, "input", this.handleSearchInput.bind(this));
  }

  handleSearchInput(event) {
    this.searchQuery = event.target.value;
    this.querySelector(".item-history-page__days").innerHTML = this.renderHistory();
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
        <label>Search<input type="search" class="item-history-page__search"
          value="${this.escapeHtml(this.searchQuery)}" placeholder="Filter items" /></label>
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
        <span class="item-history-page__ranking-help">Hold Alt to rank items: + Important, − Ignore.</span>
        ${this.renderHighAlch(this.data.high_alch)}
        ${this.renderChargeChanges(this.data.charge_changes || [])}
        <div class="item-history-page__columns">
          ${this.renderChanges("Gained", this.data.gained, "gained")}
          ${this.renderChanges("Lost", this.data.lost, "lost")}
        </div>
        ${this.renderIgnoredChanges()}
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

  escapeHtml(value) {
    return String(value).replace(
      /[&<>"]/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        }[character])
    );
  }

  matchesSearch(change) {
    if (!this.searchQuery.trim()) return true;
    const details = Item.itemDetails?.[change.item_id];
    const name = change.name || details?.name || `Item ${change.item_id}`;
    return `${name} ${change.item_id}`.toLowerCase().includes(this.searchQuery.trim().toLowerCase());
  }

  renderHighAlch(highAlch) {
    if (!highAlch) return "";
    const netClass = highAlch.net > 0 ? "positive" : highAlch.net < 0 ? "negative" : "";
    const netSign = highAlch.net > 0 ? "+" : "";
    return `
      <div class="item-history-page__high-alch">
        <span>Gained HA <strong class="positive">${highAlch.gained.toLocaleString()} gp</strong></span>
        <span>Lost HA <strong class="negative">${highAlch.lost.toLocaleString()} gp</strong></span>
        <span>Net HA <strong class="${netClass}">${netSign}${highAlch.net.toLocaleString()} gp</strong></span>
      </div>
    `;
  }

  renderChargeChanges(changes) {
    const filteredChanges = changes.filter((change) => this.matchesSearch(change));
    if (filteredChanges.length === 0) return "";
    const items = filteredChanges
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
            }</strong> (${change.from.toLocaleString()} -> ${change.to.toLocaleString()})</span>
            <strong class="${change.difference > 0 ? "positive" : "negative"}">${difference}</strong>
          </div>
        `;
      })
      .join("");
    return `
      <div class="item-history-page__charges">
        <h3>Charge changes (${filteredChanges.length})</h3>
        <div class="item-history-page__charge-items">${items}</div>
      </div>
    `;
  }

  renderChanges(title, changes, type, ignored = false) {
    const rankedChanges = changes
      .filter((change) => (this.itemRank(change.item_id) === "ignore") === ignored)
      .filter((change) => this.matchesSearch(change))
      .sort((a, b) => {
        const rankDifference =
          ITEM_RANKS.indexOf(this.itemRank(b.item_id)) - ITEM_RANKS.indexOf(this.itemRank(a.item_id));
        return rankDifference || b.quantity - a.quantity;
      });
    const items = rankedChanges.length
      ? rankedChanges.map((change) => this.renderItem(change, type)).join("")
      : '<div class="item-history-page__empty">No items</div>';
    return `
      <div class="item-history-page__change-group item-history-page__change-group--${type}">
        <h3>${title} (${rankedChanges.length})</h3>
        <div class="item-history-page__items">${items}</div>
      </div>
    `;
  }

  renderIgnoredChanges() {
    const ignoredCount = [...this.data.gained, ...this.data.lost].filter(
      (change) => this.itemRank(change.item_id) === "ignore"
    ).length;
    if (ignoredCount === 0) return "";
    return `
      <div class="item-history-page__ignored">
        <h3>Ignored (${ignoredCount})</h3>
        <div class="item-history-page__columns">
          ${this.renderChanges("Gained", this.data.gained, "gained", true)}
          ${this.renderChanges("Lost", this.data.lost, "lost", true)}
        </div>
      </div>
    `;
  }

  renderItem(change, type) {
    const details = Item.itemDetails?.[change.item_id];
    const name = details?.name || `Item ${change.item_id}`;
    const rank = this.itemRank(change.item_id);
    const image = details ? Item.imageUrl(change.item_id, change.quantity) : "";
    const imageHtml = image ? `<img src="${image}" width="36" height="32" loading="lazy" />` : "";
    return `
      <div class="item-history-page__item item-history-page__item--${type} item-history-page__item--${rank}"
           data-item-id="${change.item_id}">
        <a class="item-history-page__item-link"
           href="https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id=${change.item_id}"
           target="_blank">
          ${imageHtml}
          <span class="item-history-page__item-name">${name}</span>
          <strong>${type === "gained" ? "+" : "-"}${change.quantity.toLocaleString()}</strong>
        </a>
        <span class="item-history-page__ranking-controls" aria-label="Item ranking controls">
          <button type="button" data-rank-direction="down" title="Lower priority" ${
            rank === "ignore" ? "disabled" : ""
          }>−</button>
          <button type="button" data-rank-direction="up" title="Raise priority" ${
            rank === "important" ? "disabled" : ""
          }>+</button>
        </span>
      </div>
    `;
  }
}

customElements.define("item-history-page", ItemHistoryPage);
