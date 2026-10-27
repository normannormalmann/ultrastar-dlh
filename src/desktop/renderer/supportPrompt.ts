// Decides when the in-app "support the project" card shows up. Pure logic plus
// a thin localStorage wrapper; losing the stored state only means the card may
// appear once more, so storage failures are swallowed on purpose.

export const GITHUB_URL = "https://github.com/normannormalmann/ultrastar-dlh";
export const COFFEE_URL = "https://buymeacoffee.com/normanschou";

/** From this collection size on, the card mentions how many songs someone has. */
export const SUPPORT_COUNT_MENTION_MIN = 25;
/** "Later" hides the card for this long. */
export const SUPPORT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const STORAGE_KEY = "ultrastar.supportPrompt";

export type SupportPromptState = {
  snoozedUntil: number | null;
  dismissed: boolean;
};

export const INITIAL_SUPPORT_STATE: SupportPromptState = {
  snoozedUntil: null,
  dismissed: false,
};

/** Shown from the very first start until dismissed; "Later" pauses it. */
export const shouldShowSupportPrompt = (
  state: SupportPromptState,
  now: number,
): boolean =>
  !state.dismissed &&
  (state.snoozedUntil === null || now >= state.snoozedUntil);

export const mentionsSongCount = (downloadedCount: number): boolean =>
  downloadedCount >= SUPPORT_COUNT_MENTION_MIN;

export const snoozeSupport = (
  state: SupportPromptState,
  now: number,
): SupportPromptState => ({ ...state, snoozedUntil: now + SUPPORT_SNOOZE_MS });

export const dismissSupport = (
  state: SupportPromptState,
): SupportPromptState => ({ ...state, dismissed: true });

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Falls back to the initial state for anything missing or malformed. */
export const parseSupportState = (raw: string | null): SupportPromptState => {
  if (raw === null) return INITIAL_SUPPORT_STATE;
  try {
    const v = JSON.parse(raw) as Partial<
      Record<keyof SupportPromptState, unknown>
    >;
    return {
      snoozedUntil: isFiniteNumber(v.snoozedUntil) ? v.snoozedUntil : null,
      dismissed: v.dismissed === true,
    };
  } catch {
    return INITIAL_SUPPORT_STATE;
  }
};

export const loadSupportState = (): SupportPromptState => {
  try {
    return parseSupportState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return INITIAL_SUPPORT_STATE;
  }
};

export const saveSupportState = (state: SupportPromptState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist support prompt state:", e);
  }
};
