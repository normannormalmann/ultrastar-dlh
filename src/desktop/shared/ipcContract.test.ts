import { expect, test } from "bun:test";
import { EVENT_CHANNELS, INVOKE_CHANNELS } from "./ipcContract.ts";

test("invoke channels are unique and namespaced", () => {
  expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
  for (const c of INVOKE_CHANNELS) expect(c).toMatch(/^[a-z]+:[a-zA-Z]+$/);
});

test("event channels are unique and use the event: prefix", () => {
  expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
  for (const c of EVENT_CHANNELS) expect(c.startsWith("event:")).toBe(true);
});
