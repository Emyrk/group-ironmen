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
    const points = this.data.syncedSnapshot?.achievementPoints;
    return `
      <h2>Combat Achievements</h2>
      ${
        Number.isInteger(points)
          ? `<p><strong>${points}</strong> Combat Achievement points.</p>`
          : "<p>Combat Achievement points have not synchronized from RuneLite yet.</p>"
      }
      <button class="men-button" type="button">Open ${escapeHtml(this.playerName)}'s planner</button>
    `;
  }

  render() {
    this.unbindEvents();
    super.render();
    const button = this.querySelector("button.men-button");
    if (button) this.eventListener(button, "click", this.navigateToPlanner.bind(this));
  }

  navigateToPlanner() {
    localStorage.setItem(CHARACTER_KEY, this.playerName);
    window.history.pushState("", "", "/group/combat-achievements");
  }

  async load() {
    try {
      this.data = await api.getCombatAchievements(this.playerName);
      this.error = null;
    } catch (error) {
      console.error(error);
      this.error = error;
    }
    this.render();
  }
}

customElements.define("player-combat-achievements", PlayerCombatAchievements);
