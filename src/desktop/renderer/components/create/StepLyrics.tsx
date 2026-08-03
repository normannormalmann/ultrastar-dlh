import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
  type Antwort,
  normalizeLyrics,
} from "../../../../core/create/lyrics.ts";
import type { Entwurf } from "../../views/createDraft.ts";

/**
 * Step 3. normalizeLyrics is imported straight from core: it is pure, and a
 * second implementation in the renderer would be a second truth about which
 * lines survive - the CLI checks with this very function.
 */
export const StepLyrics: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const [sucht, setSucht] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  // One automatic lookup per song/duration - retyping must not hammer the API.
  const gefragt = useRef<string | null>(null);

  const holeText = async (): Promise<void> => {
    if (entwurf.durationSec === null) {
      setMeldung("Ohne Spieldauer ist keine LRCLIB-Abfrage möglich.");
      return;
    }
    setSucht(true);
    try {
      const text = await window.ultrastar.createLyricsSearch({
        artist: entwurf.artist,
        title: entwurf.title,
        durationSec: entwurf.durationSec,
      });
      if (text === null) {
        setMeldung(
          "Bei LRCLIB nichts gefunden — bitte den Text von Hand einfügen.",
        );
        return;
      }
      setMeldung("Synchronisierte Lyrics gefunden — sie verbessern das Timing.");
      onChange({ rohtext: text, syncedText: text, antworten: [] });
    } finally {
      setSucht(false);
    }
  };

  useEffect(() => {
    const schluessel = `${entwurf.artist}|${entwurf.title}|${entwurf.durationSec}`;
    if (gefragt.current === schluessel) return;
    if (entwurf.rohtext.trim().length > 0) return;
    if (entwurf.durationSec === null) return;
    gefragt.current = schluessel;
    void holeText();
  });

  const { entfernt, offeneFragen } = normalizeLyrics(entwurf.rohtext);
  const antwortFuer = (index: number): Antwort | undefined =>
    entwurf.antworten.find((a) => a.zeilenIndex === index);
  const antworte = (a: Antwort): void =>
    onChange({
      antworten: [
        ...entwurf.antworten.filter((v) => v.zeilenIndex !== a.zeilenIndex),
        a,
      ],
    });
  const istGewaehlt = (index: number, wahl: string): boolean =>
    antwortFuer(index)?.wahl === wahl;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          className="btn"
          type="button"
          disabled={sucht}
          onClick={() => void holeText()}
        >
          {sucht ? "Sucht…" : "Bei LRCLIB nachsehen"}
        </button>
        {entwurf.syncedText && (
          <span className="muted">Synchronisierte Lyrics liegen vor ✓</span>
        )}
      </div>

      {meldung && <p className="muted">{meldung}</p>}

      <textarea
        className="input"
        style={{ width: "100%", minHeight: 220, fontFamily: "monospace" }}
        placeholder="Eine Zeile pro gesungener Phrase. Leerzeilen trennen Blöcke."
        value={entwurf.rohtext}
        onChange={(ev) =>
          onChange({
            rohtext: ev.target.value,
            // Own text has no .lrc, and the answers point at line numbers
            // that just moved - both have to go.
            syncedText:
              ev.target.value === entwurf.syncedText
                ? entwurf.syncedText
                : null,
            antworten: [],
          })
        }
      />

      {entfernt.length > 0 && (
        <p className="muted">
          Diese Zeilen fliegen raus, weil sie nie gesungen werden:{" "}
          {entfernt.join(", ")}
        </p>
      )}

      {offeneFragen.map((f) => (
        <div
          key={f.zeilenIndex}
          className="error-banner"
          style={{ marginTop: 8 }}
        >
          {f.kind === "repeat_scope" ? (
            <>
              Zeile {f.zeilenIndex + 1} endet auf „{f.marker}". Was soll doppelt
              gesungen werden?
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className={
                    istGewaehlt(f.zeilenIndex, "zeile")
                      ? "btn small primary"
                      : "btn small"
                  }
                  type="button"
                  onClick={() =>
                    antworte({
                      kind: "repeat_scope",
                      zeilenIndex: f.zeilenIndex,
                      wahl: "zeile",
                    })
                  }
                >
                  Nur diese Zeile
                </button>
                <button
                  className={
                    istGewaehlt(f.zeilenIndex, "block")
                      ? "btn small primary"
                      : "btn small"
                  }
                  type="button"
                  onClick={() =>
                    antworte({
                      kind: "repeat_scope",
                      zeilenIndex: f.zeilenIndex,
                      wahl: "block",
                    })
                  }
                >
                  Den ganzen Block ({f.blockZeilen.length} Zeilen)
                </button>
              </div>
            </>
          ) : (
            <>
              In Zeile {f.zeilenIndex + 1} steht nur ein Refrain-Verweis.
              {f.refrainZeilen.length > 0
                ? ` Diesen Refrain einsetzen? („${f.refrainZeilen[0]}" …)`
                : " Es gibt keinen früheren Refrain, den man einsetzen könnte."}
              <div className="row" style={{ marginTop: 6 }}>
                {f.refrainZeilen.length > 0 && (
                  <button
                    className={
                      istGewaehlt(f.zeilenIndex, "einsetzen")
                        ? "btn small primary"
                        : "btn small"
                    }
                    type="button"
                    onClick={() =>
                      antworte({
                        kind: "chorus_reference",
                        zeilenIndex: f.zeilenIndex,
                        wahl: "einsetzen",
                      })
                    }
                  >
                    Refrain einsetzen
                  </button>
                )}
                <button
                  className={
                    istGewaehlt(f.zeilenIndex, "verwerfen")
                      ? "btn small primary"
                      : "btn small"
                  }
                  type="button"
                  onClick={() =>
                    antworte({
                      kind: "chorus_reference",
                      zeilenIndex: f.zeilenIndex,
                      wahl: "verwerfen",
                    })
                  }
                >
                  Zeile verwerfen
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export default StepLyrics;
