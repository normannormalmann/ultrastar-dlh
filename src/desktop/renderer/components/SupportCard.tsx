import { Coffee, Star } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useT } from "../i18n/index.tsx";
import {
  COFFEE_URL,
  dismissSupport,
  GITHUB_URL,
  loadSupportState,
  type SupportPromptState,
  saveSupportState,
  shouldShowSupportPrompt,
  snoozeSupport,
} from "../supportPrompt.ts";

/**
 * Unobtrusive "star / buy me a coffee" card. Appears only for people who have
 * used the app for a while; any action hides it, "Later" only for a month.
 * External links are opened in the system browser by the main process.
 */
const SupportCard: FC<{ downloadedCount: number }> = ({ downloadedCount }) => {
  const t = useT();
  const [state, setState] = useState<SupportPromptState>(() =>
    loadSupportState(Date.now()),
  );

  if (!shouldShowSupportPrompt(state, downloadedCount, Date.now())) return null;

  const update = (next: SupportPromptState): void => {
    saveSupportState(next);
    setState(next);
  };
  const dismiss = (): void => update(dismissSupport(state));

  return (
    <div className="support-card">
      <strong>{t.support.title}</strong>
      <p className="muted">
        {t.support.text(downloadedCount.toLocaleString(t.locale))}
      </p>
      <div className="row">
        <a className="btn primary" href={GITHUB_URL} onClick={dismiss}>
          <Star size={16} /> {t.support.star}
        </a>
        <a className="btn" href={COFFEE_URL} onClick={dismiss}>
          <Coffee size={16} /> {t.support.coffee}
        </a>
        <span className="support-card-spacer" />
        <button
          className="btn small"
          type="button"
          onClick={() => update(snoozeSupport(state, Date.now()))}
        >
          {t.support.later}
        </button>
        <button className="btn small" type="button" onClick={dismiss}>
          {t.support.never}
        </button>
      </div>
    </div>
  );
};

export default SupportCard;
