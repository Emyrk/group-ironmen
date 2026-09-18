import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";

const CHARACTER_KEY = "combatAchievementsSelectedCharacter";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class PlayerCombatAchievements extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.playerName = this.getAttribute("player-name");
    localStorage.setItem(CHARACTER_KEY, this.playerName);
    this.data = null;
    this.error = null;
    this.render();
    this.load();
  }

  html() {
    if (this.error) return `<p>${escapeHtml(this.error.message)}</p>`;
    if (!this.data) return "<p>Loading Combat Achievements...</p>";
    const completed = this.data.tasks.filter((task) => task.syncedComplete || task.status === "completed").length;
    const synced = this.data.tasks.filter((task) => task.syncedComplete).length;
    return `
      <h2>Combat Achievements</h2>
      <p><strong>${completed}</strong> of ${this.data.tasks.length} Medium tasks complete.</p>
      <p>${synced} completion${synced === 1 ? "" : "s"} synchronized from RuneLite.</p>
      <a class="men-button" href="/group/combat-achievements">Open ${escapeHtml(this.playerName)}'s planner</a>
    `;
  }

  async load() {
    try {
      this.data = await api.getMediumCombatAchievements(this.playerName);
      this.error = null;
    } catch (error) {
      console.error(error);
      this.error = error;
    }
    this.render();
  }
}

customElements.define("player-combat-achievements", PlayerCombatAchievements);
