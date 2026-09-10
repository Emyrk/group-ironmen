import variationData from "./item-variations.json";

const variationSets = new Map(
  Object.entries(variationData.variations).map(([baseId, members]) => [Number(baseId), new Set(members)])
);

export const itemVariationVersion = variationData.runeliteVersion;

export function itemVariations(itemId) {
  if (itemId >= 0) return [itemId];
  const baseId = Math.abs(itemId);
  return [...(variationSets.get(baseId) || new Set([baseId]))];
}

export function isTaggedItemPlaced(itemId, layout = []) {
  const placed = new Set((layout || []).filter((layoutId) => layoutId > 0));
  return itemVariations(itemId).some((variationId) => placed.has(variationId));
}
