export const CALCULATOR_PROTOCOL_VERSION = 1;

export const EQUIPMENT_SLOT_POSITIONS = Object.freeze({
  head: 0,
  cape: 1,
  neck: 2,
  weapon: 3,
  body: 4,
  shield: 5,
  legs: 7,
  hands: 9,
  feet: 10,
  ring: 12,
  ammo: 13,
});

const SKILL_KEYS = Object.freeze({
  atk: "Attack",
  def: "Defence",
  hp: "Hitpoints",
  magic: "Magic",
  prayer: "Prayer",
  ranged: "Ranged",
  str: "Strength",
  mining: "Mining",
  herblore: "Herblore",
});

function skillLevel(member, skillName) {
  const level = member?.skills?.[skillName]?.level;
  return Number.isFinite(level) ? Math.max(1, Math.min(126, level)) : 1;
}

export function playerSkillsFromMember(member) {
  return Object.fromEntries(Object.entries(SKILL_KEYS).map(([key, skillName]) => [key, skillLevel(member, skillName)]));
}

export function equipmentIdsFromMember(member) {
  const equipment = member?.equipment || [];
  return Object.fromEntries(
    Object.entries(EQUIPMENT_SLOT_POSITIONS).map(([slot, position]) => {
      const item = equipment[position];
      return [slot, item?.isValid?.() ? item.id : null];
    })
  );
}

export function createCalculatorRequest({ requestId, member, equipmentIds, monster, options = {} }) {
  if (!Number.isSafeInteger(requestId) || requestId < 0)
    throw new TypeError("requestId must be a non-negative integer");
  if (!monster || !Number.isSafeInteger(monster.id)) throw new TypeError("monster.id must be an integer");

  return {
    version: CALCULATOR_PROTOCOL_VERSION,
    action: "calculate",
    requestId,
    player: {
      name: member?.name || "Player",
      skills: playerSkillsFromMember(member),
      equipment: equipmentIds || equipmentIdsFromMember(member),
    },
    monster: {
      id: monster.id,
      version: monster.version || "",
    },
    options,
  };
}

export function parseCalculatorResponse(response, requestId) {
  if (!response || response.version !== CALCULATOR_PROTOCOL_VERSION) {
    throw new Error("Unsupported calculator protocol version");
  }
  if (response.requestId !== requestId) throw new Error("Calculator response does not match the request");
  if (response.error) throw new Error(response.error.message || "Calculator failed");
  if (!response.result || !Number.isFinite(response.result.dps))
    throw new Error("Calculator returned an invalid result");
  return response.result;
}
