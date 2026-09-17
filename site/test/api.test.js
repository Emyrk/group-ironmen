import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/data/api";
import { pubsub } from "../src/data/pubsub";
import { utility } from "../src/utility";
import { groupData } from "../src/data/group-data";
import { exampleData } from "../src/data/example-data";

describe("api", () => {
  beforeEach(() => {
    api.enabled = false;
    api.exampleDataEnabled = false;
    api.groupName = undefined;
    api.groupToken = undefined;
    api.getGroupInterval = undefined;
    api.nextCheck = undefined;

    groupData.members = new Map();
    groupData.groupItems = {};
    groupData.filters = ["existing"];

    globalThis.fetch = vi.fn();
  });

  it("sets credentials and exposes group-scoped urls", () => {
    api.setCredentials("iron-team", "secret-token");

    expect(api.groupName).toBe("iron-team");
    expect(api.groupToken).toBe("secret-token");
    expect(api.getGroupDataUrl).toContain("/group/iron-team/get-group-data");
    expect(api.addMemberUrl).toContain("/group/iron-team/add-group-member");
    expect(api.deleteMemberUrl).toContain("/group/iron-team/delete-group-member");
    expect(api.renameMemberUrl).toContain("/group/iron-team/rename-group-member");
    expect(api.amILoggedInUrl).toContain("/group/iron-team/am-i-logged-in");
    expect(api.skillDataUrl).toContain("/group/iron-team/get-skill-data");
    expect(api.itemHistoryUrl).toContain("/group/iron-team/get-item-history");
    expect(api.goalMapUrl).toContain("/group/iron-team/get-goal-map");
  });

  it("enable waits for data-load events and starts polling once", async () => {
    const waitForAllEventsSpy = vi.spyOn(pubsub, "waitForAllEvents").mockResolvedValue();
    const callOnIntervalSpy = vi.spyOn(utility, "callOnInterval").mockReturnValue(37);

    await api.enable("gim", "token");

    expect(waitForAllEventsSpy).toHaveBeenCalledWith("item-data-loaded", "quest-data-loaded");
    expect(callOnIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(api.enabled).toBe(true);
    expect(api.groupName).toBe("gim");
    expect(api.groupToken).toBe("token");
    expect(api.nextCheck).toBe(new Date(0).toISOString());
  });

  it("disable clears credentials, group caches, and polling interval", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    api.groupName = "gim";
    api.groupToken = "token";
    api.enabled = true;
    api.getGroupInterval = Promise.resolve(99);
    groupData.members = new Map([["Alice", {}]]);
    groupData.groupItems = { 4151: { id: 4151, quantity: 1 } };

    await api.disable();

    expect(clearIntervalSpy).toHaveBeenCalledWith(99);
    expect(api.enabled).toBe(false);
    expect(api.groupName).toBeUndefined();
    expect(api.groupToken).toBeUndefined();
    expect(groupData.members.size).toBe(0);
    expect(groupData.groupItems).toEqual({});
    expect(groupData.filters).toEqual([""]);
  });

  it("getGroupData publishes updated group data after successful fetch", async () => {
    api.setCredentials("gim", "token");
    api.nextCheck = "2026-03-30T00:00:00.000Z";

    const payload = [{ name: "Alice" }];
    const responseJson = vi.fn().mockResolvedValue(payload);
    globalThis.fetch.mockResolvedValue({ ok: true, json: responseJson });

    const updateSpy = vi.spyOn(groupData, "update").mockReturnValue(new Date("2026-03-30T00:00:05.000Z"));
    const publishSpy = vi.spyOn(pubsub, "publish");

    await api.getGroupData();

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/group/gim/get-group-data?from_time=2026-03-30T00:00:00.000Z", {
      headers: { Authorization: "token" },
    });
    expect(updateSpy).toHaveBeenCalledWith(payload);
    expect(api.nextCheck).toBe("2026-03-30T00:00:05.000Z");
    expect(publishSpy).toHaveBeenCalledWith("get-group-data", groupData);
  });

  it("getGroupData handles unauthorized responses by disabling and redirecting", async () => {
    const disableSpy = vi.spyOn(api, "disable").mockResolvedValue();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const publishSpy = vi.spyOn(pubsub, "publish");

    globalThis.fetch.mockResolvedValue({ ok: false, status: 401 });

    await api.getGroupData();

    expect(disableSpy).toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledWith("", "", "/login");
    expect(publishSpy).toHaveBeenCalledWith("get-group-data");
  });

  it("getGroupData ignores non-401 fetch errors", async () => {
    const disableSpy = vi.spyOn(api, "disable");
    const publishSpy = vi.spyOn(pubsub, "publish");

    globalThis.fetch.mockResolvedValue({ ok: false, status: 500 });

    await api.getGroupData();

    expect(disableSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("uses example data path for group and skill data when enabled", async () => {
    api.exampleDataEnabled = true;

    const groupPayload = [{ name: "Example" }];
    const skillPayload = [{ name: "Example", skill_data: [] }];
    vi.spyOn(exampleData, "getGroupData").mockReturnValue(groupPayload);
    vi.spyOn(exampleData, "getSkillData").mockReturnValue(skillPayload);
    const updateSpy = vi.spyOn(groupData, "update").mockReturnValue(new Date("2026-03-30T00:00:01.000Z"));
    const publishSpy = vi.spyOn(pubsub, "publish");

    await api.getGroupData();
    const skillData = await api.getSkillData("week");

    expect(updateSpy).toHaveBeenCalledWith(groupPayload);
    expect(publishSpy).toHaveBeenCalledWith("get-group-data", groupData);
    expect(skillData).toBe(skillPayload);
    expect(exampleData.getSkillData).toHaveBeenCalledWith("week", groupData);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends expected request shapes for member and auth helper endpoints", async () => {
    api.setCredentials("gim", "token");

    const response = { ok: true, json: vi.fn().mockResolvedValue({ enabled: true }) };
    globalThis.fetch.mockResolvedValue(response);

    await api.createGroup("new-group", ["Alice", "Bob"], "captcha-token");
    await api.addMember("Charlie");
    await api.removeMember("Charlie");
    await api.renameMember("Charlie", "Charlotte");
    await api.amILoggedIn();
    await api.getGePrices();
    await api.getCaptchaEnabled();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "/api/create-group", {
      body: JSON.stringify({
        name: "new-group",
        member_names: ["Alice", "Bob"],
        captcha_response: "captcha-token",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "/api/group/gim/add-group-member", {
      body: JSON.stringify({ name: "Charlie" }),
      headers: { "Content-Type": "application/json", Authorization: "token" },
      method: "POST",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(3, "/api/group/gim/delete-group-member", {
      body: JSON.stringify({ name: "Charlie" }),
      headers: { "Content-Type": "application/json", Authorization: "token" },
      method: "DELETE",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(4, "/api/group/gim/rename-group-member", {
      body: JSON.stringify({ original_name: "Charlie", new_name: "Charlotte" }),
      headers: { "Content-Type": "application/json", Authorization: "token" },
      method: "PUT",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(5, "/api/group/gim/am-i-logged-in", {
      headers: { Authorization: "token" },
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(6, "/api/ge-prices");
    expect(globalThis.fetch).toHaveBeenNthCalledWith(7, "/api/captcha-enabled");
  });

  it("does not request item history before credentials are initialized", async () => {
    await expect(api.getItemHistory()).rejects.toThrow("Group credentials are not initialized");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetches authenticated item history for an optional date range", async () => {
    api.setCredentials("gim", "token");
    const history = { dates: ["2026-09-15", "2026-09-16"], from: "2026-09-15", to: "2026-09-16" };
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(history),
    });

    await expect(api.getItemHistory("2026-09-15", "2026-09-16")).resolves.toEqual(history);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/group/gim/get-item-history?from=2026-09-15&to=2026-09-16", {
      headers: { Authorization: "token" },
    });
  });

  it("rejects failed item history requests", async () => {
    api.setCredentials("gim", "token");
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(api.getItemHistory()).rejects.toThrow("Failed to load item history (500)");
  });

  it("fetches an authenticated goal map for the selected character", async () => {
    api.setCredentials("gim", "token");
    const goalMap = { selectedCharacter: "Alice", characters: ["Alice"], nodes: [], edges: [] };
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(goalMap),
    });

    await expect(api.getGoalMap("Alice & Bob")).resolves.toEqual(goalMap);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/group/gim/get-goal-map?character=Alice+%26+Bob", {
      headers: { Authorization: "token" },
    });
  });

  it("rejects goal map requests without credentials or after failed responses", async () => {
    await expect(api.getGoalMap("Alice")).rejects.toThrow("Group credentials are not initialized");
    expect(globalThis.fetch).not.toHaveBeenCalled();

    api.setCredentials("gim", "token");
    globalThis.fetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(api.getGoalMap("Alice")).rejects.toThrow("Failed to load goal map (503)");
  });

  it("restart re-enables with existing credentials", async () => {
    api.setCredentials("gim", "token");
    const enableSpy = vi.spyOn(api, "enable").mockResolvedValue();

    await api.restart();

    expect(enableSpy).toHaveBeenCalledWith("gim", "token");
  });
});
