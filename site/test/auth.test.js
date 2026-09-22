// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import authModule from "../server/auth";

const { privateAuth } = authModule;
const config = { privateGroupName: "gim", privateSyncToken: "secret" };

function run({ method = "GET", groupName = "gim", authorization } = {}) {
  const req = {
    method,
    params: { groupName },
    get: vi.fn(() => authorization),
  };
  const res = {
    locals: {},
    status: vi.fn(function () {
      return this;
    }),
    end: vi.fn(),
  };
  const next = vi.fn();
  privateAuth(config)(req, res, next);
  return { res, next };
}

describe("privateAuth", () => {
  it("allows unauthenticated GET requests as guest reads", () => {
    const { res, next } = run();

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.guestMode).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("requires valid authentication for writes", () => {
    expect(run({ method: "PUT" }).res.status).toHaveBeenCalledWith(401);
    expect(run({ method: "PUT", authorization: "secret" }).next).toHaveBeenCalledOnce();
  });

  it("rejects supplied invalid authentication and unknown groups", () => {
    expect(run({ authorization: "wrong" }).res.status).toHaveBeenCalledWith(401);
    expect(run({ groupName: "other" }).res.status).toHaveBeenCalledWith(404);
  });
});
