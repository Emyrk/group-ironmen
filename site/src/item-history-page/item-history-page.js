import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { Item } from "../data/item";

export class ItemHistoryPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.history = null;
    this.error = null;
    this.render();
    this.loadHistory();
  }

  html() {
    return `{{item-history-page.html}}`;
  }

  async loadHistory() {
    try {
      this.history = await api.getItemHistory();
    } catch (error) {
      console.error(error);
      this.error = error;
    }
    this.render();
    const refreshButton = this.querySelector(".item-history-page__refresh");
    if (refreshButton) {
      this.eventListener(refreshButton, "click", this.handleRefresh.bind(this));
    }
  }

  async handleRefresh() {
    this.history = null;
    this.error = null;
    this.render();
    await this.loadHistory();
  }

  renderHistory() {
    if (this.error) {
      return `<div class="item-history-page__message rsborder rsbackground">${this.error.message}</div>`;
    }
    if (this.history === null) {
      return '<div class="item-history-page__message rsborder rsbackground">Loading item history...</div>';
    }
    if (this.history.length === 0) {
      return '<div class="item-history-page__message rsborder rsbackground">Two daily snapshots are needed before changes can be shown.</div>';
    }

    return this.history.map((day) => this.renderDay(day)).join("");
  }

  renderDay(day) {
    const date = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return `
      <section class="item-history-page__day rsborder rsbackground">
        <h2>${date}</h2>
        <div class="item-history-page__columns">
          ${this.renderChanges("Gained", day.gained, "gained")}
          ${this.renderChanges("Lost", day.lost, "lost")}
        </div>
      </section>
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
