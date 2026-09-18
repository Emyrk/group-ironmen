import cytoscape from "cytoscape";
import { BaseElement } from "../base-element/base-element";
import { api } from "../data/api";
import { Item } from "../data/item";
import { Skill } from "../data/skill";

const SELECTED_CHARACTER_KEY = "goalMapSelectedCharacter";
const PINNED_OBJECTIVES_KEY = "goalMapPinnedObjectives";
const LAYOUT_KEY = "goalMapLayout";
const NODE_TYPES = new Set(["goal", "activity", "item", "skill", "unlock"]);
const EDGE_TYPES = new Set(["requires", "recommended", "optional", "alternative", "unlocks", "improves", "supplies"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeWikiUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export class GoalMapPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.data = null;
    this.error = null;
    this.loading = true;
    this.selectedNodeId = null;
    this.pinnedNodeIds = new Set();
    this.layout = this.savedLayout;
    this.selectedSkill = "";
    this.requestNumber = 0;
    this.render();
    this.bindControls();
    this.subscribeOnce("get-group-data", () => this.loadGoalMap(this.savedCharacter));
  }

  disconnectedCallback() {
    this.destroyGraph();
    super.disconnectedCallback();
  }

  get savedCharacter() {
    return localStorage.getItem(SELECTED_CHARACTER_KEY) || undefined;
  }

  get layoutKey() {
    return `${LAYOUT_KEY}:${api.groupName || "unknown"}`;
  }

  get savedLayout() {
    return localStorage.getItem(this.layoutKey) === "list" ? "list" : "graph";
  }

  get pinnedObjectivesKey() {
    return `${PINNED_OBJECTIVES_KEY}:${api.groupName || "unknown"}`;
  }

  loadPinnedObjectives() {
    const validNodeIds = new Set(this.data?.nodes.map((node) => node.id) || []);
    try {
      const stored = JSON.parse(localStorage.getItem(this.pinnedObjectivesKey) || "[]");
      this.pinnedNodeIds = new Set(Array.isArray(stored) ? stored.filter((nodeId) => validNodeIds.has(nodeId)) : []);
    } catch {
      this.pinnedNodeIds = new Set();
    }
    this.savePinnedObjectives();
  }

  savePinnedObjectives() {
    localStorage.setItem(this.pinnedObjectivesKey, JSON.stringify([...this.pinnedNodeIds]));
  }

  html() {
    return `{{goal-map-page.html}}`;
  }

  render() {
    this.destroyGraph();
    super.render();
  }

  destroyGraph() {
    if (this.graph) {
      this.graph.destroy();
      this.graph = null;
    }
  }

  async loadGoalMap(character) {
    const requestNumber = ++this.requestNumber;
    this.loading = true;
    this.error = null;
    this.render();
    this.bindControls();

    try {
      const data = await api.getGoalMap(character);
      if (requestNumber !== this.requestNumber) return;
      this.data = {
        ...data,
        characters: Array.isArray(data.characters) ? data.characters : [],
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
      };
      this.selectedCharacter = data.selectedCharacter || character || this.data.characters[0] || "";
      if (this.selectedCharacter) localStorage.setItem(SELECTED_CHARACTER_KEY, this.selectedCharacter);
      this.loadPinnedObjectives();
      if (!this.data.nodes.some((node) => node.id === this.selectedNodeId)) {
        this.selectedNodeId = this.data.nodes[0]?.id || null;
      }
    } catch (error) {
      if (requestNumber !== this.requestNumber) return;
      console.error(error);
      this.error = error;
    }

    if (requestNumber !== this.requestNumber) return;
    this.loading = false;
    this.render();
    this.bindControls();
    this.initializeGraph();
  }

  bindControls() {
    const selector = this.querySelector(".goal-map-page__character");
    const refresh = this.querySelector(".goal-map-page__refresh");
    const skill = this.querySelector(".goal-map-page__skill-filter");
    if (selector) this.eventListener(selector, "change", this.handleCharacterChange.bind(this));
    if (refresh) this.eventListener(refresh, "click", this.handleRefresh.bind(this));
    if (skill) this.eventListener(skill, "change", this.handleSkillChange.bind(this));
    for (const button of this.querySelectorAll(".goal-map-page__layout-button")) {
      this.eventListener(button, "click", this.handleLayoutChange.bind(this));
    }
    for (const button of this.querySelectorAll(
      ".goal-map-page__fallback-node, .goal-map-page__objective-select, .goal-map-page__explorer-select"
    )) {
      this.eventListener(button, "click", this.handleObjectiveClick.bind(this));
    }
    for (const button of this.querySelectorAll(".goal-map-page__objective-pin, .goal-map-page__detail-pin")) {
      this.eventListener(button, "click", this.handlePinClick.bind(this));
    }
  }

  handleCharacterChange(event) {
    const character = event.target.value;
    localStorage.setItem(SELECTED_CHARACTER_KEY, character);
    this.selectedNodeId = null;
    this.loadGoalMap(character);
  }

  handleRefresh() {
    this.loadGoalMap(this.selectedCharacter || this.savedCharacter);
  }

  handleLayoutChange(event) {
    const layout = event.currentTarget.dataset.layout;
    if (layout !== "graph" && layout !== "list") return;
    this.layout = layout;
    localStorage.setItem(this.layoutKey, layout);
    this.render();
    this.bindControls();
    this.initializeGraph();
  }

  handleSkillChange(event) {
    this.selectedSkill = event.target.value;
    const explorer = this.querySelector(".goal-map-page__explorer");
    if (explorer) explorer.innerHTML = this.renderGoalExplorer();
    this.bindControls();
  }

  handleObjectiveClick(event) {
    this.selectNode(event.currentTarget.dataset.nodeId);
  }

  handlePinClick(event) {
    const nodeId = event.currentTarget.dataset.nodeId;
    if (this.pinnedNodeIds.has(nodeId)) this.pinnedNodeIds.delete(nodeId);
    else this.pinnedNodeIds.add(nodeId);
    this.savePinnedObjectives();
    this.renderObjectiveSidebar();
  }

  renderObjectiveSidebar() {
    const list = this.querySelector(".goal-map-page__objectives");
    const explorer = this.querySelector(".goal-map-page__explorer");
    const details = this.querySelector(".goal-map-page__details");
    if (list) list.innerHTML = this.renderObjectiveList();
    if (explorer) explorer.innerHTML = this.renderGoalExplorer();
    if (details) details.innerHTML = this.renderDetails();
    this.bindControls();
  }

  selectNode(nodeId) {
    this.selectedNodeId = nodeId;
    const details = this.querySelector(".goal-map-page__details");
    if (details) details.innerHTML = this.renderDetails();
    for (const button of this.querySelectorAll(
      ".goal-map-page__fallback-node, .goal-map-page__objective-select, .goal-map-page__explorer-select"
    )) {
      button.classList.toggle("selected", button.dataset.nodeId === nodeId);
    }
    this.bindControls();
    if (this.graph) {
      this.graph.nodes().removeClass("selected");
      const node = this.graph.getElementById(nodeId);
      node.addClass("selected");
      this.graph.animate({ center: { eles: node }, duration: 200 });
    }
  }

  getNodeStatus(node) {
    if (node.evaluated?.complete) return "complete";
    const requiredSources = (this.data?.edges || [])
      .filter((edge) => edge.target === node.id && edge.type === "requires")
      .map((edge) => edge.source);
    if (requiredSources.length === 0) return "available";
    const nodeById = new Map(this.data.nodes.map((candidate) => [candidate.id, candidate]));
    return requiredSources.every((source) => nodeById.get(source)?.evaluated?.complete) ? "available" : "blocked";
  }

  getSummary() {
    const summary = { complete: 0, available: 0, blocked: 0 };
    for (const node of this.data?.nodes || []) summary[this.getNodeStatus(node)] += 1;
    return summary;
  }

  renderControls() {
    const characters = this.data?.characters || [];
    const options = characters
      .map((character) => {
        const selected = character === this.selectedCharacter ? " selected" : "";
        return `<option value="${escapeHtml(character)}"${selected}>${escapeHtml(character)}</option>`;
      })
      .join("");
    const disabled = this.loading || characters.length === 0 ? " disabled" : "";
    return `
      <div class="goal-map-page__layout-controls" role="group" aria-label="Goal layout">
        <button class="goal-map-page__layout-button men-button${
          this.layout === "graph" ? " selected" : ""
        }" type="button" data-layout="graph" aria-pressed="${this.layout === "graph"}">Graph</button>
        <button class="goal-map-page__layout-button men-button${
          this.layout === "list" ? " selected" : ""
        }" type="button" data-layout="list" aria-pressed="${this.layout === "list"}">List</button>
      </div>
      <label class="goal-map-page__character-label">
        Character
        <select class="goal-map-page__character"${disabled}>${options}</select>
      </label>
      <button class="goal-map-page__refresh men-button" type="button"${this.loading ? " disabled" : ""}>Refresh</button>
    `;
  }

  renderContent() {
    if (this.error) {
      return `<div class="goal-map-page__message rsborder rsbackground">${escapeHtml(this.error.message)}</div>`;
    }
    if (this.loading || !this.data) {
      return '<div class="goal-map-page__message rsborder rsbackground">Loading goal map...</div>';
    }
    if (this.data.nodes.length === 0) {
      return '<div class="goal-map-page__message rsborder rsbackground">No goals are available for this character.</div>';
    }

    const summary = this.getSummary();
    const updated = this.data.updatedAt
      ? `<span class="goal-map-page__updated">Updated ${escapeHtml(
          new Date(this.data.updatedAt).toLocaleString()
        )}</span>`
      : "";
    return `
      <section class="goal-map-page__summary" aria-label="Goal map summary">
        <span class="complete"><strong>${summary.complete}</strong> complete</span>
        <span class="available"><strong>${summary.available}</strong> available</span>
        <span class="blocked"><strong>${summary.blocked}</strong> blocked</span>
        ${updated}
      </section>
      ${this.layout === "list" ? this.renderListWorkspace() : this.renderGraphWorkspace()}
    `;
  }

  renderGraphWorkspace() {
    return `
      <div class="goal-map-page__workspace">
        <div class="goal-map-page__visual rsborder-tiny rsbackground">
          <div class="goal-map-page__graph" aria-label="Interactive goal map"></div>
          <div class="goal-map-page__fallback" aria-label="Goal map list">
            <p>Graph view is unavailable. Select a goal from the list.</p>
            <div class="goal-map-page__fallback-list">${this.renderFallbackNodes()}</div>
          </div>
        </div>
        <div class="goal-map-page__sidebar">
          <section class="goal-map-page__objectives rsborder-tiny rsbackground" aria-label="Objectives">
            ${this.renderObjectiveList()}
          </section>
          <aside class="goal-map-page__details rsborder-tiny rsbackground">${this.renderDetails()}</aside>
        </div>
      </div>
    `;
  }

  renderListWorkspace() {
    return `
      <div class="goal-map-page__workspace goal-map-page__workspace--list">
        <main class="goal-map-page__explorer rsborder-tiny rsbackground" aria-label="Goal explorer">
          ${this.renderGoalExplorer()}
        </main>
        <aside class="goal-map-page__details rsborder-tiny rsbackground">${this.renderDetails()}</aside>
      </div>
    `;
  }

  getSkillRequirements(node) {
    const evidence = Array.isArray(node.evaluated?.evidence) ? node.evaluated.evidence : [];
    return evidence
      .filter((entry) => entry?.type === "skill" && entry.skill)
      .filter(
        (entry, index, entries) =>
          entries.findIndex(
            (candidate) => candidate.skill === entry.skill && candidate.requiredLevel === entry.requiredLevel
          ) === index
      )
      .sort((left, right) => left.skill.localeCompare(right.skill));
  }

  renderSkillRequirements(node, compact = false) {
    const requirements = this.getSkillRequirements(node);
    if (requirements.length === 0) return "";
    return `<div class="goal-map-page__skill-requirements${compact ? " compact" : ""}">${requirements
      .map((requirement) => {
        const complete = Number(requirement.level) >= Number(requirement.requiredLevel);
        const icon = Skill.getIcon(requirement.skill);
        return `<span class="goal-map-page__skill-requirement ${
          complete ? "complete" : "incomplete"
        }" title="${escapeHtml(`${requirement.skill}: ${requirement.level}/${requirement.requiredLevel}`)}">
          ${icon ? `<img src="${escapeHtml(icon)}" alt="${escapeHtml(requirement.skill)}" />` : ""}
          <strong>${escapeHtml(requirement.level)}</strong><span>/</span><strong>${escapeHtml(
          requirement.requiredLevel
        )}</strong>
        </span>`;
      })
      .join("")}</div>`;
  }

  getNodeSkills(node) {
    return [...new Set(this.getSkillRequirements(node).map((entry) => entry.skill))];
  }

  getSkills() {
    return [...new Set(this.data.nodes.flatMap((node) => this.getNodeSkills(node)))].sort((left, right) =>
      left.localeCompare(right)
    );
  }

  getBenefits(nodeId) {
    const nodeById = new Map(this.data.nodes.map((node) => [node.id, node]));
    return this.data.edges
      .filter((edge) => edge.source === nodeId && nodeById.has(edge.target))
      .map((edge) => ({ ...edge, targetNode: nodeById.get(edge.target) }));
  }

  benefitVerb(type) {
    return (
      {
        requires: "Required for",
        recommended: "Recommended for",
        optional: "Optional for",
        alternative: "Alternative for",
        unlocks: "Unlocks",
        improves: "Improves",
        supplies: "Supplies",
      }[type] || "Benefits"
    );
  }

  renderBenefits(nodeId, emptyMessage = true) {
    const benefits = this.getBenefits(nodeId);
    if (benefits.length === 0)
      return emptyMessage ? '<p class="goal-map-page__no-benefits">No downstream benefits mapped.</p>' : "";
    return `<ul class="goal-map-page__benefit-list">${benefits
      .map(
        (benefit) =>
          `<li><strong>${escapeHtml(this.benefitVerb(benefit.type))} ${escapeHtml(benefit.targetNode.title)}</strong>${
            benefit.label ? `<span>${escapeHtml(benefit.label)}</span>` : ""
          }</li>`
      )
      .join("")}</ul>`;
  }

  renderGoalExplorer() {
    const skills = this.getSkills();
    if (this.selectedSkill && !skills.includes(this.selectedSkill)) this.selectedSkill = "";
    const options = ["", ...skills]
      .map(
        (skill) =>
          `<option value="${escapeHtml(skill)}"${skill === this.selectedSkill ? " selected" : ""}>${escapeHtml(
            skill || "All skills"
          )}</option>`
      )
      .join("");
    const nodes = this.data.nodes
      .filter((node) => !this.selectedSkill || this.getNodeSkills(node).includes(this.selectedSkill))
      .sort((left, right) => {
        const pinnedDifference = Number(this.pinnedNodeIds.has(right.id)) - Number(this.pinnedNodeIds.has(left.id));
        return pinnedDifference || left.title.localeCompare(right.title);
      });
    return `
      <header class="goal-map-page__explorer-header">
        <div><h2>Goal explorer</h2><p>Browse objectives by skill and see what each one benefits.</p></div>
        <label>Skill<select class="goal-map-page__skill-filter">${options}</select></label>
      </header>
      <div class="goal-map-page__explorer-list">
        ${
          nodes.length > 0
            ? nodes.map((node) => this.renderExplorerGoal(node)).join("")
            : "<p>No goals use this skill.</p>"
        }
      </div>
    `;
  }

  renderExplorerGoal(node) {
    const status = this.getNodeStatus(node);
    const pinned = this.pinnedNodeIds.has(node.id);
    const selected = node.id === this.selectedNodeId ? " selected" : "";
    return `
      <article class="goal-map-page__explorer-goal ${status}${pinned ? " pinned" : ""}">
        <div class="goal-map-page__explorer-title">
          <button class="goal-map-page__explorer-select${selected}" type="button" data-node-id="${escapeHtml(node.id)}">
            ${node.category ? `<small class="goal-map-page__category">${escapeHtml(node.category)}</small>` : ""}
            <span>${escapeHtml(
              node.title
            )}</span><small><span class="goal-map-page__status-dot ${status}"></span>${status} · ${escapeHtml(
      node.scope || "character"
    )}</small>
          </button>
          <button class="goal-map-page__objective-pin" type="button" data-node-id="${escapeHtml(
            node.id
          )}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${pinned ? "Unpin" : "Pin"} ${escapeHtml(
      node.title
    )}" title="${pinned ? "Unpin" : "Pin"}">${pinned ? "★" : "☆"}</button>
        </div>
        <p>${escapeHtml(node.description || "No description provided.")}</p>
        ${this.renderSkillRequirements(node)}
        <section class="goal-map-page__benefits"><h3>Benefits</h3>${this.renderBenefits(node.id)}</section>
      </article>
    `;
  }

  renderObjectiveList() {
    const pinned = this.data.nodes.filter((node) => this.pinnedNodeIds.has(node.id));
    const others = this.data.nodes.filter((node) => !this.pinnedNodeIds.has(node.id));
    const sections = [];
    if (pinned.length > 0) sections.push(this.renderObjectiveSection("Pinned", pinned));
    sections.push(this.renderObjectiveSection(pinned.length > 0 ? "Other objectives" : "All objectives", others));
    return `<h2>Objectives</h2>${sections.join("")}`;
  }

  renderObjectiveSection(title, nodes) {
    if (nodes.length === 0) return "";
    return `
      <section class="goal-map-page__objective-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="goal-map-page__objective-list">
          ${nodes.map((node) => this.renderObjective(node)).join("")}
        </div>
      </section>
    `;
  }

  renderObjective(node) {
    const status = this.getNodeStatus(node);
    const selected = node.id === this.selectedNodeId ? " selected" : "";
    const pinned = this.pinnedNodeIds.has(node.id);
    return `
      <div class="goal-map-page__objective ${status}${pinned ? " pinned" : ""}">
        <button class="goal-map-page__objective-select${selected}" type="button" data-node-id="${escapeHtml(node.id)}">
          <span>${escapeHtml(node.title)}</span>
          <small><span class="goal-map-page__status-dot ${status}"></span>${status} · ${escapeHtml(
      node.scope || "character"
    )}</small>
          ${this.renderSkillRequirements(node, true)}
        </button>
        <button class="goal-map-page__objective-pin" type="button" data-node-id="${escapeHtml(
          node.id
        )}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${pinned ? "Unpin" : "Pin"} ${escapeHtml(
      node.title
    )}" title="${pinned ? "Unpin" : "Pin"}">
          ${pinned ? "★" : "☆"}
        </button>
      </div>
    `;
  }

  renderFallbackNodes() {
    return this.data.nodes
      .map((node) => {
        const status = this.getNodeStatus(node);
        const type = NODE_TYPES.has(node.type) ? node.type : "goal";
        const selected = node.id === this.selectedNodeId ? " selected" : "";
        return `<button class="goal-map-page__fallback-node ${status} ${type}${selected}" type="button" data-node-id="${escapeHtml(
          node.id
        )}"><span>${escapeHtml(node.title)}</span><small>${escapeHtml(type)} · ${status}</small></button>`;
      })
      .join("");
  }

  formatProgress(progress) {
    if (progress === undefined || progress === null) return "Not reported";
    if (typeof progress !== "object") return String(progress);
    if (progress.observable === false) return "Not automatically observable";
    const current = progress.current ?? 0;
    const target = progress.target ?? 1;
    const unit = progress.unit === "level" ? " level" : "";
    return `${current}/${target}${unit}`;
  }

  formatEvidence(entry) {
    if (typeof entry !== "object" || entry === null) return String(entry);
    if (entry.message) return entry.message;
    if (entry.type === "quest") {
      return `${entry.name}: ${entry.state === 2 || entry.state === "FINISHED" ? "complete" : "incomplete"}`;
    }
    if (entry.type === "diary") return `${entry.region} ${entry.tier}: ${entry.completed}/${entry.total} tasks`;
    return JSON.stringify(entry);
  }

  renderEvidenceEntry(entry) {
    if (typeof entry === "object" && entry?.type === "diary" && Array.isArray(entry.tasks)) {
      return `
        <div class="goal-map-page__diary-evidence">
          <strong>${escapeHtml(entry.region)} ${escapeHtml(entry.tier)}: ${escapeHtml(entry.completed)}/${escapeHtml(
        entry.total
      )} tasks</strong>
          <ol class="goal-map-page__diary-tasks">
            ${entry.tasks
              .map(
                (task) =>
                  `<li class="${task.complete ? "complete" : "incomplete"}"><span aria-hidden="true">${
                    task.complete ? "✓" : "○"
                  }</span>${escapeHtml(task.name)}</li>`
              )
              .join("")}
          </ol>
        </div>
      `;
    }
    if (typeof entry === "object" && entry?.type === "item") {
      const details = Item.itemDetails?.[entry.itemId];
      if (details) {
        const quantity = Number(entry.quantity) || 0;
        return `
          <span class="goal-map-page__item-evidence">
            <img src="${escapeHtml(Item.imageUrl(entry.itemId, quantity))}" alt="" loading="lazy" />
            <span><strong>${escapeHtml(details.name)}</strong><small>${quantity.toLocaleString()} owned</small></span>
          </span>
        `;
      }
      return escapeHtml(`Item ${entry.itemId}: ${entry.quantity} owned`);
    }
    return escapeHtml(this.formatEvidence(entry));
  }

  renderDetails() {
    const node = this.data?.nodes.find((candidate) => candidate.id === this.selectedNodeId);
    if (!node) return "<p>Select a goal to see its details.</p>";
    const status = this.getNodeStatus(node);
    const evaluated = node.evaluated || {};
    const wikiUrl = safeWikiUrl(node.wikiUrl);
    const wikiLink = wikiUrl
      ? `<a class="goal-map-page__wiki" href="${escapeHtml(
          wikiUrl
        )}" target="_blank" rel="noopener noreferrer">Open wiki</a>`
      : "";
    const scope = node.scope ? `<span>${escapeHtml(node.scope)}</span>` : "";
    const pinned = this.pinnedNodeIds.has(node.id);
    const skillRequirements = this.getSkillRequirements(node);
    const progress = this.formatProgress(evaluated.progress);
    const progressRow =
      evaluated.progress?.unit === "level" && skillRequirements.length > 0
        ? ""
        : `<dt>Progress</dt><dd>${escapeHtml(progress)}</dd>`;
    const completedAt = evaluated.completedAt
      ? `<dt>Completed</dt><dd>${escapeHtml(new Date(evaluated.completedAt).toLocaleString())}</dd>`
      : "";
    return `
      <div class="goal-map-page__detail-heading">
        <span class="goal-map-page__status ${status}"><span class="goal-map-page__status-dot ${status}"></span>${status}</span>
        <span>${escapeHtml(NODE_TYPES.has(node.type) ? node.type : "goal")}</span>
        ${scope}
        ${node.category ? `<span>${escapeHtml(node.category)}</span>` : ""}
      </div>
      <div class="goal-map-page__detail-title">
        <h2>${escapeHtml(node.title)}</h2>
        <button class="goal-map-page__detail-pin men-button" type="button" data-node-id="${escapeHtml(
          node.id
        )}" aria-pressed="${pinned ? "true" : "false"}">${pinned ? "Unpin objective" : "Pin objective"}</button>
      </div>
      <p>${escapeHtml(node.description || "No description provided.")}</p>
      ${
        skillRequirements.length > 0
          ? `<section class="goal-map-page__requirements"><h3>Skill requirements</h3>${this.renderSkillRequirements(
              node
            )}</section>`
          : ""
      }
      <dl>
        ${progressRow}
        ${completedAt}
      </dl>
      ${this.renderEvidence(evaluated.evidence)}
      <section class="goal-map-page__benefits"><h3>Benefits</h3>${this.renderBenefits(node.id)}</section>
      ${wikiLink}
    `;
  }

  renderEvidence(evidence) {
    if (evidence === undefined || evidence === null || evidence === "") return "";
    const entries = (Array.isArray(evidence) ? evidence : [evidence]).filter((entry) => entry?.type !== "skill");
    if (entries.length === 0) return "";
    const items = entries.map((entry) => `<li>${this.renderEvidenceEntry(entry)}</li>`).join("");
    return `<section class="goal-map-page__evidence"><h3>Evidence</h3><ul>${items}</ul></section>`;
  }

  initializeGraph() {
    const container = this.querySelector(".goal-map-page__graph");
    const fallback = this.querySelector(".goal-map-page__fallback");
    if (!container || !this.data?.nodes.length) return;
    const bounds = container.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    try {
      this.graph = cytoscape({
        container,
        elements: [
          ...this.data.nodes.map((node) => ({
            data: { id: node.id, label: node.title },
            classes: `${this.getNodeStatus(node)} ${NODE_TYPES.has(node.type) ? node.type : "goal"} ${
              node.id === this.selectedNodeId ? "selected" : ""
            }`,
          })),
          ...this.data.edges.map((edge, index) => ({
            data: {
              id: `edge-${index}`,
              source: edge.source,
              target: edge.target,
              label: edge.label || edge.alternativeGroup || "",
            },
            classes: EDGE_TYPES.has(edge.type) ? edge.type : "requires",
          })),
        ],
        layout: { name: "breadthfirst", directed: true, padding: 35, spacingFactor: 1.2 },
        minZoom: 0.25,
        maxZoom: 2.5,
        wheelSensitivity: 0.2,
        style: this.graphStyles(),
      });
      this.graph.on("tap", "node", (event) => this.selectNode(event.target.id()));
      fallback.hidden = true;
    } catch (error) {
      console.warn("Cytoscape could not initialize; using the goal list fallback.", error);
      this.destroyGraph();
    }
  }

  graphStyles() {
    return [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: "#fff",
          "font-size": 11,
          "text-wrap": "wrap",
          "text-max-width": 105,
          "text-valign": "center",
          "text-halign": "center",
          width: 112,
          height: 48,
          "border-width": 3,
          "background-color": "#777",
          "border-color": "#aaa",
        },
      },
      { selector: "node.complete", style: { "background-color": "#286b35", "border-color": "#63d879" } },
      { selector: "node.available", style: { "background-color": "#775d16", "border-color": "#e6bd4b" } },
      { selector: "node.blocked", style: { "background-color": "#444", "border-color": "#777", opacity: 0.78 } },
      { selector: "node.goal", style: { shape: "round-rectangle" } },
      { selector: "node.activity", style: { shape: "ellipse" } },
      { selector: "node.item", style: { shape: "diamond", width: 76, height: 76 } },
      { selector: "node.skill", style: { shape: "hexagon" } },
      { selector: "node.unlock", style: { shape: "tag" } },
      { selector: "node.selected", style: { "border-width": 6, "border-color": "#fff" } },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#8d8d8d",
          "target-arrow-color": "#8d8d8d",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          label: "data(label)",
          color: "#ddd",
          "font-size": 9,
          "text-background-color": "#231f1a",
          "text-background-opacity": 0.85,
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge.recommended",
        style: { "line-style": "dashed", "line-color": "#d7a83e", "target-arrow-color": "#d7a83e" },
      },
      {
        selector: "edge.optional",
        style: { "line-style": "dotted", "line-color": "#75a9d6", "target-arrow-color": "#75a9d6" },
      },
      {
        selector: "edge.alternative",
        style: { "line-style": "dashed", "line-color": "#b77bd1", "target-arrow-color": "#b77bd1" },
      },
      { selector: "edge.unlocks", style: { "line-color": "#8bc34a", "target-arrow-color": "#8bc34a" } },
      { selector: "edge.improves", style: { "line-color": "#5bc0be", "target-arrow-color": "#5bc0be" } },
      {
        selector: "edge.supplies",
        style: { "line-color": "#e18450", "target-arrow-color": "#e18450", "target-arrow-shape": "vee" },
      },
    ];
  }
}

customElements.define("goal-map-page", GoalMapPage);
