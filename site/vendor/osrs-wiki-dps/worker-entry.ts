import mergeWith from "lodash.mergewith";
import PlayerVsNPCCalc from "@/lib/PlayerVsNPCCalc";
import { availableEquipment, calculateEquipmentBonusesFromGear, getCanonicalItemId } from "@/lib/Equipment";
import { getMonsters, INITIAL_MONSTER_INPUTS } from "@/lib/Monsters";
import { EquipmentCategory } from "@/enums/EquipmentCategory";
import { Prayer, PrayerMap } from "@/enums/Prayer";
import { Player, PlayerEquipment, PlayerSkills } from "@/types/Player";
import { PlayerCombatStyle } from "@/types/PlayerCombatStyle";
import { spellByName } from "@/types/Spell";
import { getCombatStylesForCategory } from "@/utils";

const PROTOCOL_VERSION = 1;
const EQUIPMENT_SLOTS: (keyof PlayerEquipment)[] = [
  "head",
  "cape",
  "neck",
  "ammo",
  "weapon",
  "body",
  "shield",
  "legs",
  "hands",
  "feet",
  "ring",
];
const ZERO_SKILLS: PlayerSkills = {
  atk: 0,
  def: 0,
  hp: 0,
  magic: 0,
  prayer: 0,
  ranged: 0,
  str: 0,
  mining: 0,
  herblore: 0,
};

interface CalculatorRequest {
  version: number;
  action: string;
  requestId: number;
  player: {
    name?: string;
    skills: PlayerSkills;
    equipment?: Partial<Record<keyof PlayerEquipment, number | null>>;
  };
  monster: { id: number; version?: string };
  options?: Record<string, unknown>;
}

function merge<T>(base: T, updates: unknown): T {
  return mergeWith({}, base, updates, (baseValue, updateValue) =>
    Array.isArray(baseValue) && Array.isArray(updateValue) ? updateValue : undefined
  );
}

function equipmentFromIds(ids: CalculatorRequest["player"]["equipment"] = {}): PlayerEquipment {
  const result = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])) as PlayerEquipment;
  for (const slot of EQUIPMENT_SLOTS) {
    const id = ids[slot];
    if (id === null || id === undefined) continue;
    const item =
      availableEquipment.find((candidate) => candidate.id === id) ||
      availableEquipment.find((candidate) => candidate.id === getCanonicalItemId(id));
    if (!item) throw new Error(`Unknown equipment item ID ${id}`);
    result[slot] = item;
  }
  return result;
}

function resolveStyles(category: EquipmentCategory, options: Record<string, unknown>): PlayerCombatStyle[] {
  const styles = getCombatStylesForCategory(category);
  const mode = options.mode;
  if (typeof mode === "string") {
    const allowedTypes =
      mode === "Melee"
        ? new Set(["stab", "slash", "crush"])
        : mode === "Ranged"
        ? new Set(["ranged"])
        : mode === "Magic"
        ? new Set(["magic"])
        : mode === "Best"
        ? new Set(["stab", "slash", "crush", "ranged", "magic"])
        : null;
    if (allowedTypes) {
      const seen = new Set<string>();
      return styles.filter((style) => {
        if (
          !style.type ||
          !allowedTypes.has(style.type) ||
          style.stance === "Defensive" ||
          style.stance === "Longrange"
        )
          return false;
        if (style.stance === "Manual Cast") return false;
        if (style.type === "magic" && !options.spell && ["Autocast", "Defensive Autocast"].includes(style.stance || ""))
          return false;
        const key = `${style.type}:${style.stance}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }
  const requested = options.style;
  if (requested && typeof requested === "object") return [requested as PlayerCombatStyle];
  if (typeof requested === "string") {
    const normalized = requested.toLowerCase();
    const match = styles.find((style) =>
      [style.name, style.type, style.stance].some((value) => value?.toLowerCase() === normalized)
    );
    if (match) return [match];
  }
  return [styles.find((style) => style.stance === "Rapid") || styles[0]].filter(Boolean) as PlayerCombatStyle[];
}

function resolvePrayers(requested: unknown): Prayer[] {
  if (!Array.isArray(requested)) return [];
  return requested.map((value) => {
    if (typeof value === "number" && PrayerMap[value as Prayer]) return value as Prayer;
    if (typeof value === "string") {
      const enumValue = Prayer[value as keyof typeof Prayer];
      if (typeof enumValue === "number") return enumValue;
      const entry = Object.entries(PrayerMap).find(([, data]) => data.name.toLowerCase() === value.toLowerCase());
      if (entry) return Number(entry[0]) as Prayer;
    }
    throw new Error(`Unknown prayer ${String(value)}`);
  });
}

function createPlayer(
  request: CalculatorRequest,
  monster: ReturnType<typeof createMonster>,
  style: PlayerCombatStyle
): Player {
  const options = request.options || {};
  const equipment = equipmentFromIds(request.player.equipment);
  const spell = typeof options.spell === "string" ? spellByName(options.spell) : null;
  if (typeof options.spell === "string" && !spell) throw new Error(`Unknown spell ${options.spell}`);

  let player: Player = {
    name: request.player.name || "Player",
    style,
    skills: merge({ ...ZERO_SKILLS, hp: 1 }, request.player.skills),
    boosts: merge(ZERO_SKILLS, options.boosts),
    equipment,
    attackSpeed: 4,
    prayers: resolvePrayers(options.prayers),
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    offensive: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    buffs: merge(
      {
        potions: [],
        onSlayerTask: false,
        inWilderness: false,
        forinthrySurge: false,
        soulreaperStacks: 0,
        baAttackerLevel: 0,
        chinchompaDistance: 4,
        kandarinDiary: false,
        chargeSpell: false,
        markOfDarknessSpell: false,
        usingSunfireRunes: false,
      },
      options.buffs
    ),
    spell,
  };
  player = { ...player, ...calculateEquipmentBonusesFromGear(player, monster) };
  return player;
}

function createMonster(request: CalculatorRequest) {
  const requestedVersion = request.monster.version || "";
  const source = getMonsters().find(
    (monster) => monster.id === request.monster.id && (!requestedVersion || monster.version === requestedVersion)
  );
  if (!source) {
    const suffix = requestedVersion ? ` (${requestedVersion})` : "";
    throw new Error(`Unknown monster ID ${request.monster.id}${suffix}`);
  }
  const options = request.options || {};
  return {
    ...source,
    inputs: merge(
      {
        ...INITIAL_MONSTER_INPUTS,
        monsterCurrentHp: source.skills.hp,
      },
      options.monsterInputs
    ),
  };
}

export function calculate(request: CalculatorRequest) {
  if (request.version !== PROTOCOL_VERSION) throw new Error("Unsupported calculator protocol version");
  if (request.action !== "calculate") throw new Error(`Unsupported calculator action ${request.action}`);
  const monster = createMonster(request);
  const options = request.options || {};
  if (options.mode === "Magic") {
    const spell = typeof options.spell === "string" ? spellByName(options.spell) : null;
    if (!spell || spell.max_hit <= 0) throw new Error("Magic mode requires an offensive spell");
  }
  const equipment = equipmentFromIds(request.player.equipment);
  const category = equipment.weapon?.category || EquipmentCategory.NONE;
  const styles = resolveStyles(category, options);
  if (styles.length === 0)
    throw new Error(`No viable ${String(options.mode || "combat")} style for the equipped weapon`);
  const results = styles.map((style) => {
    const player = createPlayer(request, monster, style);
    const calc = new PlayerVsNPCCalc(player, monster, {
      disableMonsterScaling: Boolean(options.disableMonsterScaling),
      usingSpecialAttack: Boolean(options.usingSpecialAttack),
    });
    return {
      dps: calc.getDps(),
      accuracy: calc.getDisplayHitChance(),
      maxHit: calc.getDistribution().getMax(),
      attackSpeed: calc.getAttackSpeed(),
      expectedTtk: calc.getTtk(),
      style: { name: style.name, type: style.type, stance: style.stance },
    };
  });
  return results.reduce((best, result) => (result.dps > best.dps ? result : best));
}

export function handleCalculatorRequest(request: CalculatorRequest) {
  try {
    return { version: PROTOCOL_VERSION, requestId: request?.requestId, result: calculate(request) };
  } catch (error) {
    return {
      version: PROTOCOL_VERSION,
      requestId: request?.requestId,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

if (typeof globalThis.document === "undefined") {
  globalThis.onmessage = (event: MessageEvent<CalculatorRequest>) => {
    globalThis.postMessage(handleCalculatorRequest(event.data));
  };
}
