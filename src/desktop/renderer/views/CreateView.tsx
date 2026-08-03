import { Wand2 } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { EnvironmentStatus } from "../../shared/ipcContract.ts";
import StepLyrics from "../components/create/StepLyrics.tsx";
import StepSong from "../components/create/StepSong.tsx";
import StepSource from "../components/create/StepSource.tsx";
import { type Entwurf, type Schritt, schrittFertig } from "./createDraft.ts";

const TITEL: Record<Schritt, string> = {
  1: "Song",
  2: "Quelle",
  3: "Liedtext",
  4: "Bild",
  5: "Prüfen",
};

const UMGEBUNG_TEXT: Record<string, string> = {
  missing: "Die KI-Umgebung ist noch nicht eingerichtet.",
  broken: "Die KI-Umgebung ist beschädigt.",
  outdated: "Die KI-Umgebung ist veraltet.",
};

export const CreateView: FC<{
  entwurf: Entwurf;
  setEntwurf: (e: Entwurf) => void;
}> = ({ entwurf, setEntwurf }) => {
  const [schritt, setSchritt] = useState<Schritt>(1);
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [installiert, setInstalliert] = useState(false);

  useEffect(() => {
    void window.ultrastar.environmentStatus().then(setEnv);
    return window.ultrastar.on("event:environmentStatus", setEnv);
  }, []);

  const patch = (p: Partial<Entwurf>): void => setEntwurf({ ...entwurf, ...p });
  const pruefung = schrittFertig(entwurf, schritt);
  const warnung = env === null ? undefined : UMGEBUNG_TEXT[env.state];

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
        <Wand2 size={18} aria-hidden /> Song erstellen
      </h2>

      {warnung && (
        <div className="error-banner">
          {warnung} Songs lassen sich trotzdem vorbereiten — gestartet werden
          sie erst, wenn die Umgebung steht.{" "}
          <button
            className="btn small"
            type="button"
            disabled={installiert}
            onClick={() => void installiere()}
          >
            {installiert ? "Wird eingerichtet…" : "Jetzt einrichten"}
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
            {s} {TITEL[s]}
          </span>
        ))}
      </div>

      {schritt === 1 && <StepSong entwurf={entwurf} onChange={patch} />}
      {schritt === 2 && <StepSource entwurf={entwurf} onChange={patch} />}
      {schritt === 3 && <StepLyrics entwurf={entwurf} onChange={patch} />}
      {schritt > 3 && <p className="muted">Schritt {TITEL[schritt]} folgt.</p>}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn"
          type="button"
          disabled={schritt === 1}
          onClick={() => setSchritt((s) => (s > 1 ? ((s - 1) as Schritt) : s))}
        >
          Zurück
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={!pruefung.ok || schritt === 5}
          title={pruefung.ok ? undefined : pruefung.grund}
          onClick={() => setSchritt((s) => (s < 5 ? ((s + 1) as Schritt) : s))}
        >
          Weiter
        </button>
        {!pruefung.ok && <span className="muted">{pruefung.grund}</span>}
      </div>
    </div>
  );
};

export default CreateView;
