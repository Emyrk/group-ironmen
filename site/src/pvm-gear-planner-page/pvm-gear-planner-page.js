import { BaseElement } from "../base-element/base-element";
import { CalculatorClient, createWorkerCalculatorTransport } from "../pvm/calculator-client";
import { equipmentIdsFromMember } from "../pvm/calculator-protocol";
import { loadPvmEntities } from "../pvm/entity-loader";

const PAPERDOLL_SLOTS = [
  { slot: "head", position: "head", label: "Head", emptyIcon: "156-0.png" },
  { slot: "cape", position: "cape", label: "Cape", emptyIcon: "157-0.png" },
  { slot: "neck", position: "neck", label: "Neck", emptyIcon: "158-0.png" },
  { slot: "ammo", position: "ammo", label: "Ammo", emptyIcon: "166-0.png" },
  { slot: "weapon", position: "weapon", label: "Weapon", emptyIcon: "159-0.png" },
  { slot: "body", position: "torso", label: "Body", emptyIcon: "161-0.png" },
  { slot: "shield", position: "shield", label: "Shield", emptyIcon: "162-0.png" },
  { slot: "legs", position: "legs", label: "Legs", emptyIcon: "163-0.png" },
  { slot: "hands", position: "gloves", label: "Hands", emptyIcon: "164-0.png" },
  { slot: "feet", position: "boots", label: "Feet", emptyIcon: "165-0.png" },
  { slot: "ring", position: "ring", label: "Ring", emptyIcon: "160-0.png" },
];
const SLOT_NAMES = Object.fromEntries(PAPERDOLL_SLOTS.map(({ slot, label }) => [slot, label]));
const SLOT_KEYS = PAPERDOLL_SLOTS.map(({ slot }) => slot);
const COMBAT_MODES = ["Best", "Melee", "Ranged", "Magic"];
const SELECTED_MEMBER_STORAGE_KEY = "pvmGearPlannerSelectedMember";
const MAX_CANDIDATES = 12;
const DEFAULT_TARGET = ["Giant Mole", ""];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function tierFor(dps, bestDps) {
  const loss = bestDps === 0 ? 0 : (bestDps - dps) / bestDps;
  if (loss <= 0.005) return "S";
  if (loss <= 0.02) return "A";
  if (loss <= 0.05) return "B";
  return "C";
}

function equipmentScore(item) {
  const offensive = Object.values(item.offensive || {}).reduce((sum, value) => sum + Math.max(0, value || 0), 0);
  const bonuses = item.bonuses || {};
  return offensive + (bonuses.str || 0) * 3 + (bonuses.ranged_str || 0) * 3 + (bonuses.magic_str || 0) * 3;
}

function weaponSupportsMode(item, mode) {
  if (mode === "Ranged") return (item?.offensive?.ranged || 0) > 0;
  if (mode === "Magic") return (item?.offensive?.magic || 0) > 0;
  return true;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function memberDataSignature(member) {
  if (!member) return "";
  const skills = Object.entries(member.skills || {})
    .map(([name, skill]) => `${name}:${skill?.level || 1}`)
    .sort();
  const equipment = (member.equipment || []).map((item) => item?.id || 0);
  const quantities = new Map();
  if (typeof member.allItems === "function") {
    for (const item of member.allItems()) quantities.set(item.id, item.quantity || 1);
  } else {
    for (const inventoryQuantities of Object.values(member.itemQuantities || {})) {
      if (!(inventoryQuantities instanceof Map)) continue;
      for (const [itemId, quantity] of inventoryQuantities) {
        quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
      }
    }
  }
  const owned = [...quantities].sort(([left], [right]) => left - right);
  return JSON.stringify({ skills, equipment, owned });
}

export class PvmGearPlannerPage extends BaseElement {
  connectedCallback() {
    super.connectedCallback();
    this.groupData = null;
    this.entities = null;
    this.selectedMember = localStorage.getItem(SELECTED_MEMBER_STORAGE_KEY) || "";
    this.selectedTargetKey = "";
    this.combatMode = "Best";
    this.selectedSpellbook = "standard";
    this.selectedSpell = "";
    this.compatibleAmmoIds = null;
    this.rangedWeaponRequiresAmmo = false;
    this.ammoRequestId = 0;
    this.activeSlot = "body";
    this.selectedItems = Object.fromEntries(SLOT_KEYS.map((slot) => [slot, null]));
    this.currentResult = null;
    this.candidateResults = new Map();
    this.loadingEntities = true;
    this.calculating = false;
    this.error = "";
    this.calculationGeneration = 0;
    this.memberSignature = "";
    this.loadoutInitialized = false;
    const transport = createWorkerCalculatorTransport();
    this.resultCalculator = new CalculatorClient(transport);
    this.candidateCalculator = new CalculatorClient(transport);
    this.ammoTransport = createWorkerCalculatorTransport();
    this.renderAndBind();
    this.subscribe("get-group-data", this.handleGroupData.bind(this));
    this.loadEntities();
  }

  html() {
    return `{{pvm-gear-planner-page.html}}`;
  }

  async loadEntities() {
    try {
      this.entities = await loadPvmEntities();
      this.loadingEntities = false;
      const [defaultName, defaultVersion] = DEFAULT_TARGET;
      const defaultTarget = this.entities.targets.find(
        (monster) => monster.name === defaultName && monster.version === defaultVersion
      );
      this.selectedTargetKey = defaultTarget?.key || this.entities.targets[0]?.key || "";
      this.initializeLoadout();
      this.renderAndBind();
      this.refreshCalculations();
    } catch (error) {
      this.loadingEntities = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.renderAndBind();
    }
  }

  handleGroupData(groupData) {
    this.groupData = groupData;
    const nextMember = this.members.some((member) => member.name === this.selectedMember)
      ? this.selectedMember
      : this.members[0]?.name || "";
    const memberChanged = nextMember !== this.selectedMember;
    this.selectedMember = nextMember;
    const nextSignature = `${memberDataSignature(this.selectedMemberData)}|${memberDataSignature(
      this.sharedStorageData
    )}`;
    const dataChanged = nextSignature !== this.memberSignature;
    if (!memberChanged && this.loadoutInitialized && !dataChanged) return;

    this.initializeLoadout({ preserveSelections: !memberChanged });
    this.renderAndBind();
    this.refreshCalculations();
  }

  get members() {
    return this.groupData ? [...this.groupData.members.values()].filter((member) => member.name !== "@SHARED") : [];
  }

  get selectedMemberData() {
    return this.groupData?.members.get(this.selectedMember);
  }

  get sharedStorageData() {
    return this.groupData?.members.get("@SHARED");
  }

  get selectedTarget() {
    return this.entities?.targetsByKey.get(this.selectedTargetKey) || null;
  }

  itemAvailability(item) {
    const personal = Boolean(item && this.selectedMemberData?.totalItemQuantity(item.id) > 0);
    const shared = Boolean(item && this.sharedStorageData?.totalItemQuantity(item.id) > 0);
    return { personal, shared, available: personal || shared };
  }

  isOwned(item) {
    return this.itemAvailability(item).available;
  }

  availabilityLabel(item) {
    const { personal, shared } = this.itemAvailability(item);
    if (personal && shared) return `${this.selectedMember} + shared storage`;
    if (shared) return "Shared storage";
    return `Owned by ${this.selectedMember}`;
  }

  ownedEquipment(slot) {
    if (!this.entities || !this.selectedMemberData) return [];
    return uniqueById(this.entities.equipmentBySlot.get(slot) || []).filter(
      (item) =>
        this.isOwned(item) &&
        (slot !== "weapon" || weaponSupportsMode(item, this.combatMode)) &&
        (slot !== "ammo" ||
          this.combatMode !== "Ranged" ||
          !this.compatibleAmmoIds ||
          this.compatibleAmmoIds.has(item.id))
    );
  }

  get availableSpells() {
    return (this.entities?.spells || []).filter((spell) => spell.spellbook === this.selectedSpellbook);
  }

  get calculationConfigurationError() {
    if ((this.combatMode === "Ranged" || this.combatMode === "Magic") && !this.selectedItems.weapon) {
      return `Choose an owned ${this.combatMode.toLowerCase()} weapon.`;
    }
    if (this.combatMode === "Ranged" && this.rangedWeaponRequiresAmmo && !this.selectedItems.ammo)
      return "Choose compatible ammunition.";
    if (this.combatMode === "Magic" && !this.selectedSpell) return "Choose an offensive spell from a spellbook.";
    return "";
  }

  async ensureCombatModeLoadout() {
    if (this.combatMode !== "Ranged" && this.combatMode !== "Magic") return;
    this.activeSlot = "weapon";
    if (!weaponSupportsMode(this.selectedItems.weapon, this.combatMode)) {
      this.selectedItems.weapon =
        this.ownedEquipment("weapon").sort((left, right) => equipmentScore(right) - equipmentScore(left))[0] || null;
    }
    if (this.combatMode === "Ranged") await this.syncRangedAmmo();
  }

  async syncRangedAmmo() {
    const weapon = this.selectedItems.weapon;
    this.compatibleAmmoIds = null;
    this.rangedWeaponRequiresAmmo = false;
    if (!weapon) return;

    const requestId = ++this.ammoRequestId;
    const response = await this.ammoTransport({
      version: 1,
      action: "compatible-ammo",
      requestId,
      player: { equipment: { weapon: weapon.id } },
    });
    if (requestId !== this.ammoRequestId) return;
    if (response.error) throw new Error(response.error.message || "Unable to find compatible ammunition");

    this.compatibleAmmoIds = new Set(response.result.ammoIds);
    this.rangedWeaponRequiresAmmo = response.result.requiresAmmo;
    if (!this.rangedWeaponRequiresAmmo) {
      this.selectedItems.ammo = null;
      return;
    }
    if (this.compatibleAmmoIds.has(this.selectedItems.ammo?.id)) return;
    this.selectedItems.ammo =
      this.ownedEquipment("ammo").sort((left, right) => equipmentScore(right) - equipmentScore(left))[0] || null;
  }

  initializeLoadout({ preserveSelections = false } = {}) {
    if (!this.entities || !this.selectedMemberData) return;
    const equippedIds = equipmentIdsFromMember(this.selectedMemberData);
    const nextItems = {};
    for (const slot of SLOT_KEYS) {
      const selected = this.selectedItems[slot];
      const equipped = this.entities.equipmentById.get(equippedIds[slot]);
      const owned = this.ownedEquipment(slot).sort((left, right) => equipmentScore(right) - equipmentScore(left));
      if (preserveSelections && selected?.slot === slot && this.isOwned(selected)) {
        nextItems[slot] = selected;
      } else {
        nextItems[slot] = equipped?.slot === slot ? equipped : owned[0] || null;
      }
    }
    this.selectedItems = nextItems;
    this.normalizeTwoHandedEquipment();
    this.memberSignature = `${memberDataSignature(this.selectedMemberData)}|${memberDataSignature(
      this.sharedStorageData
    )}`;
    this.loadoutInitialized = true;
    this.currentResult = null;
    this.candidateResults = new Map();
  }

  normalizeTwoHandedEquipment(changedSlot) {
    const weapon = this.selectedItems.weapon;
    if (changedSlot === "shield" && this.selectedItems.shield && weapon?.isTwoHanded) {
      this.selectedItems.weapon = null;
    } else if (weapon?.isTwoHanded) {
      this.selectedItems.shield = null;
    }
  }

  renderAndBind() {
    this.render();
    this.bindControls();
  }

  bindControls() {
    const member = this.querySelector("[data-control='member']");
    const target = this.querySelector("[data-control='target']");
    const mode = this.querySelector("[data-control='mode']");
    const spellbook = this.querySelector("[data-control='spellbook']");
    const spell = this.querySelector("[data-control='spell']");
    if (member) this.eventListener(member, "change", this.handleMemberChange.bind(this));
    if (target) this.eventListener(target, "change", this.handleTargetChange.bind(this));
    if (mode) this.eventListener(mode, "change", this.handleCombatModeChange.bind(this));
    if (spellbook) this.eventListener(spellbook, "change", this.handleSpellbookChange.bind(this));
    if (spell) this.eventListener(spell, "change", this.handleSpellChange.bind(this));
    for (const button of this.querySelectorAll("[data-slot]")) {
      this.eventListener(button, "click", this.handleSlotClick.bind(this));
    }
    for (const button of this.querySelectorAll("[data-equip-item]")) {
      this.eventListener(button, "click", this.handleEquipClick.bind(this));
    }
  }

  handleMemberChange(event) {
    this.selectedMember = event.target.value;
    localStorage.setItem(SELECTED_MEMBER_STORAGE_KEY, this.selectedMember);
    this.loadoutInitialized = false;
    this.initializeLoadout();
    this.renderAndBind();
    this.refreshCalculations();
  }

  handleTargetChange(event) {
    const target =
      this.entities?.targetsByLabel.get(event.target.value) || this.entities?.targetsByKey.get(event.target.value);
    if (!target) {
      event.target.value = this.selectedTarget?.label || "";
      return;
    }
    this.selectedTargetKey = target.key;
    this.currentResult = null;
    this.candidateResults = new Map();
    this.renderAndBind();
    this.refreshCalculations();
  }

  async handleCombatModeChange(event) {
    this.combatMode = event.target.value;
    this.currentResult = null;
    this.candidateResults = new Map();
    try {
      await this.ensureCombatModeLoadout();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.renderAndBind();
    this.refreshCalculations();
  }

  handleSpellbookChange(event) {
    this.selectedSpellbook = event.target.value;
    this.selectedSpell = "";
    this.currentResult = null;
    this.candidateResults = new Map();
    this.renderAndBind();
    this.refreshCalculations();
  }

  handleSpellChange(event) {
    this.selectedSpell = event.target.value;
    this.currentResult = null;
    this.candidateResults = new Map();
    this.renderAndBind();
    this.refreshCalculations();
  }

  handleSlotClick(event) {
    this.activeSlot = event.currentTarget.dataset.slot;
    this.candidateResults = new Map();
    this.renderAndBind();
    this.refreshCalculations();
  }

  async handleEquipClick(event) {
    const item = this.entities?.equipmentById.get(Number(event.currentTarget.dataset.equipItem));
    if (!item || item.slot !== this.activeSlot || !this.isOwned(item)) return;
    this.selectedItems[this.activeSlot] = item;
    this.normalizeTwoHandedEquipment(this.activeSlot);
    try {
      if (this.combatMode === "Ranged" && this.activeSlot === "weapon") await this.syncRangedAmmo();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.currentResult = null;
    this.candidateResults = new Map();
    this.renderAndBind();
    this.refreshCalculations();
  }

  itemImage(item) {
    return `/icons/items/${item.id}.webp`;
  }

  equipmentIds(overrides = {}) {
    const items = Object.fromEntries(
      SLOT_KEYS.map((slot) => [slot, Object.hasOwn(overrides, slot) ? overrides[slot] : this.selectedItems[slot]])
    );
    if (Object.hasOwn(overrides, "shield") && items.shield && items.weapon?.isTwoHanded) items.weapon = null;
    if (items.weapon?.isTwoHanded) items.shield = null;
    return Object.fromEntries(SLOT_KEYS.map((slot) => [slot, items[slot]?.id || null]));
  }

  calculatorInput(overrides = {}) {
    return {
      member: this.selectedMemberData,
      equipmentIds: this.equipmentIds(overrides),
      monster: this.selectedTarget,
      options: {
        mode: this.combatMode,
        ...(this.combatMode === "Magic" && this.selectedSpell ? { spell: this.selectedSpell } : {}),
      },
    };
  }

  activeCandidates() {
    const selected = this.selectedItems[this.activeSlot];
    const candidates = this.ownedEquipment(this.activeSlot).sort(
      (left, right) => equipmentScore(right) - equipmentScore(left)
    );
    const bounded = candidates.slice(0, MAX_CANDIDATES);
    if (selected && !bounded.some((item) => item.id === selected.id)) bounded.push(selected);
    return bounded;
  }

  async refreshCalculations() {
    const generation = ++this.calculationGeneration;
    if (!this.entities || !this.selectedMemberData || !this.selectedTarget) return;
    if (this.calculationConfigurationError) {
      this.calculating = false;
      this.currentResult = null;
      this.candidateResults = new Map();
      this.renderAndBind();
      return;
    }
    this.calculating = true;
    this.error = "";
    this.renderAndBind();

    try {
      const currentResult = await this.resultCalculator.calculate(this.calculatorInput());
      if (generation !== this.calculationGeneration || !currentResult) return;
      this.currentResult = currentResult;
      this.renderAndBind();

      const results = new Map();
      for (const item of this.activeCandidates()) {
        if (generation !== this.calculationGeneration) return;
        if (item.id === this.selectedItems[this.activeSlot]?.id) {
          results.set(item.id, currentResult);
          continue;
        }
        const result = await this.candidateCalculator.calculate(this.calculatorInput({ [this.activeSlot]: item }));
        if (generation !== this.calculationGeneration || !result) return;
        results.set(item.id, result);
      }
      this.candidateResults = results;
      this.calculating = false;
      this.renderAndBind();
    } catch (error) {
      if (generation !== this.calculationGeneration) return;
      this.calculating = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.renderAndBind();
    }
  }

  loadoutSummary(items = this.selectedItems) {
    const equipped = Object.values(items).filter(Boolean);
    return {
      prayer: equipped.reduce((sum, item) => sum + (item.bonuses?.prayer || 0), 0),
      defence: equipped.reduce(
        (sum, item) => sum + Object.values(item.defensive || {}).reduce((itemSum, value) => itemSum + (value || 0), 0),
        0
      ),
      weight: equipped.reduce((sum, item) => sum + (item.weight || 0), 0),
    };
  }

  slotName(slot) {
    return SLOT_NAMES[slot];
  }

  renderMemberOptions() {
    if (this.members.length === 0) return '<option value="">Waiting for group data</option>';
    return this.members
      .map((member) => {
        const name = escapeHtml(member.name);
        return `<option value="${name}" ${member.name === this.selectedMember ? "selected" : ""}>${name}</option>`;
      })
      .join("");
  }

  renderSelectedTargetLabel() {
    return escapeHtml(this.selectedTarget?.label || "");
  }

  renderTargetOptions() {
    if (!this.entities) return "";
    return this.entities.targets.map((target) => `<option value="${escapeHtml(target.label)}"></option>`).join("");
  }

  renderStyleOptions() {
    return COMBAT_MODES.map(
      (mode) =>
        `<option value="${mode}" ${mode === this.combatMode ? "selected" : ""}>${
          mode === "Best" ? "Best DPS" : mode
        }</option>`
    ).join("");
  }

  renderSpellControls() {
    if (this.combatMode !== "Magic") return "";
    return `
      <div class="pvm-gear-planner-page__spell-controls">
        <label>
          Spellbook
          <select data-control="spellbook">
            ${["standard", "ancient", "arceuus"]
              .map(
                (spellbook) =>
                  `<option value="${spellbook}" ${spellbook === this.selectedSpellbook ? "selected" : ""}>${
                    spellbook[0].toUpperCase() + spellbook.slice(1)
                  }</option>`
              )
              .join("")}
          </select>
        </label>
        <label>
          Offensive spell
          <select data-control="spell">
            <option value="">Choose a spell</option>
            ${this.availableSpells
              .map(
                (spell) =>
                  `<option value="${escapeHtml(spell.name)}" ${
                    spell.name === this.selectedSpell ? "selected" : ""
                  }>${escapeHtml(spell.name)}</option>`
              )
              .join("")}
          </select>
        </label>
      </div>`;
  }

  renderStatus() {
    if (this.loadingEntities) return '<div class="pvm-gear-planner-page__status">Loading authoritative PvM data…</div>';
    if (this.calculationConfigurationError)
      return `<div class="pvm-gear-planner-page__status">${escapeHtml(this.calculationConfigurationError)}</div>`;
    if (this.error)
      return `<div class="pvm-gear-planner-page__status error"><strong>Calculator error:</strong> ${escapeHtml(
        this.error
      )}</div>`;
    if (!this.selectedMemberData) return '<div class="pvm-gear-planner-page__status">Waiting for member data…</div>';
    if (this.calculating)
      return '<div class="pvm-gear-planner-page__status">Calculating real DPS in the browser…</div>';
    return "";
  }

  renderPaperdoll() {
    return PAPERDOLL_SLOTS.map(({ slot, position, label, emptyIcon }) => {
      const item = this.selectedItems[slot];
      return `
        <button
          class="pvm-gear-planner-page__paperdoll-slot position-${position} ${
        slot === this.activeSlot ? "active" : ""
      } ${item ? "" : "empty"}"
          data-slot="${slot}"
          title="${label}: ${escapeHtml(item?.name || "Empty")}"
          aria-label="Choose ${label.toLowerCase()} equipment. Currently ${escapeHtml(item?.name || "empty")}."
        >
          <img src="${item ? this.itemImage(item) : `/ui/${emptyIcon}`}" alt="" />
        </button>`;
    }).join("");
  }

  renderAlternatives() {
    const ranked = this.activeCandidates()
      .map((item) => ({ item, result: this.candidateResults.get(item.id) }))
      .sort((left, right) => (right.result?.dps || -1) - (left.result?.dps || -1));
    if (ranked.length === 0)
      return '<p class="pvm-gear-planner-page__empty">No owned equipment found for this slot.</p>';
    const bestDps = Math.max(0, ...ranked.map(({ result }) => result?.dps || 0));
    return ranked
      .map(({ item, result }) => {
        const selected = this.selectedItems[this.activeSlot]?.id === item.id;
        const dpsChange =
          result && this.currentResult?.dps
            ? ((result.dps - this.currentResult.dps) / this.currentResult.dps) * 100
            : null;
        const summary = this.loadoutSummary({ ...this.selectedItems, [this.activeSlot]: item });
        return `
          <article class="pvm-gear-planner-page__alternative ${selected ? "selected" : ""}">
            <div class="pvm-gear-planner-page__tier tier-${
              result ? tierFor(result.dps, bestDps).toLowerCase() : "pending"
            }">${result ? tierFor(result.dps, bestDps) : "…"}</div>
            <img src="${this.itemImage(item)}" alt="" />
            <div class="pvm-gear-planner-page__alternative-name">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(
                item.version ? `${item.version} · ${this.availabilityLabel(item)}` : this.availabilityLabel(item)
              )}</span>
            </div>
            <dl>
              <div><dt>DPS</dt><dd>${result ? formatNumber(result.dps, 2) : "…"}</dd></div>
              <div><dt>Change</dt><dd class="${dpsChange === null || dpsChange >= 0 ? "positive" : "negative"}">${
          dpsChange === null ? "…" : `${dpsChange >= 0 ? "+" : ""}${formatNumber(dpsChange)}%`
        }</dd></div>
              <div><dt>Prayer</dt><dd>+${summary.prayer}</dd></div>
              <div><dt>Defence</dt><dd>${summary.defence}</dd></div>
              <div><dt>Weight</dt><dd>${formatNumber(summary.weight)} kg</dd></div>
            </dl>
            <button class="men-button" data-equip-item="${item.id}" ${selected ? "disabled" : ""}>${
          selected ? "Equipped" : "Choose"
        }</button>
          </article>`;
      })
      .join("");
  }

  renderResults() {
    const result = this.currentResult;
    const summary = this.loadoutSummary();
    return `
      <div><span>DPS${result?.style ? ` (${escapeHtml(result.style.type)})` : ""}</span><strong>${
      result ? formatNumber(result.dps, 2) : "…"
    }</strong></div>
      <div><span>Accuracy</span><strong>${result ? `${formatNumber(result.accuracy * 100)}%` : "…"}</strong></div>
      <div><span>Max hit</span><strong>${result ? formatNumber(result.maxHit, 0) : "…"}</strong></div>
      <div><span>Attack speed</span><strong>${result ? `${result.attackSpeed} ticks` : "…"}</strong></div>
      <div><span>Expected TTK</span><strong>${result ? `${formatNumber(result.expectedTtk)}s` : "…"}</strong></div>
      <div><span>Prayer</span><strong>+${summary.prayer}</strong></div>
      <div><span>Defence</span><strong>${summary.defence}</strong></div>
      <div><span>Weight</span><strong>${formatNumber(summary.weight)} kg</strong></div>`;
  }
}

customElements.define("pvm-gear-planner-page", PvmGearPlannerPage);
