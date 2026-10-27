// src/desktop/renderer/supportPrompt.test.ts
import { describe, expect, it } from "bun:test";
import {
  dismissSupport,
  INITIAL_SUPPORT_STATE,
  mentionsSongCount,
  parseSupportState,
  SUPPORT_COUNT_MENTION_MIN,
  SUPPORT_SNOOZE_MS,
  shouldShowSupportPrompt,
  snoozeSupport,
} from "./supportPrompt.ts";

const NOW = 1_700_000_000_000;

describe("shouldShowSupportPrompt", () => {
  it("shows right from the first start", () => {
    expect(shouldShowSupportPrompt(INITIAL_SUPPORT_STATE, NOW)).toBe(true);
  });

  it("stays hidden while snoozed and returns afterwards", () => {
    const snoozed = snoozeSupport(INITIAL_SUPPORT_STATE, NOW);
    expect(shouldShowSupportPrompt(snoozed, NOW + 1)).toBe(false);
    expect(shouldShowSupportPrompt(snoozed, NOW + SUPPORT_SNOOZE_MS)).toBe(
      true,
    );
  });

  it("never shows again once dismissed", () => {
    const dismissed = dismissSupport(INITIAL_SUPPORT_STATE);
    expect(
      shouldShowSupportPrompt(dismissed, NOW + SUPPORT_SNOOZE_MS * 10),
    ).toBe(false);
  });

  it("does not mutate the input state", () => {
    const state = { ...INITIAL_SUPPORT_STATE };
    snoozeSupport(state, NOW);
    dismissSupport(state);
    expect(state).toEqual(INITIAL_SUPPORT_STATE);
  });
});

describe("mentionsSongCount", () => {
  it("only mentions the collection size once it is worth mentioning", () => {
    expect(mentionsSongCount(0)).toBe(false);
    expect(mentionsSongCount(SUPPORT_COUNT_MENTION_MIN - 1)).toBe(false);
    expect(mentionsSongCount(SUPPORT_COUNT_MENTION_MIN)).toBe(true);
  });
});

describe("parseSupportState", () => {
  it("starts fresh when nothing is stored", () => {
    expect(parseSupportState(null)).toEqual(INITIAL_SUPPORT_STATE);
  });

  it("round-trips a stored state", () => {
    const state = { snoozedUntil: NOW, dismissed: true };
    expect(parseSupportState(JSON.stringify(state))).toEqual(state);
  });

  it("ignores fields from older versions", () => {
    const raw = JSON.stringify({ firstSeenAt: NOW, snoozedUntil: null });
    expect(parseSupportState(raw)).toEqual(INITIAL_SUPPORT_STATE);
  });

  it("falls back to the initial state for broken JSON", () => {
    expect(parseSupportState("{not json")).toEqual(INITIAL_SUPPORT_STATE);
  });

  it("replaces malformed fields individually", () => {
    const raw = JSON.stringify({ snoozedUntil: "soon", dismissed: "yes" });
    expect(parseSupportState(raw)).toEqual(INITIAL_SUPPORT_STATE);
  });
});
