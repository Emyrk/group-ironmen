import { describe, expect, it } from "vitest";
import {
  exportBankLayouts,
  exportRuneLite,
  parseBankTag,
  parseCsv,
  validateDraft,
} from "../src/bank-tags-page/bank-tag-layout";

describe("bank tag layout interchange", () => {
  const tag = {
    name: "herblore",
    iconItemId: 952,
    itemIds: [-203, 199, 201, 203],
    layout: [199, -1, 201, 203],
  };

  it("parses quoted CSV values", () => {
    expect(parseCsv('banktags,1,"tag ""name""",952')).toEqual(["banktags", "1", 'tag "name"', "952"]);
  });

  it("round trips the Bank Tags Extended format", () => {
    const exported = exportRuneLite(tag);
    expect(exported).toBe("banktags,1,herblore,952,-203,layout,0,199,2,201,3,203");
    expect(parseBankTag(exported)).toEqual(tag);
  });

  it("round trips the BankLayouts format", () => {
    const exported = exportBankLayouts(tag);
    expect(exported).toBe("banktaglayoutsplugin:herblore,199:0,201:2,203:3,banktag:herblore,952,-203,199,201,203");
    expect(parseBankTag(exported)).toEqual(tag);
  });

  it("normalizes drafts while preserving explicit empty slots", () => {
    expect(
      validateDraft({ name: "  HERBLORE ", iconItemId: 952, itemIds: [201, 199, 199], layout: [199, -1, 201, -1] })
    ).toEqual({ name: "herblore", iconItemId: 952, itemIds: [199, 201], layout: [199, -1, 201, -1] });
  });

  it("rejects invalid or oversized layout data", () => {
    expect(() => parseBankTag("banktags,2,tag,952")).toThrow("Unsupported");
    expect(() => validateDraft({ name: "bad/name", iconItemId: 1, itemIds: [], layout: null })).toThrow("Invalid tag");
    expect(() => validateDraft({ name: "tag", iconItemId: 1, itemIds: [], layout: [0] })).toThrow("Layout entries");
  });
});
