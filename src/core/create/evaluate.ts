// src/core/create/evaluate.ts
import { beatToMs } from "./format.ts";

export type ReferenceSong = {
  bpm: number;
  gap: number;
  syllables: { syllable: string; onsetMs: number; pitch: number }[];
};

export type Metrics = {
  paare: number;
  medianAbweichungMs: number;
  p90AbweichungMs: number;
  anteilUnter50ms: number;
  anteilUnter100ms: number;
  notenzahlDifferenz: number;
  /** Median von (unsere Tonhoehe minus Referenz) ueber alle Paare. */
  medianPitchOffset: number;
  /** Anteil der Paare, die nach Abzug von medianPitchOffset exakt passen. */
  anteilPitchExakt: number;
  /**
   * Median von (unser Onset minus Referenz-Onset), vorzeichenbehalten.
   * medianAbweichungMs nimmt den Betrag und kann deshalb einen konstanten
   * Versatz nicht von lokalem Verrutschen unterscheiden — dieser Wert traegt
   * das Vorzeichen und macht die Richtung sichtbar.
   */
  medianVersatzMs: number;
  /**
   * Mittlerer Versatz je Zehntel des Songs, immer genau zehn Eintraege
   * (auch bei weniger als zehn Paaren oder gar keinem) — nur so bleiben
   * Songs unterschiedlicher Laenge in diesem Profil vergleichbar.
   */
  driftProfil: number[];
  /**
   * Anteil der Referenzsilben, die einen inhaltlichen Partner gefunden haben.
   * Ist er niedrig, beschreiben die uebrigen Kennzahlen nur einen Ausschnitt
   * des Songs — das muss sichtbar sein, nicht stillschweigend.
   */
  anteilGepaart: number;
  /**
   * Anteil der Paare unter 50 ms, nachdem der mediane Versatz des Songs
   * herausgerechnet wurde. Reine Diagnose: so viel waere mit einer
   * perfekten GAP-Kalibrierung zu holen, ohne am Alignment zu drehen.
   */
  anteilUnter50msKalibriert: number;
  /**
   * Wie anteilUnter50msKalibriert, aber mit der 100-ms-Grenze. Grundlage der
   * Zieldiskussion: was an lokalem Jitter bleibt, nachdem eine perfekte
   * per-Song-Kalibrierung den konstanten Versatz bereits herausgerechnet hat.
   */
  anteilUnter100msKalibriert: number;
};

const zahlAusHeader = (txt: string, name: string, standard: number): number => {
  const m = new RegExp(`^#${name}:(.*)$`, "m").exec(txt);
  if (!m?.[1]) return standard;
  // Deutsche Bestandsdateien nutzen Komma als Dezimaltrenner.
  const wert = Number.parseFloat(m[1].trim().replace(",", "."));
  return Number.isNaN(wert) ? standard : wert;
};

/** Liest ein UltraStar-.txt in eine vergleichbare Silbenfolge samt Tonhoehe. */
export const parseReferenceTxt = (txt: string): ReferenceSong => {
  const bpm = zahlAusHeader(txt, "BPM", 0);
  const gap = zahlAusHeader(txt, "GAP", 0);
  const syllables: { syllable: string; onsetMs: number; pitch: number }[] = [];

  for (const roh of txt.split("\n")) {
    // Nur das Windows-Zeilenende kappen, nicht trimEnd(): die letzte Silbe
    // eines Worts traegt hier ihr Leerzeichen als Trennzeichen zum naechsten
    // Wort. trimEnd() wuerde genau dieses Leerzeichen verschlucken und alle
    // Woerter einer Zeile zu einer Silbe verschmelzen.
    const zeile = roh.replace(/\r$/, "");
    const m = /^[:*FR]\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/.exec(zeile);
    if (!m?.[1]) continue;
    syllables.push({
      syllable: m[4] ?? "",
      onsetMs: beatToMs(Number.parseInt(m[1], 10), bpm, gap),
      pitch: Number.parseInt(m[3] ?? "0", 10),
    });
  }
  return { bpm, gap, syllables };
};

/**
 * q-Quantil einer Zahlenliste. Kein interpoliertes Quantil, sondern der
 * naechstliegende tatsaechlich vorhandene Wert (floor-Index) — reicht fuer
 * den Bewertungsbericht und bleibt fuer leere Listen bei 0, statt NaN zu
 * produzieren.
 */
const quantil = (werte: number[], q: number): number => {
  if (werte.length === 0) return 0;
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))] ?? 0;
};

// Vergleichsform einer Silbe: ohne Schreibweise, Diakritika, Satzzeichen und
// das Worttrenn-Leerzeichen. Ausschliesslich fuer die Paarung — ausgegeben
// wird immer der Originaltext. Nah an der Semantik von normalisiere() im
// Python-Sidecar (anchors.py), aber nicht identisch: toLowerCase() ist
// nicht casefold() (z.B. wird "ß" in Python zu "ss", hier nicht). Fuer die
// Silbenpaarung ist das praktisch folgenlos.
const normalisiere = (s: string): string =>
  s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Paart unsere Silben inhaltlich mit den Referenzsilben: laengste gemeinsame
 * Teilfolge ueber die Vergleichsform. Die Silbentrennung ist eine menschliche
 * Entscheidung — gemessen weicht unsere Notenzahl um -15 % bis +5 % von der
 * Referenz ab. Eine positionale Paarung vergleicht ab der ersten Abweichung
 * verschiedene Woerter; die LCS ueberspringt Einschuebe auf beiden Seiten und
 * bleibt dabei in beiden Folgen streng vorwaerts, sodass Wiederholungen nicht
 * kreuzweise verglichen werden.
 */
const paareSilben = (
  unser: ReferenceSong,
  referenz: ReferenceSong,
): [number, number][] => {
  const a = unser.syllables.map((s) => normalisiere(s.syllable));
  const b = referenz.syllables.map((s) => normalisiere(s.syllable));
  const n = a.length;
  const m = b.length;
  // folge[i][j] = LCS-Laenge von a[i:], b[j:].
  const folge: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    const zeile = folge[i] as number[];
    const naechste = folge[i + 1] as number[];
    const ai = a[i] ?? "";
    for (let j = m - 1; j >= 0; j--) {
      zeile[j] =
        ai !== "" && ai === b[j]
          ? (naechste[j + 1] ?? 0) + 1
          : Math.max(naechste[j] ?? 0, zeile[j + 1] ?? 0);
    }
  }
  const paare: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if ((a[i] ?? "") !== "" && a[i] === b[j]) {
      paare.push([i, j]);
      i++;
      j++;
    } else if ((folge[i + 1]?.[j] ?? 0) >= (folge[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return paare;
};

/**
 * Vergleicht unsere Ausgabe gegen eine von Menschen gesyncte Referenz.
 * Verglichen werden nur inhaltlich echte Paare (LCS ueber die Vergleichsform
 * der Silbentexte), nicht Position i gegen Position i: die Silbentrennung
 * ist eine menschliche Entscheidung, keine berechenbare Wahrheit — gemessen
 * weicht unsere Notenzahl um -15 % bis +5 % von der Referenz ab. Eine
 * positionale Paarung wuerde ab der ersten Abweichung verschiedene Woerter
 * vergleichen und der Fehler waechst ueber den Song.
 *
 * Tonhoehe wird bewusst getrennt von der Zeitmessung ausgewertet: eine
 * Melodie, die durchgehend um Halbtoene verschoben ist, haette sonst
 * fehlerfreie Timing-Kennzahlen und waere trotzdem unsingbar. Das ist
 * derselbe blinde Fleck, der die Beat-Konvention beinahe falsch
 * festgeschrieben haette (siehe format.ts). medianPitchOffset prueft eine
 * konstante Transposition — also eine falsche MIDI_NULLAGE in notes.py —,
 * anteilPitchExakt den Rest nach Abzug dieses Versatzes: echte Formfehler
 * der Melodie statt einer blossen Konstante.
 */
export const compareToReference = (unser: ReferenceSong, referenz: ReferenceSong): Metrics => {
  const paarungen = paareSilben(unser, referenz);
  const abweichungen: number[] = [];
  const versatz: number[] = [];
  const pitchDiffs: number[] = [];
  for (const [i, j] of paarungen) {
    const differenz = (unser.syllables[i]?.onsetMs ?? 0) - (referenz.syllables[j]?.onsetMs ?? 0);
    abweichungen.push(Math.abs(differenz));
    versatz.push(differenz);
    pitchDiffs.push((unser.syllables[i]?.pitch ?? 0) - (referenz.syllables[j]?.pitch ?? 0));
  }

  const anteil = (grenze: number): number =>
    abweichungen.length === 0
      ? 0
      : abweichungen.filter((d) => d < grenze).length / abweichungen.length;

  const medianPitchOffset = quantil(pitchDiffs, 0.5);
  const anteilPitchExakt =
    pitchDiffs.length === 0
      ? 0
      : pitchDiffs.filter((d) => d - medianPitchOffset === 0).length / pitchDiffs.length;

  // Zehn Abschnitte fester Laenge statt fester Silbenzahl: das Profil bleibt
  // zwischen Songs vergleichbar, unabhaengig von der jeweiligen Silbenzahl.
  // mittel() liefert fuer einen leeren Abschnitt 0 statt NaN, damit die
  // Laenge auch bei weniger als zehn Paaren stets zehn betraegt.
  const mittel = (a: number[]): number =>
    a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length;
  const breite = versatz.length / 10;
  const driftProfil = Array.from({ length: 10 }, (_, k) =>
    mittel(versatz.slice(Math.floor(k * breite), Math.floor((k + 1) * breite))),
  );

  const medianVersatzMs = quantil(versatz, 0.5);
  const anteilUnter50msKalibriert =
    versatz.length === 0
      ? 0
      : versatz.filter((v) => Math.abs(v - medianVersatzMs) < 50).length / versatz.length;
  const anteilUnter100msKalibriert =
    versatz.length === 0
      ? 0
      : versatz.filter((v) => Math.abs(v - medianVersatzMs) < 100).length / versatz.length;

  return {
    paare: paarungen.length,
    medianAbweichungMs: quantil(abweichungen, 0.5),
    p90AbweichungMs: quantil(abweichungen, 0.9),
    anteilUnter50ms: anteil(50),
    anteilUnter100ms: anteil(100),
    notenzahlDifferenz: unser.syllables.length - referenz.syllables.length,
    medianPitchOffset,
    anteilPitchExakt,
    medianVersatzMs,
    driftProfil,
    anteilGepaart:
      referenz.syllables.length === 0 ? 0 : paarungen.length / referenz.syllables.length,
    anteilUnter50msKalibriert,
    anteilUnter100msKalibriert,
  };
};
