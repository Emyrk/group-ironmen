import { describe, expect, it } from "vitest";
import { handleCalculatorRequest } from "../../vendor/osrs-wiki-dps/worker-entry";

const maxSkills = {
  atk: 99,
  def: 99,
  hp: 99,
  magic: 99,
  prayer: 99,
  ranged: 99,
  str: 99,
  mining: 99,
  herblore: 99,
};

describe("vendored OSRS Wiki calculator worker", () => {
  it("returns real upstream results for a Vorkath loadout", () => {
    const response = handleCalculatorRequest({
      version: 1,
      action: "calculate",
      requestId: 42,
      player: {
        name: "Vorkath smoke test",
        skills: maxSkills,
        equipment: {
          weapon: 21012,
          ammo: 21944,
        },
      },
      monster: { id: 8059, version: "Post-quest" },
      options: { prayers: ["RIGOUR"] },
    });

    expect(response).toMatchObject({
      version: 1,
      requestId: 42,
      result: {
        maxHit: 100,
        attackSpeed: 5,
      },
    });
    expect(response.result.dps).toBeCloseTo(6.4337974019, 9);
    expect(response.result.accuracy).toBeCloseTo(0.6146669226, 9);
    expect(response.result.expectedTtk).toBeCloseTo(120.5687734583, 9);
  });

  it("returns protocol errors instead of throwing across the worker boundary", () => {
    expect(
      handleCalculatorRequest({
        version: 1,
        action: "calculate",
        requestId: 7,
        player: { skills: maxSkills, equipment: {} },
        monster: { id: -999 },
      })
    ).toEqual({
      version: 1,
      requestId: 7,
      error: { message: "Unknown monster ID -999" },
    });
  });
});
