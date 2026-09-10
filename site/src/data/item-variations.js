import canonicalData from "./item-canonical.json";
import variationData from "./item-variations.json";

const canonicalIds = new Map(
  Object.entries(canonicalData.canonical).map(([itemId, canonicalId]) => [Number(itemId), canonicalId])
);
const variationSets = new Map();
const variationBases = new Map();
for (const [baseIdValue, members] of Object.entries(variationData.variations)) {
  const baseId = Number(baseIdValue);
  const memberSet = new Set(members);
  variationSets.set(baseId, memberSet);
  for (const member of members) variationBases.set(member, baseId);
}

export const itemMappingVersion = variationData.runeliteVersion;

export function canonicalItemId(itemId) {
  let current = itemId;
  const visited = new Set();
  while (canonicalIds.has(current) && !visited.has(current)) {
    visited.add(current);
    current = canonicalIds.get(current);
  }
  return current;
}

export function itemVariations(itemId) {
  const canonicalId = canonicalItemId(Math.abs(itemId));
  const baseId = itemId < 0 ? Math.abs(itemId) : variationBases.get(canonicalId) || variationBases.get(itemId);
  return [...(variationSets.get(baseId) || new Set([canonicalId]))];
}

export function areItemsEquivalent(firstId, secondId) {
  if (firstId === secondId) return true;
  const firstCanonical = canonicalItemId(Math.abs(firstId));
  const secondCanonical = canonicalItemId(Math.abs(secondId));
  if (firstCanonical === secondCanonical) return true;

  const firstBase = firstId < 0 ? Math.abs(firstId) : variationBases.get(firstCanonical) || variationBases.get(firstId);
  const secondBase =
    secondId < 0 ? Math.abs(secondId) : variationBases.get(secondCanonical) || variationBases.get(secondId);
  return firstBase !== undefined && firstBase === secondBase;
}

export function isTaggedItemPlaced(itemId, layout = []) {
  return (layout || []).some((layoutId) => layoutId > 0 && areItemsEquivalent(itemId, layoutId));
}
