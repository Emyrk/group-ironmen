const WIKI = "https://oldschool.runescape.wiki/w/";

const item = (itemId, quantity = 1, alternatives = []) => ({ type: "item", itemId, quantity, alternatives });
const itemSet = (items) => ({ type: "item-set", items });
const skill = (skillName, level) => ({ type: "skill", skillName, level });
const quest = (questId, name) => ({ type: "quest", questId, name });
const diary = (region, tier) => ({ type: "diary", region, tier });
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

const PRAYER_POTION_DOSES = [
  [2434, 4],
  [139, 3],
  [141, 2],
  [143, 1],
  [20393, 4],
  [20394, 3],
  [20395, 2],
  [20396, 1],
];
const PRAYER_POTION_SUPPLY_DOSES = 40;

function prayerPotionSupply() {
  return custom("prayer-potion-supply", {
    evaluate(context) {
      const doses = PRAYER_POTION_DOSES.reduce(
        (total, [itemId, dosesPerPotion]) => total + (context.items.get(itemId) || 0) * dosesPerPotion,
        0
      );
      return {
        complete: doses >= PRAYER_POTION_SUPPLY_DOSES,
        progress: {
          current: Math.min(doses, PRAYER_POTION_SUPPLY_DOSES),
          target: PRAYER_POTION_SUPPLY_DOSES,
          unit: "dose",
        },
        evidence: [
          {
            type: "item",
            itemId: 2434,
            quantity: doses,
            targetQuantity: PRAYER_POTION_SUPPLY_DOSES,
            unit: "dose",
          },
        ],
      };
    },
  });
}

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
    title: "Barrows access",
    description: "Complete Priest in Peril to enter Morytania and access Barrows.",
    scope: "character",
    category: "Barrows",
    validator: quest(111, "Priest in Peril"),
    metadata: { wikiUrl: `${WIKI}Barrows/Strategies` },
  },
  {
    id: "morytania-easy",
    title: "Morytania Easy Diary",
    description: "Complete all 11 easy tasks for Morytania legs 1 and the first regional diary benefits.",
    scope: "character",
    category: "Morytania Diary",
    validator: diary("Morytania", "Easy"),
    metadata: { wikiUrl: `${WIKI}Morytania_Diary#Easy` },
  },
  {
    id: "morytania-medium",
    title: "Morytania Medium Diary",
    description: "Complete all 11 medium tasks for Morytania legs 2 and improved regional benefits.",
    scope: "character",
    category: "Morytania Diary",
    validator: diary("Morytania", "Medium"),
    metadata: { wikiUrl: `${WIKI}Morytania_Diary#Medium` },
  },
  {
    id: "morytania-hard",
    title: "Morytania Hard Diary",
    description: "Complete all 10 hard tasks for Morytania legs 3, the Bonecrusher, and 50% more Barrows runes.",
    scope: "character",
    category: "Morytania Diary",
    recommended: true,
    validator: diary("Morytania", "Hard"),
    metadata: { wikiUrl: `${WIKI}Morytania_Diary#Hard` },
  },
  {
    id: "morytania-elite",
    title: "Morytania Elite Diary",
    description: "Complete all 6 elite tasks for Morytania legs 4 and the highest regional diary benefits.",
    scope: "character",
    category: "Morytania Diary",
    optional: true,
    validator: diary("Morytania", "Elite"),
    metadata: { wikiUrl: `${WIKI}Morytania_Diary#Elite` },
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
    id: "miscellania-hardwood",
    title: "Miscellania teak logs",
    description:
      "Complete Throne of Miscellania to manage the kingdom, then Royal Trouble to assign workers to passive teak or mahogany logs.",
    scope: "character",
    category: "Construction",
    validator: every(quest(147, "Throne of Miscellania"), quest(123, "Royal Trouble")),
    metadata: { wikiUrl: `${WIKI}Managing_Miscellania` },
  },
  {
    id: "teak-seed",
    title: "Obtain a teak seed",
    description:
      "The group owns a teak seed for a renewable teak tree. Seed nests, seed packs, and Wintertodt are practical sources.",
    scope: "group",
    category: "Construction",
    validator: item(21486),
    metadata: { wikiUrl: `${WIKI}Teak_seed` },
  },
  {
    id: "fossil-island-teaks",
    title: "Plant teak on Fossil Island",
    description:
      "Complete Bone Voyage, reach 35 Farming, and plant a teak sapling in one of Fossil Island's hardwood patches for renewable teak logs.",
    scope: "character",
    category: "Construction",
    validator: every(
      quest(11, "Bone Voyage"),
      skill("Farming", 35),
      custom("manual-observation", {
        message:
          "Farming patch state is not present in get-group-data; planting the teak sapling cannot be observed automatically.",
      })
    ),
    metadata: { wikiUrl: `${WIKI}Teak_seed` },
  },
  {
    id: "easy-farming-contracts",
    title: "Easy farming contracts",
    type: "activity",
    description: "Reach 45 Farming to complete easy contracts for seed packs, including a repeatable source of herb seeds.",
    scope: "character",
    category: "Prayer Potions",
    validator: skill("Farming", 45),
    metadata: { wikiUrl: `${WIKI}Farming_contract` },
  },
  {
    id: "medium-farming-contracts",
    title: "Medium farming contracts",
    type: "activity",
    description: "Reach 65 Farming to complete medium contracts for improved seed packs.",
    scope: "character",
    category: "Prayer Potions",
    validator: skill("Farming", 65),
    metadata: { wikiUrl: `${WIKI}Farming_contract` },
  },
  {
    id: "ranarr-herb-farming",
    title: "Grow ranarr herbs",
    type: "activity",
    description: "Reach 32 Farming to grow ranarr weeds from ranarr seeds for prayer potions.",
    scope: "character",
    category: "Prayer Potions",
    validator: skill("Farming", 32),
    metadata: { wikiUrl: `${WIKI}Ranarr_seed` },
  },
  {
    id: "prayer-potion-herblore",
    title: "Make prayer potions",
    type: "skill",
    description: "Complete Druidic Ritual and reach 38 Herblore to combine ranarr potions (unf) with snape grass.",
    scope: "character",
    category: "Prayer Potions",
    validator: every(quest(34, "Druidic Ritual"), skill("Herblore", 38)),
    metadata: { wikiUrl: `${WIKI}Prayer_potion` },
  },
  {
    id: "prayer-potion-supply",
    title: "Prayer potion supply",
    type: "item",
    description: "The group owns at least 40 total doses of prayer potion across all storage.",
    scope: "group",
    category: "Prayer Potions",
    validator: prayerPotionSupply(),
    metadata: { wikiUrl: `${WIKI}Prayer_potion` },
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
    title: "Guardians of the Rift access",
    description: "Complete Temple of the Eye and reach 27 Runecraft to enter the minigame.",
    scope: "character",
    category: "Guardians of the Rift",
    validator: every(quest(167, "Temple of the Eye"), skill("Runecraft", 27)),
    metadata: { wikiUrl: `${WIKI}Guardians_of_the_Rift` },
  },
  {
    id: "house-tablet-construction",
    title: "67 Construction for house tablets",
    description:
      "Build a mahogany eagle lectern to make Teleport to House tablets. Making each tablet also requires 40 Magic and the tablet materials.",
    scope: "character",
    category: "Guardians of the Rift",
    recommended: true,
    validator: skill("Construction", 67),
    metadata: { wikiUrl: `${WIKI}Teleport_to_house_(tablet)` },
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
    title: "62 Firemaking for blisterwood",
    description: "Use blisterwood logs in the Abyssal lantern for 20% more blood runes in Guardians of the Rift.",
    scope: "character",
    category: "Guardians of the Rift",
    recommended: true,
    validator: skill("Firemaking", 62),
    metadata: { wikiUrl: `${WIKI}Abyssal_lantern` },
  },
];

const edges = [
  { source: "fire-cape-stats", target: "fire-cape", type: "recommended", label: "Recommended stats" },
  {
    source: "blood-rush-path",
    target: "fire-cape",
    type: "alternative",
    alternativeGroup: "fight-cave-sustain",
    label: "Sustain option",
  },
  {
    source: "guthans-set",
    target: "fire-cape",
    type: "alternative",
    alternativeGroup: "fight-cave-sustain",
    label: "Shared sustain option",
  },
  { source: "karils-useful-pieces", target: "fire-cape", type: "recommended", label: "Ranged defence" },
  { source: "barrows-ready", target: "guthans-set", type: "supplies", label: "Drops" },
  { source: "barrows-ready", target: "karils-useful-pieces", type: "supplies", label: "Drops" },
  { source: "karils-useful-pieces", target: "karils-set", type: "optional", label: "Complete the set" },
  { source: "morytania-easy", target: "morytania-medium", type: "unlocks", label: "Claim the next tier" },
  { source: "morytania-medium", target: "morytania-hard", type: "unlocks", label: "Claim the next tier" },
  { source: "morytania-hard", target: "morytania-elite", type: "unlocks", label: "Claim the next tier" },
  { source: "morytania-hard", target: "barrows-ready", type: "improves", label: "+50% runes" },
  {
    source: "medium-combat-achievements",
    target: "barrows-ready",
    type: "improves",
    label: "Stops prayer drain",
  },
  {
    source: "miscellania-hardwood",
    target: "house-tablet-construction",
    type: "supplies",
    label: "Passive teak logs",
  },
  {
    source: "teak-seed",
    target: "fossil-island-teaks",
    type: "requires",
    label: "Seed for the sapling",
  },
  {
    source: "fossil-island-teaks",
    target: "house-tablet-construction",
    type: "supplies",
    label: "Renewable teak logs",
  },
  {
    source: "house-tablet-construction",
    target: "guardians-of-the-rift",
    type: "improves",
    label: "Convenient teleport",
  },
  { source: "guardians-of-the-rift", target: "raiments-of-the-eye", type: "supplies", label: "Abyssal pearls" },
  { source: "guardians-of-the-rift", target: "abyssal-lantern", type: "supplies", label: "Reward/shop" },
  { source: "abyssal-lantern", target: "blood-rune-source", type: "improves", label: "More runes" },
  { source: "lantern-firemaking", target: "abyssal-lantern", type: "improves", label: "+20% blood runes" },
  { source: "raiments-of-the-eye", target: "blood-rune-source", type: "improves", label: "+60% runes" },
  {
    source: "easy-farming-contracts",
    target: "ranarr-herb-farming",
    type: "supplies",
    label: "Seed packs",
  },
  {
    source: "medium-farming-contracts",
    target: "ranarr-herb-farming",
    type: "improves",
    label: "Improved seed packs",
  },
  {
    source: "ranarr-herb-farming",
    target: "prayer-potion-supply",
    type: "supplies",
    label: "Ranarr weeds",
  },
  {
    source: "prayer-potion-herblore",
    target: "prayer-potion-supply",
    type: "supplies",
    label: "Craft prayer potions",
  },
  {
    source: "prayer-potion-supply",
    target: "fire-cape",
    type: "recommended",
    label: "Prayer restoration",
  },
  { source: "blood-rune-source", target: "blood-rush-path", type: "supplies", label: "Blood runes" },
];

module.exports = { all, any, custom, diary, edges, every, item, itemSet, nodes, quest, skill };
