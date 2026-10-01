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
const COMBAT_STYLES = ["Melee", "Ranged", "Magic"];
const SELECTED_MEMBER_STORAGE_KEY = "pvmGearPlannerSelectedMember";
const MAX_CANDIDATES = 12;
const DEFAULT_TARGET = ["Giant Mole", ""];

// spells.json intentionally has no rune costs. Keep these snapshot-specific restrictions local and explicit.
// This only models the three expensive rune types exposed by the budget controls; all other rune costs are ignored.
const WRATH_RUNE_SPELLS = new Set(["Earth Surge", "Fire Surge", "Water Surge", "Wind Surge"]);
const DEATH_RUNE_SPELLS = new Set([
  "Blood Barrage",
  "Blood Blitz",
  "Blood Burst",
  "Blood Rush",
  "Earth Blast",
  "Fire Blast",
  "Iban Blast",
  "Ice Barrage",
  "Ice Blitz",
  "Ice Burst",
  "Ice Rush",
  "Shadow Barrage",
  "Shadow Blitz",
  "Shadow Burst",
  "Shadow Rush",
  "Skeletal Grasp",
  "Smoke Barrage",
  "Smoke Blitz",
  "Smoke Burst",
  "Smoke Rush",
  "Water Blast",
  "Wind Blast",
]);
const BLOOD_RUNE_SPELLS = new Set([
  "Blood Barrage",
  "Blood Blitz",
  "Blood Burst",
  "Blood Rush",
  "Claws of Guthix",
  "Earth Wave",
  "Fire Wave",
  "Flames of Zamorak",
  "Ice Barrage",
  "Ice Blitz",
  "Saradomin Strike",
  "Shadow Barrage",
  "Shadow Blitz",
  "Smoke Barrage",
  "Smoke Blitz",
  "Undead Grasp",
  "Water Wave",
  "Wind Wave",
]);
const UNAFFECTED_RUNE_SPELLS = new Set([
  "Crumble Undead",
  "Dark Demonbane",
  "Earth Bolt",
  "Earth Strike",
  "Entangle",
  "Fire Bolt",
  "Fire Strike",
  "Ghostly Grasp",
  "Inferior Demonbane",
  "Snare",
  "Superior Demonbane",
  "Water Bolt",
  "Water Strike",
  "Wind Bolt",
  "Wind Strike",
]);

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

const MAGIC_WEAPON_CATEGORIES = new Set(["Bladed Staff", "Powered Staff", "Powered Wand", "Staff"]);
const RANGED_WEAPON_CATEGORIES = new Set(["Bow", "Chinchompas", "Crossbow", "Salamander", "Thrown"]);

export function weaponSupportsStyle(item, style) {
  if (style === "Ranged") return RANGED_WEAPON_CATEGORIES.has(item?.category);
  if (style === "Magic") return MAGIC_WEAPON_CATEGORIES.has(item?.category);
  return ["stab", "slash", "crush"].some((type) => (item?.offensive?.[type] || 0) > 0);
}

export function spellRuneTags(spellName) {
  if (UNAFFECTED_RUNE_SPELLS.has(spellName)) return new Set();
  const tags = new Set();
  if (WRATH_RUNE_SPELLS.has(spellName)) tags.add("wrath");
  if (DEATH_RUNE_SPELLS.has(spellName)) tags.add("death");
  if (BLOOD_RUNE_SPELLS.has(spellName)) tags.add("blood");
  if (tags.size === 0) throw new Error(`Missing budget rune classification for ${spellName}`);
  return tags;
}

function emptyItems() {
  return Object.fromEntries(SLOT_KEYS.map((slot) => [slot, null]));
}

function createLoadout(style) {
  return {
    style,
    items: emptyItems(),
    currentResult: null,
    candidateResults: new Map(),
    selectedSpell: "",
    compatibleAmmoIds: null,
    rangedWeaponRequiresAmmo: false,
    lockedSlots: new Set(),
  };
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
    this.activeStyle = "Melee";
    this.loadouts = Object.fromEntries(COMBAT_STYLES.map((style) => [style, createLoadout(style)]));
    this.runeRestrictions = { wrath: false, death: false, blood: false };
    this.ammoRequestId = 0;
    this.activeSlot = "body";
    this.loadingEntities = true;
    this.calculating = false;
    this.error = "";
    this.calculationGeneration = 0;
    this.memberSignature = "";
    this.loadoutInitialized = false;
    const transport = createWorkerCalculatorTransport();
    this.resultCalculator = new CalculatorClient(transport);
    this.candidateCalculator = new CalculatorClient(transport);
    this.optimizerCalculator = new CalculatorClient(createWorkerCalculatorTransport());
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

  get activeLoadout() {
    return this.loadouts[this.activeStyle];
  }

  ownedEquipment(slot, style = this.activeStyle, loadout = this.loadouts[style]) {
    if (!this.entities || !this.selectedMemberData) return [];
    return uniqueById(this.entities.equipmentBySlot.get(slot) || []).filter(
      (item) =>
        this.isOwned(item) &&
        (slot !== "weapon" || weaponSupportsStyle(item, style)) &&
        (slot !== "ammo" || style !== "Ranged" || !loadout.compatibleAmmoIds || loadout.compatibleAmmoIds.has(item.id))
    );
  }

  get eligibleMagicSpells() {
    return (this.entities?.spells || []).filter((spell) => {
      const tags = spellRuneTags(spell.name);
      return ![...tags].some((tag) => this.runeRestrictions[tag]);
    });
  }

  calculationConfigurationError(style = this.activeStyle) {
    const loadout = this.loadouts[style];
    if (!loadout?.items.weapon) return `No owned ${style.toLowerCase()} weapon is available.`;
    if (style === "Ranged" && loadout.rangedWeaponRequiresAmmo && !loadout.items.ammo)
      return "No owned compatible ammunition is available.";
    if (style === "Magic" && this.eligibleMagicSpells.length === 0)
      return "No offensive spells remain with the selected rune restrictions.";
    return "";
  }

  async compatibleAmmoForWeapon(weapon) {
    if (!weapon) return { ammoIds: new Set(), requiresAmmo: false };
    const requestId = ++this.ammoRequestId;
    const response = await this.ammoTransport({
      version: 1,
      action: "compatible-ammo",
      requestId,
      player: { equipment: { weapon: weapon.id } },
    });
    if (response.error) throw new Error(response.error.message || "Unable to find compatible ammunition");
    return { ammoIds: new Set(response.result.ammoIds), requiresAmmo: response.result.requiresAmmo };
  }

  async syncRangedAmmo() {
    const loadout = this.loadouts.Ranged;
    const { ammoIds, requiresAmmo } = await this.compatibleAmmoForWeapon(loadout.items.weapon);
    loadout.compatibleAmmoIds = ammoIds;
    loadout.rangedWeaponRequiresAmmo = requiresAmmo;
    if (!requiresAmmo) {
      if (!loadout.lockedSlots.has("ammo")) loadout.items.ammo = null;
      return;
    }
    if (ammoIds.has(loadout.items.ammo?.id)) return;
    if (loadout.lockedSlots.has("ammo")) return;
    loadout.items.ammo =
      this.ownedEquipment("ammo", "Ranged", loadout).sort(
        (left, right) => equipmentScore(right) - equipmentScore(left)
      )[0] || null;
  }

  initializeStyleLoadout(style, { preserveSelections = false } = {}) {
    const loadout = this.loadouts[style];
    const equippedIds = equipmentIdsFromMember(this.selectedMemberData);
    const nextItems = {};
    for (const slot of SLOT_KEYS) {
      const selected = loadout.items[slot];
      const equipped = this.entities.equipmentById.get(equippedIds[slot]);
      const equippedIsSuitable = equipped?.slot === slot && (slot !== "weapon" || weaponSupportsStyle(equipped, style));
      const owned = this.ownedEquipment(slot, style, loadout).sort(
        (left, right) => equipmentScore(right) - equipmentScore(left)
      );
      if (
        preserveSelections &&
        selected?.slot === slot &&
        this.isOwned(selected) &&
        (slot !== "weapon" || weaponSupportsStyle(selected, style))
      ) {
        nextItems[slot] = selected;
      } else {
        nextItems[slot] = equippedIsSuitable ? equipped : owned[0] || null;
      }
    }
    loadout.items = nextItems;
    loadout.currentResult = null;
    loadout.candidateResults = new Map();
    loadout.selectedSpell = "";
    loadout.compatibleAmmoIds = null;
    loadout.rangedWeaponRequiresAmmo = false;
    this.normalizeTwoHandedEquipment(loadout);
  }

  initializeLoadout({ preserveSelections = false } = {}) {
    if (!this.entities || !this.selectedMemberData) return;
    for (const style of COMBAT_STYLES) this.initializeStyleLoadout(style, { preserveSelections });
    this.memberSignature = `${memberDataSignature(this.selectedMemberData)}|${memberDataSignature(
      this.sharedStorageData
    )}`;
    this.loadoutInitialized = true;
  }

  normalizeTwoHandedEquipment(loadout = this.activeLoadout, changedSlot) {
    const weapon = loadout.items.weapon;
    if (changedSlot === "shield" && loadout.items.shield && weapon?.isTwoHanded) {
      loadout.items.weapon = null;
    } else if (weapon?.isTwoHanded) {
      loadout.items.shield = null;
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
    for (const button of this.querySelectorAll("[data-style]")) {
      this.eventListener(button, "click", this.handleStyleClick.bind(this));
    }
    for (const button of this.querySelectorAll("[data-rune-restriction]")) {
      this.eventListener(button, "click", this.handleRuneRestrictionClick.bind(this));
    }
    for (const button of this.querySelectorAll("[data-reset-style]")) {
      this.eventListener(button, "click", this.handleResetStyleClick.bind(this));
    }
    const resetAll = this.querySelector("[data-reset-all]");
    if (resetAll) this.eventListener(resetAll, "click", this.handleResetAllClick.bind(this));
    for (const control of this.querySelectorAll("[data-lock-slot]")) {
      this.eventListener(control, "click", this.handleLockSlotClick.bind(this));
      this.eventListener(control, "keydown", this.handleLockSlotKeydown.bind(this));
    }
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
    for (const loadout of Object.values(this.loadouts)) {
      loadout.currentResult = null;
      loadout.candidateResults = new Map();
      if (loadout.style === "Magic") loadout.selectedSpell = "";
    }
    this.renderAndBind();
    this.refreshCalculations();
  }

  handleStyleClick(event) {
    const style = event.currentTarget.dataset.style;
    if (!COMBAT_STYLES.includes(style) || style === this.activeStyle) return;
    this.activeStyle = style;
    this.renderAndBind();
    this.refreshActiveCandidates();
  }

  handleResetStyleClick(event) {
    const style = event.currentTarget.dataset.resetStyle;
    if (!COMBAT_STYLES.includes(style)) return;
    this.optimizeLoadouts([style]);
  }

  handleResetAllClick() {
    this.optimizeLoadouts(COMBAT_STYLES);
  }

  handleRuneRestrictionClick(event) {
    const rune = event.currentTarget.dataset.runeRestriction;
    if (!Object.hasOwn(this.runeRestrictions, rune)) return;
    this.runeRestrictions[rune] = !this.runeRestrictions[rune];
    const magic = this.loadouts.Magic;
    magic.currentResult = null;
    magic.candidateResults = new Map();
    magic.selectedSpell = "";
    this.renderAndBind();
    this.refreshCalculations({ styles: ["Magic"] });
  }

  handleLockSlotClick(event) {
    event.stopPropagation();
    const slot = event.currentTarget.dataset.lockSlot;
    if (!SLOT_KEYS.includes(slot)) return;
    if (this.activeLoadout.lockedSlots.has(slot)) this.activeLoadout.lockedSlots.delete(slot);
    else this.activeLoadout.lockedSlots.add(slot);
    this.renderAndBind();
  }

  handleLockSlotKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.handleLockSlotClick(event);
  }

  handleSlotClick(event) {
    this.activeSlot = event.currentTarget.dataset.slot;
    this.activeLoadout.candidateResults = new Map();
    this.renderAndBind();
    this.refreshActiveCandidates();
  }

  async handleEquipClick(event) {
    const item = this.entities?.equipmentById.get(Number(event.currentTarget.dataset.equipItem));
    if (!item || item.slot !== this.activeSlot || !this.isOwned(item)) return;
    const loadout = this.activeLoadout;
    loadout.items[this.activeSlot] = item;
    this.normalizeTwoHandedEquipment(loadout, this.activeSlot);
    try {
      if (this.activeStyle === "Ranged" && this.activeSlot === "weapon") await this.syncRangedAmmo();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    loadout.currentResult = null;
    loadout.candidateResults = new Map();
    if (this.activeStyle === "Magic") loadout.selectedSpell = "";
    this.renderAndBind();
    this.refreshCalculations({ styles: [this.activeStyle] });
  }

  itemImage(item) {
    return `/icons/items/${item.id}.webp`;
  }

  equipmentIds(style, overrides = {}) {
    const loadout = this.loadouts[style];
    const items = Object.fromEntries(
      SLOT_KEYS.map((slot) => [slot, Object.hasOwn(overrides, slot) ? overrides[slot] : loadout.items[slot]])
    );
    if (Object.hasOwn(overrides, "shield") && items.shield && items.weapon?.isTwoHanded) items.weapon = null;
    if (items.weapon?.isTwoHanded) items.shield = null;
    return Object.fromEntries(SLOT_KEYS.map((slot) => [slot, items[slot]?.id || null]));
  }

  calculatorInput(style, overrides = {}, spell = "") {
    return {
      member: this.selectedMemberData,
      equipmentIds: this.equipmentIds(style, overrides),
      monster: this.selectedTarget,
      options: {
        mode: style,
        ...(style === "Magic" && spell ? { spell } : {}),
      },
    };
  }

  activeCandidates() {
    const loadout = this.activeLoadout;
    const selected = loadout.items[this.activeSlot];
    const candidates = this.ownedEquipment(this.activeSlot, this.activeStyle, loadout).sort(
      (left, right) => equipmentScore(right) - equipmentScore(left)
    );
    const bounded = candidates.slice(0, MAX_CANDIDATES);
    if (selected && !bounded.some((item) => item.id === selected.id)) bounded.push(selected);
    return bounded;
  }

  async calculateStyleResult(style, overrides, calculator, fixedSpell = "") {
    if (style !== "Magic" || fixedSpell) {
      const result = await calculator.calculate(this.calculatorInput(style, overrides, fixedSpell));
      return result ? { result, spell: fixedSpell } : null;
    }

    let best = null;
    let lastError = null;
    for (const spell of this.eligibleMagicSpells) {
      try {
        const result = await calculator.calculate(this.calculatorInput(style, overrides, spell.name));
        if (result && (!best || result.dps > best.result.dps)) best = { result, spell: spell.name };
      } catch (error) {
        lastError = error;
      }
    }
    if (!best && lastError) throw lastError;
    return best;
  }

  optimizationCandidates(slot, style) {
    const selectedId = this.loadouts[style].items[slot]?.id;
    return this.ownedEquipment(slot, style, this.loadouts[style])
      .filter((item) => item.id !== selectedId)
      .sort((left, right) => equipmentScore(right) - equipmentScore(left))
      .slice(0, MAX_CANDIDATES);
  }

  candidateRespectsLocks(style, slot, item) {
    const loadout = this.loadouts[style];
    if (slot === "weapon" && item?.isTwoHanded && loadout.lockedSlots.has("shield") && loadout.items.shield)
      return false;
    if (slot === "shield" && item && loadout.items.weapon?.isTwoHanded && loadout.lockedSlots.has("weapon"))
      return false;
    return true;
  }

  applyOptimizedItem(style, slot, item) {
    const loadout = this.loadouts[style];
    loadout.items[slot] = item;
    if (slot === "weapon" && item?.isTwoHanded && !loadout.lockedSlots.has("shield")) loadout.items.shield = null;
    if (slot === "shield" && item && loadout.items.weapon?.isTwoHanded && !loadout.lockedSlots.has("weapon")) {
      loadout.items.weapon = null;
    }
  }

  async rangedWeaponVariants(weapon) {
    const loadout = this.loadouts.Ranged;
    const { ammoIds, requiresAmmo } = await this.compatibleAmmoForWeapon(weapon);
    if (loadout.lockedSlots.has("ammo")) {
      const ammo = loadout.items.ammo;
      if (requiresAmmo && !ammoIds.has(ammo?.id)) return [];
      return [{ weapon, ammo, ammoIds, requiresAmmo }];
    }
    if (!requiresAmmo) return [{ weapon, ammo: null, ammoIds, requiresAmmo }];
    const ammo = uniqueById(this.entities.equipmentBySlot.get("ammo") || [])
      .filter((item) => this.isOwned(item) && ammoIds.has(item.id))
      .sort((left, right) => equipmentScore(right) - equipmentScore(left))
      .slice(0, MAX_CANDIDATES);
    return ammo.map((item) => ({ weapon, ammo: item, ammoIds, requiresAmmo }));
  }

  async optimizeStyleLoadout(style, generation) {
    const loadout = this.loadouts[style];
    if (style === "Ranged") await this.syncRangedAmmo();
    let calculated = await this.calculateStyleResult(style, {}, this.optimizerCalculator);
    if (generation !== this.calculationGeneration || !calculated) return false;
    loadout.currentResult = calculated.result;
    loadout.selectedSpell = calculated.spell;
    const fixedSpell = style === "Magic" ? calculated.spell : "";
    const slotOrder = ["weapon", "ammo", ...SLOT_KEYS.filter((slot) => slot !== "weapon" && slot !== "ammo")];

    for (let pass = 0; pass < 2; pass += 1) {
      let improved = false;
      for (const slot of slotOrder) {
        if (generation !== this.calculationGeneration) return false;
        if (loadout.lockedSlots.has(slot) || (style !== "Ranged" && slot === "ammo" && !loadout.items.ammo)) continue;
        let best = { result: loadout.currentResult, item: loadout.items[slot], extra: null };

        if (style === "Ranged" && slot === "weapon") {
          for (const weapon of this.optimizationCandidates(slot, style)) {
            if (!weapon || !this.candidateRespectsLocks(style, slot, weapon)) continue;
            for (const variant of await this.rangedWeaponVariants(weapon)) {
              const candidate = await this.calculateStyleResult(
                style,
                { weapon: variant.weapon, ammo: variant.ammo },
                this.optimizerCalculator
              );
              if (generation !== this.calculationGeneration) return false;
              if (candidate && candidate.result.dps > best.result.dps) {
                best = { result: candidate.result, item: weapon, extra: variant };
              }
            }
          }
        } else {
          for (const item of this.optimizationCandidates(slot, style)) {
            if (!this.candidateRespectsLocks(style, slot, item)) continue;
            try {
              const candidate = await this.calculateStyleResult(
                style,
                { [slot]: item },
                this.optimizerCalculator,
                style === "Magic" && slot === "weapon" ? "" : fixedSpell
              );
              if (generation !== this.calculationGeneration) return false;
              if (candidate && candidate.result.dps > best.result.dps)
                best = { result: candidate.result, item, extra: null };
            } catch {
              // Some gear combinations are invalid (for example incompatible ammunition); skip them.
            }
          }
        }

        if (best.result.dps > loadout.currentResult.dps) {
          this.applyOptimizedItem(style, slot, best.item);
          if (best.extra) {
            loadout.items.ammo = best.extra.ammo;
            loadout.compatibleAmmoIds = best.extra.ammoIds;
            loadout.rangedWeaponRequiresAmmo = best.extra.requiresAmmo;
          }
          loadout.currentResult = best.result;
          improved = true;
        }
      }
      if (!improved) break;
    }

    calculated = await this.calculateStyleResult(style, {}, this.optimizerCalculator);
    if (generation !== this.calculationGeneration || !calculated) return false;
    loadout.currentResult = calculated.result;
    loadout.selectedSpell = calculated.spell;
    loadout.candidateResults = new Map();
    return true;
  }

  async optimizeLoadouts(styles) {
    if (!this.entities || !this.selectedMemberData || !this.selectedTarget) return;
    const generation = ++this.calculationGeneration;
    this.calculating = true;
    this.error = "";
    this.renderAndBind();
    try {
      for (const style of styles) {
        if (!(await this.optimizeStyleLoadout(style, generation))) return;
        this.renderAndBind();
      }
      this.calculating = false;
      this.renderAndBind();
    } catch (error) {
      if (generation !== this.calculationGeneration) return;
      this.calculating = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.renderAndBind();
    }
  }

  async calculateActiveCandidates(generation) {
    const style = this.activeStyle;
    const loadout = this.activeLoadout;
    const results = new Map();
    for (const item of this.activeCandidates()) {
      if (generation !== this.calculationGeneration) return false;
      if (item.id === loadout.items[this.activeSlot]?.id && loadout.currentResult) {
        results.set(item.id, loadout.currentResult);
        continue;
      }
      const calculated = await this.calculateStyleResult(style, { [this.activeSlot]: item }, this.candidateCalculator);
      if (generation !== this.calculationGeneration) return false;
      if (calculated) results.set(item.id, calculated.result);
    }
    loadout.candidateResults = results;
    return true;
  }

  async refreshActiveCandidates() {
    if (!this.entities || !this.selectedMemberData || !this.selectedTarget) return;
    if (!this.activeLoadout.currentResult) {
      this.refreshCalculations({ styles: [this.activeStyle] });
      return;
    }
    const generation = ++this.calculationGeneration;
    this.calculating = true;
    this.error = "";
    this.renderAndBind();
    try {
      if (!(await this.calculateActiveCandidates(generation))) return;
      this.calculating = false;
      this.renderAndBind();
    } catch (error) {
      if (generation !== this.calculationGeneration) return;
      this.calculating = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.renderAndBind();
    }
  }

  async refreshCalculations({ styles = COMBAT_STYLES } = {}) {
    const generation = ++this.calculationGeneration;
    if (!this.entities || !this.selectedMemberData || !this.selectedTarget) return;
    this.calculating = true;
    this.error = "";
    this.renderAndBind();

    try {
      if (styles.includes("Ranged")) await this.syncRangedAmmo();
      for (const style of styles) {
        if (generation !== this.calculationGeneration) return;
        const loadout = this.loadouts[style];
        const configurationError = this.calculationConfigurationError(style);
        if (configurationError) {
          loadout.currentResult = null;
          loadout.candidateResults = new Map();
          if (style === "Magic") loadout.selectedSpell = "";
          continue;
        }
        const calculated = await this.calculateStyleResult(style, {}, this.resultCalculator);
        if (generation !== this.calculationGeneration || !calculated) return;
        loadout.currentResult = calculated.result;
        loadout.selectedSpell = calculated.spell;
        this.renderAndBind();
      }

      if (styles.includes(this.activeStyle) && !(await this.calculateActiveCandidates(generation))) return;
      this.calculating = false;
      this.renderAndBind();
    } catch (error) {
      if (generation !== this.calculationGeneration) return;
      this.calculating = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.renderAndBind();
    }
  }

  loadoutSummary(items = this.activeLoadout.items) {
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

  renderStyleCards() {
    return COMBAT_STYLES.map((style) => {
      const loadout = this.loadouts[style];
      const result = loadout.currentResult;
      const weapon = loadout.items.weapon;
      return `
        <article class="pvm-gear-planner-page__style-card ${style === this.activeStyle ? "active" : ""}">
          <button class="pvm-gear-planner-page__style-select" data-style="${style}"
            aria-pressed="${style === this.activeStyle}">
            <span>${style}</span>
            <strong>${result ? formatNumber(result.dps, 2) : "…"} DPS</strong>
            <small>${escapeHtml(weapon?.name || "No owned weapon")}</small>
            ${style === "Magic" ? `<small>Spell: ${escapeHtml(loadout.selectedSpell || "Calculating…")}</small>` : ""}
          </button>
          <button class="pvm-gear-planner-page__reset-icon" data-reset-style="${style}"
            title="Optimize unlocked ${style} gear for DPS" aria-label="Optimize ${style} loadout">↻</button>
        </article>`;
    }).join("");
  }

  renderRuneRestrictions() {
    return ["wrath", "death", "blood"]
      .map(
        (rune) => `
          <button class="men-button ${this.runeRestrictions[rune] ? "active" : ""}"
            data-rune-restriction="${rune}" aria-pressed="${this.runeRestrictions[rune]}">
            No ${rune[0].toUpperCase() + rune.slice(1)} runes
          </button>`
      )
      .join("");
  }

  renderStatus() {
    if (this.loadingEntities) return '<div class="pvm-gear-planner-page__status">Loading authoritative PvM data…</div>';
    const configurationError = this.calculationConfigurationError();
    if (configurationError) return `<div class="pvm-gear-planner-page__status">${escapeHtml(configurationError)}</div>`;
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
      const item = this.activeLoadout.items[slot];
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
          <span class="pvm-gear-planner-page__slot-lock ${
            this.activeLoadout.lockedSlots.has(slot) ? "locked" : ""
          }" data-lock-slot="${slot}" role="button" tabindex="0"
            aria-pressed="${this.activeLoadout.lockedSlots.has(slot)}"
            title="${this.activeLoadout.lockedSlots.has(slot) ? "Unlock" : "Lock"} ${label.toLowerCase()} slot">${
        this.activeLoadout.lockedSlots.has(slot) ? "🔒" : "🔓"
      }</span>
        </button>`;
    }).join("");
  }

  renderAlternatives() {
    const loadout = this.activeLoadout;
    const ranked = this.activeCandidates()
      .map((item) => ({ item, result: loadout.candidateResults.get(item.id) }))
      .sort((left, right) => (right.result?.dps || -1) - (left.result?.dps || -1));
    if (ranked.length === 0)
      return '<p class="pvm-gear-planner-page__empty">No owned equipment found for this slot.</p>';
    const bestDps = Math.max(0, ...ranked.map(({ result }) => result?.dps || 0));
    return ranked
      .map(({ item, result }) => {
        const selected = loadout.items[this.activeSlot]?.id === item.id;
        const dpsChange =
          result && loadout.currentResult?.dps
            ? ((result.dps - loadout.currentResult.dps) / loadout.currentResult.dps) * 100
            : null;
        const summary = this.loadoutSummary({ ...loadout.items, [this.activeSlot]: item });
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
    const result = this.activeLoadout.currentResult;
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
