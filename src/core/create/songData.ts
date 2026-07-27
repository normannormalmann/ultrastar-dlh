// src/core/create/songData.ts

export const SCHEMA_VERSION = 1;

export type Note = {
  beat: number;
  length: number;
  pitch: number;
  syllable: string;
  confidence?: number;
};

export type LineBreak = { afterNoteIndex: number; beat: number };

export type SongDataMeta = {
  durationSec: number;
  device: string;
  stageVersions: Record<string, string>;
  warnings: string[];
  confidence?: { median: number; unsureRatio: number; largestGapSec: number };
  lowConfidence: boolean;
};

export type SongData = {
  schemaVersion: number;
  bpm: number;
  gap: number;
  language: string;
  notes: Note[];
  lineBreaks: LineBreak[];
  meta: SongDataMeta;
};

const istObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const zahl = (v: unknown, feld: string): number => {
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new Error(`songData: ${feld} muss eine Zahl sein`);
  }
  return v;
};

const text = (v: unknown, feld: string): string => {
  if (typeof v !== "string") throw new Error(`songData: ${feld} muss ein String sein`);
  return v;
};

/**
 * Wie text(), aber fuer Silben: ein Zeilenumbruch in der Silbe wuerde die
 * .txt-Zeilenstruktur zerreissen, sobald writeSongTxt.ts sie verbatim
 * ausschreibt — hier abbrechen ist billiger als das dort zu entdecken.
 */
const silbentext = (v: unknown, feld: string): string => {
  const wert = text(v, feld);
  if (/[\r\n]/.test(wert)) {
    throw new Error(`songData: ${feld} darf keinen Zeilenumbruch enthalten`);
  }
  return wert;
};

/**
 * Handgeschriebene Validierung — das Projekt nutzt bewusst kein zod und
 * kein Schema. Bricht beim ersten Verstoss ab, statt teilweise zu parsen.
 */
export const parseSongData = (input: unknown): SongData => {
  if (!istObjekt(input)) throw new Error("songData: Objekt erwartet");

  const version = zahl(input.schemaVersion, "schemaVersion");
  if (version !== SCHEMA_VERSION) {
    throw new Error(`songData: unbekannte schemaVersion ${version}, erwartet ${SCHEMA_VERSION}`);
  }

  if (!Array.isArray(input.notes) || input.notes.length === 0) {
    throw new Error("songData: notes muss ein nicht-leeres Array sein");
  }

  const notes: Note[] = input.notes.map((n, i) => {
    if (!istObjekt(n)) throw new Error(`songData: notes[${i}] muss ein Objekt sein`);
    const note: Note = {
      beat: zahl(n.beat, `notes[${i}].beat`),
      length: zahl(n.length, `notes[${i}].length`),
      pitch: zahl(n.pitch, `notes[${i}].pitch`),
      syllable: silbentext(n.syllable, `notes[${i}].syllable`),
    };
    if (n.confidence !== undefined) {
      note.confidence = zahl(n.confidence, `notes[${i}].confidence`);
    }
    return note;
  });

  if (!Array.isArray(input.lineBreaks)) {
    throw new Error("songData: lineBreaks muss ein Array sein");
  }
  const lineBreaks: LineBreak[] = input.lineBreaks.map((b, i) => {
    if (!istObjekt(b)) throw new Error(`songData: lineBreaks[${i}] muss ein Objekt sein`);
    return {
      afterNoteIndex: zahl(b.afterNoteIndex, `lineBreaks[${i}].afterNoteIndex`),
      beat: zahl(b.beat, `lineBreaks[${i}].beat`),
    };
  });

  const rohMeta = istObjekt(input.meta) ? input.meta : {};
  const meta: SongDataMeta = {
    durationSec: typeof rohMeta.durationSec === "number" ? rohMeta.durationSec : 0,
    device: typeof rohMeta.device === "string" ? rohMeta.device : "unbekannt",
    stageVersions: istObjekt(rohMeta.stageVersions)
      ? Object.fromEntries(
          Object.entries(rohMeta.stageVersions).map(([k, v]) => [k, String(v)]),
        )
      : {},
    warnings: Array.isArray(rohMeta.warnings) ? rohMeta.warnings.map(String) : [],
    lowConfidence: rohMeta.lowConfidence === true,
  };
  if (istObjekt(rohMeta.confidence)) {
    meta.confidence = {
      median: zahl(rohMeta.confidence.median, "meta.confidence.median"),
      unsureRatio: zahl(rohMeta.confidence.unsureRatio, "meta.confidence.unsureRatio"),
      largestGapSec: zahl(rohMeta.confidence.largestGapSec, "meta.confidence.largestGapSec"),
    };
  }

  return {
    schemaVersion: version,
    bpm: zahl(input.bpm, "bpm"),
    gap: zahl(input.gap, "gap"),
    language: text(input.language, "language"),
    notes,
    lineBreaks,
    meta,
  };
};
