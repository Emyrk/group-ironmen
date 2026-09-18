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

export class CombatAchievementsPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.data = null;
    this.error = null;
    this.filters = { search: "", monster: "", type: "", status: "" };
    this.render();
    this.subscribeOnce("get-group-data", () => this.load(localStorage.getItem(CHARACTER_KEY) || undefined));
  }

  html() {
    return `{{combat-achievements-page.html}}`;
  }

  async load(character) {
    try {
      this.data = await api.getMediumCombatAchievements(character);
      if (!this.data.selectedCharacter) {
        await api.getGoalMap(character);
        this.data = await api.getMediumCombatAchievements(character);
      }
      this.error = null;
      if (this.data.selectedCharacter) localStorage.setItem(CHARACTER_KEY, this.data.selectedCharacter);
    } catch (error) {
      console.error(error);
      this.error = error;
    }
    this.render();
    this.bindControls();
  }

  bindControls() {
    const character = this.querySelector(".combat-achievements-page__character");
    const externalPoints = this.querySelector(".combat-achievements-page__external-points");
    if (character) this.eventListener(character, "change", (event) => this.load(event.target.value));
    if (externalPoints) this.eventListener(externalPoints, "change", this.handleExternalPoints.bind(this));
    for (const control of this.querySelectorAll(".combat-achievements-page__filter")) {
      this.eventListener(control, "input", this.handleFilter.bind(this));
    }
    for (const select of this.querySelectorAll(".combat-achievements-page__task-status")) {
      this.eventListener(select, "change", this.handleTaskSave.bind(this));
    }
    for (const button of this.querySelectorAll(".combat-achievements-page__save-notes")) {
      this.eventListener(button, "click", this.handleTaskSave.bind(this));
    }
  }

  async handleExternalPoints(event) {
    const points = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
    this.data = await api.updateMediumCombatAchievementPoints(this.data.selectedCharacter, points);
    this.render();
    this.bindControls();
  }

  handleFilter(event) {
    this.filters[event.currentTarget.dataset.filter] = event.currentTarget.value;
    const list = this.querySelector(".combat-achievements-page__tasks");
    if (list) list.innerHTML = this.renderTasks();
    this.bindControls();
  }

  async handleTaskSave(event) {
    const row = event.currentTarget.closest(".combat-achievements-page__task");
    const taskId = row.dataset.taskId;
    const status = row.querySelector(".combat-achievements-page__task-status").value;
    const notes = row.querySelector(".combat-achievements-page__notes").value;
    this.data = await api.updateMediumCombatAchievement(this.data.selectedCharacter, taskId, status, notes);
    this.render();
    this.bindControls();
  }

  summary() {
    const completed = this.data.tasks.filter((task) => task.status === "completed").length;
    const planned = this.data.tasks.filter((task) => task.status === "planned").length;
    const earned = this.data.externalPoints + completed * this.data.pointsPerTask;
    const projected = earned + planned * this.data.pointsPerTask;
    const remaining = Math.max(0, this.data.rewardPoints - earned);
    return {
      completed,
      planned,
      earned,
      projected,
      remaining,
      tasksNeeded: Math.ceil(remaining / this.data.pointsPerTask),
    };
  }

  filteredTasks() {
    const search = this.filters.search.toLowerCase();
    return this.data.tasks
      .filter((task) => !this.filters.monster || task.monster === this.filters.monster)
      .filter((task) => !this.filters.type || task.type === this.filters.type)
      .filter((task) => !this.filters.status || task.status === this.filters.status)
      .filter((task) => !search || `${task.name} ${task.monster} ${task.description}`.toLowerCase().includes(search))
      .sort((left, right) => {
        const statusRank = { planned: 0, unplanned: 1, completed: 2 };
        return statusRank[left.status] - statusRank[right.status] || right.completionPercent - left.completionPercent;
      });
  }

  renderHeader() {
    if (!this.data) return "";
    return `
      <label>Character<select class="combat-achievements-page__character">${this.data.characters
        .map(
          (character) =>
            `<option${character === this.data.selectedCharacter ? " selected" : ""}>${escapeHtml(character)}</option>`
        )
        .join("")}</select></label>
    `;
  }

  renderCalculator() {
    const summary = this.summary();
    return `
      <section class="combat-achievements-page__calculator rsborder-tiny rsbackground">
        <div><strong>${summary.earned}</strong><span>/ ${this.data.rewardPoints} points earned</span></div>
        <div><strong>${summary.projected}</strong><span>points with planned tasks</span></div>
        <div><strong>${summary.tasksNeeded}</strong><span>more Medium tasks needed</span></div>
        <label>Points from Easy/Hard+ tasks<input class="combat-achievements-page__external-points" type="number" min="0" max="2697" value="${this.data.externalPoints}" /></label>
      </section>
    `;
  }

  renderFilters() {
    const monsters = [...new Set(this.data.tasks.map((task) => task.monster))].sort();
    const types = [...new Set(this.data.tasks.map((task) => task.type))].sort();
    const options = (values, selected) =>
      values.map((value) => `<option${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
    return `
      <section class="combat-achievements-page__filters rsborder-tiny rsbackground">
        <input class="combat-achievements-page__filter" data-filter="search" placeholder="Search tasks" value="${escapeHtml(
          this.filters.search
        )}" />
        <select class="combat-achievements-page__filter" data-filter="monster"><option value="">All bosses</option>${options(
          monsters,
          this.filters.monster
        )}</select>
        <select class="combat-achievements-page__filter" data-filter="type"><option value="">All types</option>${options(
          types,
          this.filters.type
        )}</select>
        <select class="combat-achievements-page__filter" data-filter="status"><option value="">All statuses</option>${options(
          ["unplanned", "planned", "completed"],
          this.filters.status
        )}</select>
      </section>
    `;
  }

  renderTasks() {
    const tasks = this.filteredTasks();
    if (!tasks.length) return '<p class="combat-achievements-page__message">No tasks match these filters.</p>';
    return tasks
      .map(
        (task) => `
        <article class="combat-achievements-page__task ${task.status}" data-task-id="${escapeHtml(task.id)}">
          <header><div><small>${escapeHtml(task.monster)} · ${escapeHtml(task.type)}</small><h2>${escapeHtml(
          task.name
        )}</h2></div><strong>${task.points} pts</strong></header>
          <p>${escapeHtml(task.description)}</p>
          <div class="combat-achievements-page__task-meta"><span>${
            task.completionPercent
          }% community completion</span><a href="${escapeHtml(
          task.wikiUrl
        )}" target="_blank" rel="noopener noreferrer">Wiki</a></div>
          <div class="combat-achievements-page__task-plan">
            <select class="combat-achievements-page__task-status">
              ${["unplanned", "planned", "completed"]
                .map(
                  (status) =>
                    `<option value="${status}"${status === task.status ? " selected" : ""}>${status.replace(
                      "unplanned",
                      "Not planned"
                    )}</option>`
                )
                .join("")}
            </select>
            <textarea class="combat-achievements-page__notes" maxlength="500" placeholder="Plan, gear, or strategy notes">${escapeHtml(
              task.notes
            )}</textarea>
            <button class="combat-achievements-page__save-notes men-button" type="button">Save notes</button>
          </div>
        </article>`
      )
      .join("");
  }

  renderContent() {
    if (this.error)
      return `<p class="combat-achievements-page__message rsborder rsbackground">${escapeHtml(this.error.message)}</p>`;
    if (!this.data)
      return '<p class="combat-achievements-page__message rsborder rsbackground">Loading Combat Achievements...</p>';
    if (!this.data.selectedCharacter)
      return '<p class="combat-achievements-page__message">Open the Goal Map once to load group characters.</p>';
    return `${this.renderCalculator()}${this.renderFilters()}<section class="combat-achievements-page__tasks">${this.renderTasks()}</section>`;
  }
}

customElements.define("combat-achievements-page", CombatAchievementsPage);
