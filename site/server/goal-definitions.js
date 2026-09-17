const WIKI = "https://oldschool.runescape.wiki/w/";

const item = (itemId, quantity = 1, alternatives = []) => ({ type: "item", itemId, quantity, alternatives });
const itemSet = (items) => ({ type: "item-set", items });
const skill = (skillName, level) => ({ type: "skill", skillName, level });
const quest = (questId, name) => ({ type: "quest", questId, name });
const every = (...validators) => ({ type: "every", validators });
const any = (...validators) => ({ type: "any", validators });
const all = (...validators) => ({ type: "all", validators });
const custom = (name, options = {}) => ({ type: "custom", name, ...options });

const GUTHANS = [
  [4724, 4904, 4905, 4906, 4907, 4908],
  [4726, 4910, 4911, 4912, 4913, 4914],
  [4728, 4916, 4917, 4918, 4919, 4920],
  [4730, 4922, 4923, 4924, 4925, 4926],
];
const KARILS = [
  [4732, 4928, 4929, 4930, 4931, 4932],
  [4734, 4934, 4935, 4936, 4937, 4938],
  [4736, 23632, 4940, 4941, 4942, 4943, 4944],
  [4738, 4946, 4947, 4948, 4949, 4950],
];
const RAIMENTS = [[26850, 26858, 26864, 26870], [26852, 26860, 26866, 26872], [26854, 26862, 26868, 26874], [26856]];
const LANTERNS = [[26822, 26824, 26826, 26828, 26830, 26832, 26834, 26836, 26838, 26840, 26842, 26844, 26846, 26848]];

function setValidator(groups) {
  return itemSet(groups.map(([itemId, ...alternatives]) => item(itemId, 1, alternatives)));
}

const nodes = [
  {
    id: "fire-cape-stats",
    title: "Recommended Fire Cape stats",
    description: "61 Ranged, 70 Hitpoints, 43 Prayer, and 50 Defence.",
    scope: "character",
    category: "Fire Cape",
    recommended: true,
    validator: all(skill("Ranged", 61), skill("Hitpoints", 70), skill("Prayer", 43), skill("Defence", 50)),
    metadata: { wikiUrl: `${WIKI}TzHaar_Fight_Cave/Strategies` },
  },
  {
    id: "blood-rush-path",
    title: "Blood Rush sustain path",
    description: "Optional alternative sustain route through 56 Magic and Desert Treasure I.",
    scope: "character",
    category: "Fire Cape",
    optional: true,
    validator: every(skill("Magic", 56), quest(27, "Desert Treasure I")),
    metadata: { wikiUrl: `${WIKI}Blood_Rush` },
  },
  {
    id: "fire-cape",
    title: "Fire cape",
    description: "Complete the Fight Cave and own item 6570.",
    scope: "character",
    category: "Fire Cape",
    validator: item(6570),
    metadata: { wikiUrl: `${WIKI}Fire_cape` },
  },
  {
    id: "barrows-ready",
    title: "Barrows activity",
    description: "Barrows progression hub. Morytania Hard and Medium Combat Achievements are recommendations.",
    scope: "character",
    category: "Barrows",
    recommended: true,
    validator: custom("manual-observation", {
      message:
        "Barrows kill count is not present in get-group-data, so activity completion cannot be observed automatically.",
    }),
    metadata: { wikiUrl: `${WIKI}Barrows` },
  },
  {
    id: "morytania-hard",
    title: "Morytania Hard Diary",
    description: "Recommended for improved Barrows rune rewards.",
    scope: "character",
    category: "Barrows",
    recommended: true,
    validator: custom("manual-observation", {
      message:
        "Raw diary variables are not reliably decoded by the site service, so this recommendation is not guessed.",
    }),
    metadata: { wikiUrl: `${WIKI}Morytania_Diary` },
  },
  {
    id: "medium-combat-achievements",
    title: "Medium Combat Achievements",
    description: "Recommended before sustained Barrows runs.",
    scope: "character",
    category: "Barrows",
    recommended: true,
    validator: custom("manual-observation", {
      message: "Combat Achievement tier state is not present in get-group-data and cannot be observed automatically.",
    }),
    metadata: { wikiUrl: `${WIKI}Combat_Achievements/Medium` },
  },
  {
    id: "guthans-set",
    title: "Guthan's armour set",
    description: "The group owns all four Guthan pieces, including degraded variants.",
    scope: "group",
    category: "Barrows",
    validator: setValidator(GUTHANS),
    metadata: { wikiUrl: `${WIKI}Guthan_the_Infested%27s_equipment` },
  },
  {
    id: "karils-useful-pieces",
    title: "Karil's useful armour pieces",
    description: "The group owns Karil's leathertop and leatherskirt.",
    scope: "group",
    category: "Barrows",
    validator: itemSet([item(KARILS[2][0], 1, KARILS[2].slice(1)), item(KARILS[3][0], 1, KARILS[3].slice(1))]),
    metadata: { wikiUrl: `${WIKI}Karil_the_Tainted%27s_equipment` },
  },
  {
    id: "karils-set",
    title: "Karil's armour set",
    description: "The group owns all four Karil pieces, including degraded variants.",
    scope: "group",
    category: "Barrows",
    optional: true,
    validator: setValidator(KARILS),
    metadata: { wikiUrl: `${WIKI}Karil_the_Tainted%27s_equipment` },
  },
  {
    id: "blood-rune-source",
    title: "Blood rune source",
    description: "Reach 77 Runecraft for a renewable blood rune source.",
    scope: "character",
    category: "Guardians of the Rift",
    validator: skill("Runecraft", 77),
    metadata: { wikiUrl: `${WIKI}Blood_rune` },
  },
  {
    id: "guardians-of-the-rift",
    title: "Guardians of the Rift",
    description: "Participate in Guardians of the Rift.",
    scope: "character",
    category: "Guardians of the Rift",
    validator: custom("manual-observation", {
      message:
        "Guardians of the Rift participation is not present in get-group-data and cannot be observed automatically.",
    }),
    metadata: { wikiUrl: `${WIKI}Guardians_of_the_Rift` },
  },
  {
    id: "raiments-of-the-eye",
    title: "Raiments of the Eye",
    description: "Own the full four-piece outfit. Recolours count.",
    scope: "character",
    category: "Guardians of the Rift",
    validator: setValidator(RAIMENTS),
    metadata: { wikiUrl: `${WIKI}Raiments_of_the_Eye` },
  },
  {
    id: "abyssal-lantern",
    title: "Abyssal lantern",
    description: "Own an Abyssal lantern in any log state.",
    scope: "character",
    category: "Guardians of the Rift",
    validator: setValidator(LANTERNS),
    metadata: { wikiUrl: `${WIKI}Abyssal_lantern` },
  },
  {
    id: "lantern-firemaking",
    title: "75 Firemaking lantern support",
    description: "Reach 75 Firemaking to use stronger Abyssal lantern log effects.",
    scope: "character",
    category: "Guardians of the Rift",
    recommended: true,
    validator: skill("Firemaking", 75),
    metadata: { wikiUrl: `${WIKI}Abyssal_lantern` },
  },
];

const edges = [
  { source: "fire-cape-stats", target: "fire-cape" },
  { source: "blood-rush-path", target: "fire-cape", optional: true },
  { source: "barrows-ready", target: "guthans-set" },
  { source: "barrows-ready", target: "karils-useful-pieces" },
  { source: "karils-useful-pieces", target: "karils-set", optional: true },
  { source: "guardians-of-the-rift", target: "raiments-of-the-eye" },
  { source: "guardians-of-the-rift", target: "abyssal-lantern" },
  { source: "lantern-firemaking", target: "abyssal-lantern" },
  { source: "blood-rune-source", target: "blood-rush-path", optional: true },
];

module.exports = { all, any, custom, edges, every, item, itemSet, nodes, quest, skill };
