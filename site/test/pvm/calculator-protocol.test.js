import { describe, expect, it, vi } from "vitest";
import {
  CALCULATOR_PROTOCOL_VERSION,
  createCalculatorRequest,
  equipmentIdsFromMember,
  parseCalculatorResponse,
  playerSkillsFromMember,
} from "../../src/pvm/calculator-protocol";
import { CalculatorClient, createHttpCalculatorTransport } from "../../src/pvm/calculator-client";

function item(id) {
  return { id, isValid: () => id > 0 };
}

const member = {
  name: "Alice",
  skills: {
    Attack: { level: 90 },
    Defence: { level: 85 },
    Hitpoints: { level: 99 },
    Magic: { level: 94 },
    Prayer: { level: 77 },
    Ranged: { level: 92 },
    Strength: { level: 95 },
    Mining: { level: 80 },
    Herblore: { level: 78 },
  },
  equipment: [item(10828), item(6570), item(19553), item(4151), item(11832), item(0), undefined, item(11834)],
};

describe("calculator protocol", () => {
  it("maps synchronized skills and sparse RuneLite equipment positions", () => {
    expect(playerSkillsFromMember(member)).toEqual({
      atk: 90,
      def: 85,
      hp: 99,
      magic: 94,
      prayer: 77,
      ranged: 92,
      str: 95,
      mining: 80,
      herblore: 78,
    });
    expect(equipmentIdsFromMember(member)).toMatchObject({
      head: 10828,
      cape: 6570,
      neck: 19553,
      weapon: 4151,
      body: 11832,
      shield: null,
      legs: 11834,
    });
  });

  it("creates a versioned calculator request", () => {
    expect(createCalculatorRequest({ requestId: 7, member, monster: { id: 8059, version: "Vorkath" } })).toMatchObject({
      version: CALCULATOR_PROTOCOL_VERSION,
      action: "calculate",
      requestId: 7,
      player: { name: "Alice", skills: { atk: 90 }, equipment: { weapon: 4151 } },
      monster: { id: 8059, version: "Vorkath" },
    });
  });

  it("validates calculator responses", () => {
    expect(parseCalculatorResponse({ version: 1, requestId: 2, result: { dps: 8.5 } }, 2)).toEqual({ dps: 8.5 });
    expect(() => parseCalculatorResponse({ version: 2, requestId: 2, result: { dps: 8.5 } }, 2)).toThrow(
      "Unsupported calculator protocol version"
    );
    expect(() => parseCalculatorResponse({ version: 1, requestId: 3, result: { dps: 8.5 } }, 2)).toThrow(
      "does not match"
    );
  });

  it("discards stale asynchronous results", async () => {
    const resolvers = [];
    const client = new CalculatorClient((request) => new Promise((resolve) => resolvers.push({ request, resolve })));
    const first = client.calculate({ member, monster: { id: 1 } });
    const second = client.calculate({ member, monster: { id: 2 } });
    resolvers[0].resolve({ version: 1, requestId: 0, result: { dps: 1 } });
    resolvers[1].resolve({ version: 1, requestId: 1, result: { dps: 2 } });
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toEqual({ dps: 2 });
  });

  it("posts requests through an HTTP transport", async () => {
    const json = vi.fn().mockResolvedValue({ version: 1, requestId: 0, result: { dps: 4 } });
    const fetchImplementation = vi.fn().mockResolvedValue({ ok: true, json });
    const transport = createHttpCalculatorTransport("https://calculator.example/v1/calculate", fetchImplementation);
    await transport({ version: 1, requestId: 0 });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://calculator.example/v1/calculate",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } })
    );
  });
});
