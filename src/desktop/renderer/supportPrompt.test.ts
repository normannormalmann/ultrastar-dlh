// src/desktop/renderer/supportPrompt.test.ts
import { describe, expect, it } from "bun:test";
import {
  dismissSupport,
  initialSupportState,
  parseSupportState,
  SUPPORT_MIN_AGE_MS,
  SUPPORT_MIN_SONGS,
  SUPPORT_SNOOZE_MS,
  shouldShowSupportPrompt,
  snoozeSupport,
} from "./supportPrompt.ts";

const START = 1_700_000_000_000;
const LATER = START + SUPPORT_MIN_AGE_MS;

describe("shouldShowSupportPrompt", () => {
  it("shows once enough songs and enough time have passed", () => {
    expect(
      shouldShowSupportPrompt(
        initialSupportState(START),
        SUPPORT_MIN_SONGS,
        LATER,
      ),
    ).toBe(true);
  });

  it("stays hidden below the song threshold", () => {
    expect(
      shouldShowSupportPrompt(
        initialSupportState(START),
        SUPPORT_MIN_SONGS - 1,
        LATER,
      ),
    ).toBe(false);
  });

  it("stays hidden during the grace period after first launch, even for big imports", () => {
    expect(
      shouldShowSupportPrompt(initialSupportState(START), 10_000, LATER - 1),
    ).toBe(false);
  });

  it("stays hidden while snoozed and returns afterwards", () => {
    const snoozed = snoozeSupport(initialSupportState(START), LATER);
    expect(shouldShowSupportPrompt(snoozed, 100, LATER + 1)).toBe(false);
    expect(
      shouldShowSupportPrompt(snoozed, 100, LATER + SUPPORT_SNOOZE_MS),
    ).toBe(true);
  });

  it("never shows again once dismissed", () => {
    const dismissed = dismissSupport(initialSupportState(START));
    expect(
      shouldShowSupportPrompt(dismissed, 100, LATER + SUPPORT_SNOOZE_MS * 10),
    ).toBe(false);
  });

  it("does not mutate the input state", () => {
    const state = initialSupportState(START);
    snoozeSupport(state, LATER);
    dismissSupport(state);
    expect(state).toEqual(initialSupportState(START));
  });
});

describe("parseSupportState", () => {
  it("starts fresh when nothing is stored", () => {
    expect(parseSupportState(null, START)).toEqual(initialSupportState(START));
  });

  it("round-trips a stored state", () => {
    const state = { firstSeenAt: START, snoozedUntil: LATER, dismissed: true };
    expect(parseSupportState(JSON.stringify(state), LATER)).toEqual(state);
  });

  it("falls back to a fresh state for broken JSON", () => {
    expect(parseSupportState("{not json", START)).toEqual(
      initialSupportState(START),
    );
  });

  it("replaces malformed fields individually", () => {
    const raw = JSON.stringify({
      firstSeenAt: "yesterday",
      snoozedUntil: "soon",
      dismissed: "yes",
    });
    expect(parseSupportState(raw, START)).toEqual(initialSupportState(START));
  });
});
