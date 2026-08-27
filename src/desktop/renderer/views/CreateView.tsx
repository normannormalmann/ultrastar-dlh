import { Wand2 } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type {
  DownloadedEntry,
  EnvironmentStatus,
} from "../../shared/ipcContract.ts";
import StepCover from "../components/create/StepCover.tsx";
import StepLyrics from "../components/create/StepLyrics.tsx";
import StepReview from "../components/create/StepReview.tsx";
import StepSong from "../components/create/StepSong.tsx";
import StepSource from "../components/create/StepSource.tsx";
import { type Katalog, useT } from "../i18n/index.tsx";
import {
  type Entwurf,
  leererEntwurf,
  type Pruefung,
  type Schritt,
  schrittFertig,
} from "./createDraft.ts";

/** schrittFertig returns a code; only the UI knows the wording. */
const grundText = (t: Katalog, p: Pruefung): string | undefined => {
  if (p.ok) return undefined;
  if (p.grund === "openQuestions") {
    return t.create.reason.openQuestions(p.anzahl ?? 0);
  }
  return t.create.reason[p.grund];
};

const umgebungText = (
  t: Katalog,
  state: string,
): string | undefined =>
  ({
    missing: t.create.envMissing,
    broken: t.create.envBroken,
    outdated: t.create.envOutdated,
  })[state];

export const CreateView: FC<{
  entwurf: Entwurf;
  setEntwurf: (e: Entwurf) => void;
  /** Only step 5 needs it, for the duplicate warning. */
  downloaded: DownloadedEntry[];
}> = ({ entwurf, setEntwurf, downloaded }) => {
  const t = useT();
  const [schritt, setSchritt] = useState<Schritt>(1);
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [installiert, setInstalliert] = useState(false);

  useEffect(() => {
    void window.ultrastar.environmentStatus().then(setEnv);
    return window.ultrastar.on("event:environmentStatus", setEnv);
  }, []);

  const patch = (p: Partial<Entwurf>): void => setEntwurf({ ...entwurf, ...p });
  const pruefung = schrittFertig(entwurf, schritt);
  const grund = grundText(t, pruefung);
  const warnung = env === null ? undefined : umgebungText(t, env.state);

  const installiere = async (): Promise<void> => {
    setInstalliert(true);
    try {
      setEnv(await window.ultrastar.environmentInstall(false));
    } finally {
      setInstalliert(false);
    }
  };

  return (
    <div>
      <h2>
        <Wand2 size={18} aria-hidden /> {t.create.title}
      </h2>

      {warnung && (
        <div className="error-banner">
          {warnung} {t.create.envHint}{" "}
          <button
            className="btn small"
            type="button"
            disabled={installiert}
            onClick={() => void installiere()}
          >
            {installiert ? t.create.envInstalling : t.create.envInstallNow}
          </button>
        </div>
      )}

      <div className="row muted" style={{ marginBottom: 16 }}>
        {([1, 2, 3, 4, 5] as const).map((s) => (
          <span
            key={s}
            style={{
              fontWeight: s === schritt ? 700 : 400,
              color: s === schritt ? "var(--yellow)" : undefined,
            }}
          >
            {s} {t.create.steps[s]}
          </span>
        ))}
      </div>

      {schritt === 1 && <StepSong entwurf={entwurf} onChange={patch} />}
      {schritt === 2 && <StepSource entwurf={entwurf} onChange={patch} />}
      {schritt === 3 && <StepLyrics entwurf={entwurf} onChange={patch} />}
      {schritt === 4 && <StepCover entwurf={entwurf} onChange={patch} />}
      {schritt === 5 && (
        <StepReview
          entwurf={entwurf}
          downloaded={downloaded}
          onAbgeschickt={() => {
            setEntwurf(leererEntwurf(crypto.randomUUID()));
            setSchritt(1);
          }}
        />
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn"
          type="button"
          disabled={schritt === 1}
          onClick={() => setSchritt((s) => (s > 1 ? ((s - 1) as Schritt) : s))}
        >
          {t.create.back}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={!pruefung.ok || schritt === 5}
          title={grund}
          onClick={() => setSchritt((s) => (s < 5 ? ((s + 1) as Schritt) : s))}
        >
          {t.create.next}
        </button>
        {grund && <span className="muted">{grund}</span>}
      </div>
    </div>
  );
};

export default CreateView;
