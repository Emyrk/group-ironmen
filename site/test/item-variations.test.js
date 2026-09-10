import { describe, expect, it } from "vitest";

import { isTaggedItemPlaced, itemVariations } from "../src/data/item-variations";

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

  it("handles missing layouts and unknown variation groups", () => {
    expect(isTaggedItemPlaced(-113, null)).toBe(false);
    expect(itemVariations(-999999)).toEqual([999999]);
  });
});
