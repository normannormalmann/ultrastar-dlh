// src/desktop/renderer/errorText.ts
// Turns what the main process reports into text in the UI language. Coded
// errors are translated; anything else (an OS message, a server reply) is
// shown as it came, because there is nothing to translate it from.
import { errorCodeOf } from "../shared/appErrors.ts";
import type { AppError } from "../shared/ipcContract.ts";
import type { Katalog } from "./i18n/index.tsx";

export const appErrorText = (t: Katalog, err: AppError): string =>
  err.code
    ? t.errors.code[err.code] + (err.detail ? `: ${err.detail}` : "")
    : err.message;

/** The banner's "[context]" label; unknown contexts are shown verbatim. */
export const errorContextLabel = (t: Katalog, context: string): string =>
  t.errors.context[context] ?? context;

/** For a rejected window.ultrastar call. */
export const thrownErrorText = (t: Katalog, e: unknown): string => {
  const code = errorCodeOf(e);
  if (code) return t.errors.code[code];
  return e instanceof Error ? e.message : String(e);
};
