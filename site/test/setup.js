import { afterEach, beforeEach, vi } from "vitest";
import { pubsub } from "../src/data/pubsub";

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  pubsub.subscribers = new Map();
  pubsub.unpublishAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
