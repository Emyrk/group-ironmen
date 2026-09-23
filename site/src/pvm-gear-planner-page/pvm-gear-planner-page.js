import { BaseElement } from "../base-element/base-element";

const TARGETS = {
  "giant-mole": { name: "Giant Mole", hitpoints: 200, defence: 0.94 },
  vorkath: { name: "Vorkath", hitpoints: 750, defence: 0.78 },
  "dagannoth-rex": { name: "Dagannoth Rex", hitpoints: 255, defence: 0.88 },
};

const GEAR = {
  head: [
    { id: 26382, name: "Torva full helm", offense: 8, prayer: 1, defence: 74, weight: 3.6, risk: 65000000 },
    { id: 24271, name: "Neitiznot faceguard", offense: 6, prayer: 3, defence: 63, weight: 2.7, risk: 22000000 },
    { id: 10828, name: "Helm of neitiznot", offense: 3, prayer: 3, defence: 45, weight: 2.7, risk: 50000 },
  ],
  body: [
    { id: 26384, name: "Torva platebody", offense: 6, prayer: 1, defence: 132, weight: 9.1, risk: 280000000 },
    { id: 11832, name: "Bandos chestplate", offense: 4, prayer: 1, defence: 117, weight: 12, risk: 30000000 },
    { id: 10551, name: "Fighter torso", offense: 4, prayer: 0, defence: 62, weight: 8, risk: 0 },
    { id: 9674, name: "Proselyte hauberk", offense: 0, prayer: 8, defence: 50, weight: 7.7, risk: 25000 },
  ],
  legs: [
    { id: 26386, name: "Torva platelegs", offense: 4, prayer: 1, defence: 112, weight: 9.1, risk: 190000000 },
    { id: 11834, name: "Bandos tassets", offense: 2, prayer: 1, defence: 71, weight: 8, risk: 20000000 },
    { id: 9676, name: "Proselyte cuisse", offense: 0, prayer: 6, defence: 38, weight: 5.4, risk: 15000 },
  ],
};

const SLOT_NAMES = { head: "Head", body: "Body", legs: "Legs" };
const PAPERDOLL_SLOTS = [
  { slot: "head", position: "head", emptyIcon: "156-0.png" },
  { position: "cape", emptyIcon: "157-0.png" },
  { position: "neck", emptyIcon: "158-0.png" },
  { position: "ammo", emptyIcon: "166-0.png" },
  { position: "weapon", emptyIcon: "159-0.png" },
  { slot: "body", position: "torso", emptyIcon: "161-0.png" },
  { position: "shield", emptyIcon: "162-0.png" },
  { slot: "legs", position: "legs", emptyIcon: "163-0.png" },
  { position: "gloves", emptyIcon: "164-0.png" },
  { position: "boots", emptyIcon: "165-0.png" },
  { position: "ring", emptyIcon: "160-0.png" },
];

function total(items, field) {
  return items.reduce((sum, item) => sum + item[field], 0);
}

export function calculatePreview(loadout, targetId) {
  const items = Object.values(loadout);
  const target = TARGETS[targetId] || TARGETS["giant-mole"];
  const offense = total(items, "offense");
  const dps = (6.4 + offense * 0.085) * target.defence;
  return {
    dps,
    accuracy: Math.min(99, 68 + offense * 0.9) * target.defence,
    ttk: target.hitpoints / dps,
    prayer: total(items, "prayer"),
    defence: total(items, "defence"),
    weight: total(items, "weight"),
    risk: total(items, "risk"),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function formatRisk(value) {
  if (value >= 1000000) return `${formatNumber(value / 1000000)}m`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return `${value}`;
}

function tierFor(dps, bestDps) {
  const loss = bestDps === 0 ? 0 : (bestDps - dps) / bestDps;
  if (loss <= 0.005) return "S";
  if (loss <= 0.02) return "A";
  if (loss <= 0.05) return "B";
  return "C";
}

export class PvmGearPlannerPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.groupData = null;
    this.selectedMember = "";
    this.targetId = "giant-mole";
    this.activeSlot = "body";
    this.selectedItems = Object.fromEntries(Object.entries(GEAR).map(([slot, options]) => [slot, options[0]]));
    this.renderAndBind();
    this.subscribe("get-group-data", this.handleGroupData.bind(this));
  }

  html() {
    return `{{pvm-gear-planner-page.html}}`;
  }

  handleGroupData(groupData) {
    this.groupData = groupData;
    const members = this.members;
    if (!members.some((member) => member.name === this.selectedMember)) {
      this.selectedMember = members[0]?.name || "";
    }
    this.chooseOwnedDefaults();
    this.renderAndBind();
  }

  get members() {
    return this.groupData ? [...this.groupData.members.values()] : [];
  }

  get selectedMemberData() {
    return this.groupData?.members.get(this.selectedMember);
  }

  isOwned(item) {
    if (!this.selectedMemberData) return true;
    return this.selectedMemberData.totalItemQuantity(item.id) > 0;
  }

  chooseOwnedDefaults() {
    if (!this.selectedMemberData) return;
    for (const [slot, options] of Object.entries(GEAR)) {
      if (!this.isOwned(this.selectedItems[slot])) {
        this.selectedItems[slot] = options.find((item) => this.isOwned(item)) || options[0];
      }
    }
  }

  renderAndBind() {
    this.render();
    this.bindControls();
  }

  bindControls() {
    const member = this.querySelector("[data-control='member']");
    const target = this.querySelector("[data-control='target']");
    if (member) this.eventListener(member, "change", this.handleMemberChange.bind(this));
    if (target) this.eventListener(target, "change", this.handleTargetChange.bind(this));
    for (const button of this.querySelectorAll("[data-slot]")) {
      this.eventListener(button, "click", this.handleSlotClick.bind(this));
    }
    for (const button of this.querySelectorAll("[data-equip-item]")) {
      this.eventListener(button, "click", this.handleEquipClick.bind(this));
    }
  }

  handleMemberChange(event) {
    this.selectedMember = event.target.value;
    this.chooseOwnedDefaults();
    this.renderAndBind();
  }

  handleTargetChange(event) {
    this.targetId = event.target.value;
    this.renderAndBind();
  }

  handleSlotClick(event) {
    this.activeSlot = event.currentTarget.dataset.slot;
    this.renderAndBind();
  }

  handleEquipClick(event) {
    const item = GEAR[this.activeSlot].find((option) => option.id === Number(event.currentTarget.dataset.equipItem));
    if (!item || !this.isOwned(item)) return;
    this.selectedItems[this.activeSlot] = item;
    this.renderAndBind();
  }

  itemImage(item) {
    return `/icons/items/${item.id}.webp`;
  }

  renderMemberOptions() {
    if (this.members.length === 0) return '<option value="">Preview loadout</option>';
    return this.members
      .map((member) => {
        const name = escapeHtml(member.name);
        return `<option value="${name}" ${member.name === this.selectedMember ? "selected" : ""}>${name}</option>`;
      })
      .join("");
  }

  renderTargetOptions() {
    return Object.entries(TARGETS)
      .map(([id, target]) => `<option value="${id}" ${id === this.targetId ? "selected" : ""}>${target.name}</option>`)
      .join("");
  }

  renderPaperdoll() {
    return PAPERDOLL_SLOTS.map(({ slot, position, emptyIcon }) => {
      if (!slot) {
        return `
          <div class="pvm-gear-planner-page__paperdoll-slot position-${position} empty" title="${position} options coming soon">
            <img src="/ui/${emptyIcon}" alt="" />
          </div>`;
      }

      const item = this.selectedItems[slot];
      return `
        <button
          class="pvm-gear-planner-page__paperdoll-slot position-${position} ${slot === this.activeSlot ? "active" : ""}"
          data-slot="${slot}"
          title="${SLOT_NAMES[slot]}: ${item.name}"
          aria-label="Choose ${SLOT_NAMES[slot].toLowerCase()} equipment. Currently ${item.name}."
        >
          <img src="${this.itemImage(item)}" alt="" />
        </button>`;
    }).join("");
  }

  resultFor(item) {
    return calculatePreview({ ...this.selectedItems, [this.activeSlot]: item }, this.targetId);
  }

  renderAlternatives() {
    const current = calculatePreview(this.selectedItems, this.targetId);
    const ranked = GEAR[this.activeSlot]
      .map((item) => ({ item, result: this.resultFor(item) }))
      .sort((a, b) => b.result.dps - a.result.dps || b.result.prayer - a.result.prayer);
    const bestDps = ranked[0]?.result.dps || 0;
    return ranked
      .map(({ item, result }) => {
        const selected = this.selectedItems[this.activeSlot].id === item.id;
        const owned = this.isOwned(item);
        const dpsChange = ((result.dps - current.dps) / current.dps) * 100;
        return `
          <article class="pvm-gear-planner-page__alternative ${selected ? "selected" : ""} ${owned ? "" : "unowned"}">
            <div class="pvm-gear-planner-page__tier tier-${tierFor(result.dps, bestDps).toLowerCase()}">${tierFor(
          result.dps,
          bestDps
        )}</div>
            <img src="${this.itemImage(item)}" alt="" />
            <div class="pvm-gear-planner-page__alternative-name">
              <strong>${item.name}</strong>
              <span>${owned ? "Owned by selected member" : "Not found on selected member"}</span>
            </div>
            <dl>
              <div><dt>DPS</dt><dd>${formatNumber(result.dps, 2)}</dd></div>
              <div><dt>Change</dt><dd class="${dpsChange >= 0 ? "positive" : "negative"}">${
          dpsChange >= 0 ? "+" : ""
        }${formatNumber(dpsChange)}%</dd></div>
              <div><dt>Prayer</dt><dd>+${result.prayer}</dd></div>
              <div><dt>Defense</dt><dd>${result.defence}</dd></div>
              <div><dt>Risk</dt><dd>${formatRisk(result.risk)}</dd></div>
            </dl>
            <button class="men-button" data-equip-item="${item.id}" ${!owned || selected ? "disabled" : ""}>${
          selected ? "Equipped" : owned ? "Choose" : "Unavailable"
        }</button>
          </article>`;
      })
      .join("");
  }

  renderResults() {
    const result = calculatePreview(this.selectedItems, this.targetId);
    return `
      <div><span>DPS estimate</span><strong>${formatNumber(result.dps, 2)}</strong></div>
      <div><span>Accuracy</span><strong>${formatNumber(result.accuracy)}%</strong></div>
      <div><span>Time to kill</span><strong>${formatNumber(result.ttk)}s</strong></div>
      <div><span>Prayer</span><strong>+${result.prayer}</strong></div>
      <div><span>Defense</span><strong>${result.defence}</strong></div>
      <div><span>Weight</span><strong>${formatNumber(result.weight)} kg</strong></div>
      <div><span>Risk value</span><strong>${formatRisk(result.risk)}</strong></div>`;
  }
}

customElements.define("pvm-gear-planner-page", PvmGearPlannerPage);
