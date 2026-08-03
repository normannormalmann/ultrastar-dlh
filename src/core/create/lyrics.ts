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

export type Antwort =
  | { kind: "repeat_scope"; zeilenIndex: number; wahl: "zeile" | "block" }
  | {
      kind: "chorus_reference";
      zeilenIndex: number;
      wahl: "einsetzen" | "verwerfen";
    };

type Durchlauf = {
  behalten: Eintrag[];
  entfernt: string[];
  offeneFragen: OffeneFrage[];
};

/**
 * One walk over the raw lines, two modes. With `antworten === null` it only
 * reports ambiguities; with a list it applies them. A single function on
 * purpose: two walks would be two truths about which lines survive, and the
 * wizard's preview has to match what the pipeline receives.
 */
const durchlauf = (raw: string, antworten: Antwort[] | null): Durchlauf => {
  const entfernt: string[] = [];
  const offeneFragen: OffeneFrage[] = [];

  const zeilen = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((z) => z.replace(LRC, "").trim());

  const behalten: Eintrag[] = [];
  const antwortFuer = (i: number): Antwort | undefined =>
    antworten?.find((a) => a.zeilenIndex === i);

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
      if (
        IST_REFRAIN.test(marker[1]) &&
        (folgt.length === 0 || folgtIstMarker)
      ) {
        const vorlage = refrainBlock(behalten);
        if (antworten === null) {
          offeneFragen.push({
            kind: "chorus_reference",
            zeilenIndex: i,
            refrainZeilen: vorlage,
          });
        } else {
          const a = antwortFuer(i);
          if (a === undefined || a.kind !== "chorus_reference") {
            throw new Error(`Unbeantwortete Frage in Zeile ${i}.`);
          }
          if (a.wahl === "einsetzen") {
            if (vorlage.length === 0) {
              throw new Error(
                `Kein Refrain vor Zeile ${i} - nichts einzusetzen.`,
              );
            }
            for (const z of vorlage) behalten.push({ text: z, leer: false });
          }
        }
      }
      entfernt.push(zeile);
      continue;
    }

    const wdh = WIEDERHOLUNG.exec(zeile);
    if (wdh) {
      const sauber = zeile.replace(WIEDERHOLUNG, "").trim();
      behalten.push({ text: sauber, leer: false });
      if (antworten === null) {
        offeneFragen.push({
          kind: "repeat_scope",
          marker: wdh[0].trim(),
          zeilenIndex: i,
          blockZeilen: aktuellerBlock(behalten),
        });
      } else {
        const a = antwortFuer(i);
        if (a === undefined || a.kind !== "repeat_scope") {
          throw new Error(`Unbeantwortete Frage in Zeile ${i}.`);
        }
        const zuDoppeln =
          a.wahl === "block" ? aktuellerBlock(behalten) : [sauber];
        for (const z of zuDoppeln) behalten.push({ text: z, leer: false });
      }
      continue;
    }

    behalten.push({ text: zeile, leer: false });
  }

  return { behalten, entfernt, offeneFragen };
};

const nurZeilen = (behalten: Eintrag[]): string[] =>
  behalten.filter((e) => !e.leer).map((e) => e.text);

/**
 * Bereitet rohen Liedtext auf. Entfernt, was nie gesungen wird, und meldet
 * Mehrdeutigkeiten als offene Fragen — entscheidet sie aber nicht:
 * kopflos ist niemand zu fragen, das erledigt spaeter die UI.
 */
export const normalizeLyrics = (raw: string): NormalizedLyrics => {
  const { behalten, entfernt, offeneFragen } = durchlauf(raw, null);
  return { lines: nurZeilen(behalten), entfernt, offeneFragen };
};

/**
 * Applies the answers the UI collected for normalizeLyrics's open questions.
 * Throws on an unanswered one rather than guessing - guessing is exactly what
 * the open-question mechanism exists to prevent.
 */
export const resolveLyrics = (raw: string, antworten: Antwort[]): string[] =>
  nurZeilen(durchlauf(raw, antworten).behalten);
