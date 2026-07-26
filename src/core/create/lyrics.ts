// src/core/create/lyrics.ts

export type OffeneFrage =
  | { kind: "repeat_scope"; marker: string; zeilenIndex: number; blockZeilen: string[] }
  | { kind: "chorus_reference"; zeilenIndex: number; refrainZeilen: string[] };

export type NormalizedLyrics = {
  lines: string[];
  entfernt: string[];
  offeneFragen: OffeneFrage[];
};

type Eintrag = { text: string; leer: boolean };

const LRC = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g;
const WIEDERHOLUNG = /\s*\((?:2x|x2)\)\s*$|\s+2x\s*$/i;
const KLAMMER_MARKER = /^\[([^\]]+)\]$/;
const IST_REFRAIN = /^(chorus|refrain)$/i;

/** Zeilen des laufenden Blocks, ruecklaeufig bis zur letzten Leerzeile. */
const aktuellerBlock = (behalten: Eintrag[]): string[] => {
  const block: string[] = [];
  for (let i = behalten.length - 1; i >= 0; i--) {
    const e = behalten[i];
    if (!e || e.leer) break;
    block.unshift(e.text);
  }
  return block;
};

/** Erster zusammenhaengender Block — Kandidat fuer den Refrain. */
const refrainBlock = (behalten: Eintrag[]): string[] => {
  const block: string[] = [];
  for (const e of behalten) {
    if (e.leer) {
      if (block.length > 0) break;
      continue;
    }
    block.push(e.text);
  }
  return block;
};

/**
 * Bereitet rohen Liedtext auf. Entfernt, was nie gesungen wird, und meldet
 * Mehrdeutigkeiten als offene Fragen — entscheidet sie aber nicht:
 * kopflos ist niemand zu fragen, das erledigt spaeter die UI.
 */
export const normalizeLyrics = (raw: string): NormalizedLyrics => {
  const entfernt: string[] = [];
  const offeneFragen: OffeneFrage[] = [];

  // Zeitstempel weg, Zeilen normalisieren. Leerzeilen bleiben erhalten:
  // sie sind Blockgrenze und damit Struktur, nicht Muell.
  const zeilen = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((z) => z.replace(LRC, "").trim());

  const behalten: Eintrag[] = [];

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i] ?? "";
    if (zeile.length === 0) {
      behalten.push({ text: "", leer: true });
      continue;
    }

    const marker = KLAMMER_MARKER.exec(zeile);
    if (marker?.[1]) {
      const folgt = zeilen.slice(i + 1).find((z) => z.length > 0) ?? "";
      const folgtIstMarker = KLAMMER_MARKER.test(folgt);
      if (IST_REFRAIN.test(marker[1]) && (folgt.length === 0 || folgtIstMarker)) {
        // Alleinstehender Refrain-Verweis: frueheren Refrainblock anbieten.
        offeneFragen.push({
          kind: "chorus_reference",
          zeilenIndex: i,
          refrainZeilen: refrainBlock(behalten),
        });
      }
      entfernt.push(zeile);
      continue;
    }

    const wdh = WIEDERHOLUNG.exec(zeile);
    if (wdh) {
      behalten.push({ text: zeile.replace(WIEDERHOLUNG, "").trim(), leer: false });
      offeneFragen.push({
        kind: "repeat_scope",
        marker: wdh[0].trim(),
        zeilenIndex: i,
        blockZeilen: aktuellerBlock(behalten),
      });
      continue;
    }

    behalten.push({ text: zeile, leer: false });
  }

  return {
    lines: behalten.filter((e) => !e.leer).map((e) => e.text),
    entfernt,
    offeneFragen,
  };
};
