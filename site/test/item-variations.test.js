import { describe, expect, it } from "vitest";

import { areItemsEquivalent, canonicalItemId, isTaggedItemPlaced, itemVariations } from "../src/data/item-variations";

describe("item variations", () => {
  it("matches positive tagged items by exact layout ID", () => {
    expect(isTaggedItemPlaced(199, [-1, 199])).toBe(true);
    expect(isTaggedItemPlaced(199, [-1, 201])).toBe(false);
  });

  it("matches a negative variation group to any concrete member", () => {
    expect(itemVariations(-113)).toContain(119);
    expect(isTaggedItemPlaced(-113, [-1, 119])).toBe(true);
    expect(isTaggedItemPlaced(-113, [-1, 121])).toBe(false);
  });

  it("matches different positive members of the same variation group", () => {
    expect(areItemsEquivalent(1755, 28414)).toBe(true);
    expect(isTaggedItemPlaced(1755, [28414])).toBe(true);
  });

  it("matches placeholders to their canonical items", () => {
    expect(canonicalItemId(18208)).toBe(11850);
    expect(areItemsEquivalent(11850, 18208)).toBe(true);
    expect(isTaggedItemPlaced(11850, [18208])).toBe(true);
  });

  it("combines canonical and variation mappings", () => {
    expect(canonicalItemId(18659)).toBe(13121);
    expect(areItemsEquivalent(13122, 18659)).toBe(true);
  });

  it("handles missing layouts and unknown variation groups", () => {
    expect(isTaggedItemPlaced(-113, null)).toBe(false);
    expect(itemVariations(-999999)).toEqual([999999]);
  });
});
