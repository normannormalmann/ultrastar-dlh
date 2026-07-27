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

/**
 * Vergleicht unsere Ausgabe gegen eine von Menschen gesyncte Referenz.
 * Verglichen wird paarweise nach Position: weil die Lyrics aus der
 * Referenz selbst stammen, stimmen die Silbenfolgen 1:1 ueberein.
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
  const anzahl = Math.min(unser.syllables.length, referenz.syllables.length);
  const abweichungen: number[] = [];
  const pitchDiffs: number[] = [];
  for (let i = 0; i < anzahl; i++) {
    abweichungen.push(
      Math.abs((unser.syllables[i]?.onsetMs ?? 0) - (referenz.syllables[i]?.onsetMs ?? 0)),
    );
    pitchDiffs.push((unser.syllables[i]?.pitch ?? 0) - (referenz.syllables[i]?.pitch ?? 0));
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

  return {
    paare: anzahl,
    medianAbweichungMs: quantil(abweichungen, 0.5),
    p90AbweichungMs: quantil(abweichungen, 0.9),
    anteilUnter50ms: anteil(50),
    anteilUnter100ms: anteil(100),
    notenzahlDifferenz: unser.syllables.length - referenz.syllables.length,
    medianPitchOffset,
    anteilPitchExakt,
  };
};
