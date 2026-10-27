// Decides when the in-app "support the project" card shows up. Pure logic plus
// a thin localStorage wrapper; losing the stored state only means the card may
// appear once more, so storage failures are swallowed on purpose.

export const GITHUB_URL = "https://github.com/normannormalmann/ultrastar-dlh";
export const COFFEE_URL = "https://buymeacoffee.com/normanschou";

/** Only ask people who clearly got value out of the app. */
export const SUPPORT_MIN_SONGS = 25;
/** Grace period after the first launch, so a big archive import doesn't trigger it right away. */
export const SUPPORT_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** "Later" hides the card for this long. */
export const SUPPORT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const STORAGE_KEY = "ultrastar.supportPrompt";

export type SupportPromptState = {
  firstSeenAt: number;
  snoozedUntil: number | null;
  dismissed: boolean;
};

export const initialSupportState = (now: number): SupportPromptState => ({
  firstSeenAt: now,
  snoozedUntil: null,
  dismissed: false,
});

export const shouldShowSupportPrompt = (
  state: SupportPromptState,
  downloadedCount: number,
  now: number,
): boolean =>
  !state.dismissed &&
  downloadedCount >= SUPPORT_MIN_SONGS &&
  now - state.firstSeenAt >= SUPPORT_MIN_AGE_MS &&
  (state.snoozedUntil === null || now >= state.snoozedUntil);

export const snoozeSupport = (
  state: SupportPromptState,
  now: number,
): SupportPromptState => ({ ...state, snoozedUntil: now + SUPPORT_SNOOZE_MS });

export const dismissSupport = (
  state: SupportPromptState,
): SupportPromptState => ({ ...state, dismissed: true });

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Falls back to a fresh state for anything missing or malformed. */
export const parseSupportState = (
  raw: string | null,
  now: number,
): SupportPromptState => {
  if (raw === null) return initialSupportState(now);
  try {
    const v = JSON.parse(raw) as Partial<
      Record<keyof SupportPromptState, unknown>
    >;
    return {
      firstSeenAt: isFiniteNumber(v.firstSeenAt) ? v.firstSeenAt : now,
      snoozedUntil: isFiniteNumber(v.snoozedUntil) ? v.snoozedUntil : null,
      dismissed: v.dismissed === true,
    };
  } catch {
    return initialSupportState(now);
  }
};

export const loadSupportState = (now: number): SupportPromptState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = parseSupportState(raw, now);
    if (raw === null) saveSupportState(state);
    return state;
  } catch {
    return initialSupportState(now);
  }
};

export const saveSupportState = (state: SupportPromptState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist support prompt state:", e);
  }
};
