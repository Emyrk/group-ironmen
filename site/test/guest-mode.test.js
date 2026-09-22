import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storage } from "../src/data/storage";

describe("guest mode", () => {
  it("stores a group without a token as a guest session", () => {
    storage.storeGroup("gim", "");

    expect(storage.isGuest()).toBe(true);
    expect(storage.getGroup()).toEqual({ groupName: "gim", groupToken: "" });
  });

  it("offers Guest Mode without the old demo or getting-started actions", () => {
    const homepage = readFileSync("src/men-homepage/men-homepage.html", "utf8");
    const index = readFileSync("src/index.html", "utf8");

    expect(homepage).toContain("Guest Mode");
    expect(homepage).toContain('/login?guest');
    expect(homepage).not.toContain("Demo");
    expect(homepage).not.toContain("Get started");
    expect(index).not.toContain('route-path="/demo"');
  });
});
