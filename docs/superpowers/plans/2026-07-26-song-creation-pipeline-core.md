# Song Creation Pipeline Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus einer lokalen Audiodatei plus Liedtext ein `song_data.json` und ein spielbares `song.txt` erzeugen — kopflos, ohne UI.

**Architecture:** Zwei Prozesse mit scharfer Grenze. Python (`python-sidecar/`) macht alles Modellgestützte und gibt ausschließlich JSON aus; es kennt das UltraStar-Format nicht. TypeScript (`src/core/create/`) startet den Prozess, liest Fortschritt, validiert JSON, serialisiert das `.txt` und misst die Qualität; es kennt keine Modelle. Die Module, in denen die Sync-Qualität entschieden wird (`notes.py`, `writeSongTxt.ts`, `lyrics.ts`, `evaluate.ts`), sind rein und ohne GPU in Millisekunden testbar.

**Tech Stack:** Bun + TypeScript + Effect (bestehend) · Python 3.12 mit Demucs, WhisperX, SwiftF0, librosa, pyphen · pytest · bun:test

**Spec:** `docs/superpowers/specs/2026-07-26-song-creation-pipeline-core-design.md`

## Global Constraints

- **Kommentare auf Deutsch.** Der Bestand macht das durchgängig (siehe `desktop/main/binaries.ts`).
- **Keine neue Validierungsbibliothek.** Das Projekt nutzt ausschließlich `import { Effect } from "effect"` — kein Schema, kein zod. Validierung wird handgeschrieben.
- **Tests liegen neben dem Code** als `foo.test.ts` (bestehende Konvention in `src/core/`).
- **`schemaVersion` ist `1`** für die gesamte Umsetzung.
- **Marker-Präfixe sind exakt** `@@PROGRESS ` und `@@ERROR ` (jeweils mit einem Leerzeichen), gefolgt von einer Zeile JSON.
- **Kein automatisches CPU-Ausweichen** bei GPU-OOM. Harter Abbruch mit Hinweis auf `--device cpu`.
- **Kein Audio und keine Referenz-`.txt` im Repo.** Urheberrecht. Nur Manifest plus ignoriertes lokales Cache-Verzeichnis.
- **Reine Module dürfen keine Modelle importieren.** `notes.py` und `syllables.py` importieren nicht `torch`, `demucs`, `whisperx` oder `librosa` auf Modulebene. Task 7 sichert das per Test ab.
- **Übersprungene Tests müssen sichtbar sein.** Ein Lauf ohne GPU darf nicht als „alles grün" erscheinen — pytest läuft mit `-ra`.
- **`--device auto`** wählt CUDA, wenn verfügbar, sonst CPU mit Warnung.

---

### Task 1: Beat-Konvention messen und Zeitumrechnung festschreiben

Muss zuerst kommen: ohne die gemessene Beat-Einheit ist `notes.py` (Task 7) nicht sinnvoll baubar. Die Umrechnungsfunktionen sind rein und algebraisch testbar, **ohne** dass der Messwert bekannt ist — der Faktor wird von der Messung geliefert und dann als Konstante eingetragen.

**Files:**
- Create: `src/core/create/format.ts`
- Test: `src/core/create/format.test.ts`
- Create: `scripts/measure-beat-convention.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `beatToMs(beat: number, bpm: number, gapMs: number): number`, `msToBeat(ms: number, bpm: number, gapMs: number): number`, `BEATS_PER_BPM_UNIT: number`. Task 4 und Task 12 verwenden diese.

- [ ] **Step 1: Write the failing test**

Die Tests prüfen algebraische Eigenschaften, die für **jeden** Faktor gelten — deshalb sind sie schon vor der Messung schreibbar.

```ts
// src/core/create/format.test.ts
import { describe, expect, it } from "bun:test";
import { BEATS_PER_BPM_UNIT, beatToMs, msToBeat } from "./format.ts";

describe("beatToMs / msToBeat", () => {
  it("verankert Beat 0 auf dem GAP", () => {
    expect(beatToMs(0, 300, 1200)).toBe(1200);
  });

  it("ist invertierbar", () => {
    for (const beat of [0, 1, 7, 64, 999]) {
      expect(msToBeat(beatToMs(beat, 294.5, 800), 294.5, 800)).toBeCloseTo(beat, 6);
    }
  });

  it("waechst streng monoton mit dem Beat", () => {
    expect(beatToMs(10, 300, 0)).toBeGreaterThan(beatToMs(9, 300, 0));
  });

  it("halbiert die Beatdauer bei doppeltem BPM", () => {
    const langsam = beatToMs(8, 150, 0);
    const schnell = beatToMs(8, 300, 0);
    expect(schnell).toBeCloseTo(langsam / 2, 6);
  });

  it("hat einen dokumentierten, positiven ganzzahligen Faktor", () => {
    expect(Number.isInteger(BEATS_PER_BPM_UNIT)).toBe(true);
    expect(BEATS_PER_BPM_UNIT).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/format.test.ts`
Expected: FAIL — `Cannot find module './format.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/create/format.ts

/**
 * Beats pro BPM-Einheit im UltraStar-Format.
 * ACHTUNG: Dieser Wert ist gemessen, nicht aus Doku abgeleitet — siehe
 * scripts/measure-beat-convention.ts und den Nachtrag im Design-Dokument.
 * Vorbelegung 4; Step 6 ersetzt sie durch den gemessenen Wert.
 */
export const BEATS_PER_BPM_UNIT = 4;

/** Millisekunden pro Beat bei gegebenem BPM. */
const msPerBeat = (bpm: number): number => 60_000 / (bpm * BEATS_PER_BPM_UNIT);

/** Beatposition -> absolute Zeit in ms, gemessen ab Songanfang. */
export const beatToMs = (beat: number, bpm: number, gapMs: number): number =>
  gapMs + beat * msPerBeat(bpm);

/** Absolute Zeit in ms -> Beatposition. Umkehrung von beatToMs. */
export const msToBeat = (ms: number, bpm: number, gapMs: number): number =>
  (ms - gapMs) / msPerBeat(bpm);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/format.test.ts`
Expected: PASS, 5 Tests

- [ ] **Step 5: Write the measurement script**

Das Skript prüft die Vorbelegung gegen echte Referenzdateien. Es liest lokal vorhandene Songs — nichts davon wird committet.

```ts
// scripts/measure-beat-convention.ts
// Prueft BEATS_PER_BPM_UNIT gegen echte, von Menschen gesyncte .txt-Dateien.
// Aufruf: bun run scripts/measure-beat-convention.ts <songs-verzeichnis>
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BEATS_PER_BPM_UNIT, beatToMs } from "../src/core/create/format.ts";

type Befund = { datei: string; verhaeltnis: number };

/** #BPM lesen; deutsche Dateien nutzen Komma als Dezimaltrenner. */
const leseBpm = (txt: string): number | null => {
  const m = /^#BPM:(.*)$/m.exec(txt);
  if (!m?.[1]) return null;
  const wert = Number.parseFloat(m[1].trim().replace(",", "."));
  return Number.isNaN(wert) ? null : wert;
};

const leseGap = (txt: string): number => {
  const m = /^#GAP:(.*)$/m.exec(txt);
  const wert = Number.parseFloat((m?.[1] ?? "0").trim().replace(",", "."));
  return Number.isNaN(wert) ? 0 : wert;
};

/** Groesster Beat plus Laenge aus allen Notenzeilen. */
const letzterBeat = (txt: string): number | null => {
  let max: number | null = null;
  for (const zeile of txt.split("\n")) {
    const m = /^[:*FR]\s+(-?\d+)\s+(\d+)\s+(-?\d+)/.exec(zeile.trim());
    if (!m?.[1] || !m[2]) continue;
    const ende = Number.parseInt(m[1], 10) + Number.parseInt(m[2], 10);
    if (max === null || ende > max) max = ende;
  }
  return max;
};

/** Mediendatei aus dem #MP3-Header; die Bibliothek nutzt oft video.mp4. */
const leseMedium = (txt: string): string | null => {
  const m = /^#MP3:(.*)$/m.exec(txt);
  const name = m?.[1]?.trim();
  return name && name.length > 0 ? name : null;
};

/** Laufzeit der Mediendatei in Sekunden, ueber ffprobe. */
const audioDauer = (pfad: string): number | null => {
  const p = Bun.spawnSync([
    "ffprobe", "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0", pfad,
  ]);
  if (p.exitCode !== 0) return null;
  const wert = Number.parseFloat(new TextDecoder().decode(p.stdout).trim());
  return Number.isNaN(wert) || wert <= 0 ? null : wert;
};

// Fenster fuer das Verhaeltnis Songende/Audiodauer. Zweiseitig, und das ist
// entscheidend: eine reine Obergrenze laesst auch Faktor 8 durch, bei dem
// der Song nach der halben Datei enden wuerde.
const MIN_VERHAELTNIS = 0.6;
const MAX_VERHAELTNIS = 1.05;

const main = async (): Promise<void> => {
  const wurzel = process.argv[2];
  const grenze = Number.parseInt(process.argv[3] ?? "40", 10);
  if (!wurzel) {
    console.error(
      "Aufruf: bun run scripts/measure-beat-convention.ts <songs-verzeichnis> [anzahl]",
    );
    process.exit(2);
  }

  const befunde: Befund[] = [];
  for (const eintrag of await readdir(wurzel, { withFileTypes: true })) {
    if (befunde.length >= grenze) break;
    if (!eintrag.isDirectory()) continue;
    const txtPfad = join(wurzel, eintrag.name, "song.txt");
    try {
      if (!(await stat(txtPfad)).isFile()) continue;
    } catch {
      continue;
    }
    const txt = await readFile(txtPfad, "utf8");
    const bpm = leseBpm(txt);
    const beat = letzterBeat(txt);
    const medium = leseMedium(txt);
    if (bpm === null || beat === null || medium === null) continue;

    const dauer = audioDauer(join(wurzel, eintrag.name, medium));
    if (dauer === null) continue;

    const endeSek = beatToMs(beat, bpm, leseGap(txt)) / 1000;
    befunde.push({ datei: eintrag.name, verhaeltnis: endeSek / dauer });
  }

  if (befunde.length === 0) {
    console.error("Keine auswertbaren Songs mit Mediendatei gefunden.");
    process.exit(1);
  }

  const werte = befunde.map((b) => b.verhaeltnis).sort((a, b) => a - b);
  const median = werte[Math.floor(werte.length / 2)] ?? 0;
  const imFenster = werte.filter(
    (v) => v >= MIN_VERHAELTNIS && v <= MAX_VERHAELTNIS,
  ).length;

  console.log(`Songs mit Audiodauer:  ${befunde.length}`);
  console.log(`BEATS_PER_BPM_UNIT:    ${BEATS_PER_BPM_UNIT}`);
  console.log(`Median Songende/Audio: ${median.toFixed(3)}`);
  console.log(
    `Im Fenster ${MIN_VERHAELTNIS}-${MAX_VERHAELTNIS}:  ${imFenster}/${befunde.length}`,
  );
  console.log("");
  console.log(
    imFenster / befunde.length >= 0.9
      ? "OK: Faktor ist konsistent mit dem Referenzkorpus."
      : "FEHLER: Faktor passt nicht. Mit 1, 2, 8 gegenpruefen.",
  );
};

await main();
```

**Das Verfahren ist bewusst so gewählt.** Ein Vergleich gegen ein reines Plausibilitätsfenster für die Songlänge (etwa 1–12 Minuten) unterscheidet Faktor 2 und 4 **nicht** — beide liefern plausible Längen. Erst der Bezug auf die echte Laufzeit der Mediendatei trennt sie, und nur mit **zweiseitiger** Grenze: Faktor 8 hält jede Obergrenze ein, würde den Song aber nach der halben Datei enden lassen.

- [ ] **Step 6: Messung ausführen und Faktor bestätigen**

Run: `bun run scripts/measure-beat-convention.ts "J:/Ultrastar" 40`

**Erwartetes Ergebnis:** `Median Songende/Audio` bei etwa **0,92** und **36/40** im Fenster. Der Faktor **4** ist bereits vorab über 40 Songs dieser Bibliothek belegt worden; dieser Schritt reproduziert die Messung, er sucht sie nicht. Die Vergleichswerte aus dem Vorablauf, gezählt mit dem **zweiseitigen** Fenster 0,6–1,05, das das Skript umsetzt:

| Faktor | Median Songende/Audio | im Fenster |
|---|---|---|
| 1 | 3,407 | 2/40 |
| 2 | 1,742 | 1/40 |
| **4** | **0,919** | **36/40** |
| 8 | 0,490 | 0/40 |

Die vier Songs, die bei Faktor 4 aus dem Fenster fallen, liegen mit Verhältnissen von 0,18 bis 0,37 deutlich darunter — Stücke mit langem Instrumentalteil, bei denen der Gesang lange vor dem Dateiende endet. Erwartet, kein Mangel: die Aussage trägt der Median.

Weicht das Ergebnis davon ab, **nicht** stillschweigend einen anderen Faktor eintragen, sondern melden — dann stimmt etwas an der Umrechnung nicht. `BEATS_PER_BPM_UNIT` bleibt bei 4; nur der Kommentar in `format.ts` wird auf den reproduzierten Befund aktualisiert (Anzahl Songs, Median, Datum).

- [ ] **Step 7: Befund als Nachtrag ins Design-Dokument**

An `docs/superpowers/specs/2026-07-26-song-creation-pipeline-core-design.md` anhängen — so wie es der Genre-Spec mit seinem Volllauf-Befund vormacht:

```markdown
## Nachtrag: Gemessene Beat-Konvention (2026-07-26)

`BEATS_PER_BPM_UNIT = <wert>`, gemessen über <n> Songs der lokalen Bibliothek.
Median-Songende <x> min, <p>/<n> im plausiblen Bereich 1–12 min.
Ermittelt mit `scripts/measure-beat-convention.ts`.
```

- [ ] **Step 8: Run all tests and commit**

Run: `bun test src/core/create/`
Expected: PASS

```bash
git add src/core/create/format.ts src/core/create/format.test.ts scripts/measure-beat-convention.ts docs/superpowers/specs/2026-07-26-song-creation-pipeline-core-design.md
git commit -m "feat(create): measured UltraStar beat convention and time conversion"
```

---

### Task 2: Textaufbereitung `lyrics.ts`

Rein, ohne Modelle. Meldet mehrdeutige Marker als offene Fragen statt sie zu entscheiden.

**Files:**
- Create: `src/core/create/lyrics.ts`
- Test: `src/core/create/lyrics.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `normalizeLyrics(raw: string): NormalizedLyrics` mit `type NormalizedLyrics = { lines: string[]; entfernt: string[]; offeneFragen: OffeneFrage[] }` und `type OffeneFrage = { kind: "repeat_scope"; marker: string; zeilenIndex: number; blockZeilen: string[] } | { kind: "chorus_reference"; zeilenIndex: number; refrainZeilen: string[] }`.
- **Kein Task in diesem Plan ruft `normalizeLyrics` auf.** Der eigentliche Aufrufer ist die UI in Teilprojekt 5, die die offenen Fragen beantwortet. Innerhalb von Teilprojekt 1 ist das Modul die Referenzimplementierung, gegen die Task 9 nur noch grob prüft: die CLI lehnt unaufgelösten Text ab (`lyrics_unresolved`), sie bereitet ihn nicht auf. Der Harness in Task 12 baut seine Zeilen direkt aus dem Referenz-`.txt` und braucht die Aufbereitung deshalb nicht.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/create/lyrics.test.ts
import { describe, expect, it } from "bun:test";
import { normalizeLyrics } from "./lyrics.ts";

describe("normalizeLyrics", () => {
  it("entfernt lrc-Zeitstempel", () => {
    const r = normalizeLyrics("[00:12.34]Hallo Welt");
    expect(r.lines).toEqual(["Hallo Welt"]);
    expect(r.offeneFragen).toEqual([]);
  });

  it("entfernt Ueberschriften mit folgendem Text", () => {
    const r = normalizeLyrics("[Verse 1]\nZeile eins\nZeile zwei");
    expect(r.lines).toEqual(["Zeile eins", "Zeile zwei"]);
    expect(r.entfernt).toContain("[Verse 1]");
    expect(r.offeneFragen).toEqual([]);
  });

  it("fragt bei alleinstehendem [Chorus] mit frueherem Refrain", () => {
    const r = normalizeLyrics("[Chorus]\nRefrain hier\n\nStrophe\n\n[Chorus]");
    expect(r.offeneFragen).toHaveLength(1);
    const frage = r.offeneFragen[0];
    expect(frage?.kind).toBe("chorus_reference");
    if (frage?.kind === "chorus_reference") {
      expect(frage.refrainZeilen).toEqual(["Refrain hier"]);
    }
  });

  it("fragt bei (2x) nach Zeile oder Block", () => {
    const r = normalizeLyrics("Erste Zeile\nZweite Zeile (2x)");
    expect(r.offeneFragen).toHaveLength(1);
    const frage = r.offeneFragen[0];
    expect(frage?.kind).toBe("repeat_scope");
    if (frage?.kind === "repeat_scope") {
      expect(frage.marker).toBe("(2x)");
      expect(frage.blockZeilen).toEqual(["Erste Zeile", "Zweite Zeile"]);
    }
  });

  it("erkennt auch (x2) und blankes 2x", () => {
    expect(normalizeLyrics("Zeile (x2)").offeneFragen).toHaveLength(1);
    expect(normalizeLyrics("Zeile 2x").offeneFragen).toHaveLength(1);
  });

  it("behaelt Leerzeilen als Blockgrenze bis zur Aufloesung", () => {
    const r = normalizeLyrics("A\nB\n\nC (2x)");
    const frage = r.offeneFragen[0];
    if (frage?.kind === "repeat_scope") {
      // Nur der zweite Block, nicht der erste.
      expect(frage.blockZeilen).toEqual(["C"]);
    }
  });

  it("liefert bei sauberem Text keine offenen Fragen", () => {
    const r = normalizeLyrics("Eine Zeile\nZwei Zeile\n\nDrei Zeile");
    expect(r.lines).toEqual(["Eine Zeile", "Zwei Zeile", "Drei Zeile"]);
    expect(r.offeneFragen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/lyrics.test.ts`
Expected: FAIL — `Cannot find module './lyrics.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/lyrics.test.ts`
Expected: PASS, 7 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/create/lyrics.ts src/core/create/lyrics.test.ts
git commit -m "feat(create): lyrics normalization reports ambiguities instead of guessing"
```

---

### Task 3: Vertrag `songData.ts`

**Files:**
- Create: `src/core/create/songData.ts`
- Test: `src/core/create/songData.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `SCHEMA_VERSION = 1`, Typen `Note`, `LineBreak`, `SongDataMeta`, `SongData`, sowie `parseSongData(input: unknown): SongData` (wirft `Error` bei Verstoß; `notes` und `lineBreaks` sind Pflicht, `meta` tolerant mit Koerzierung). Task 4, 10, 11 verwenden `SongData`; Task 10 verwendet `parseSongData`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/create/songData.test.ts
import { describe, expect, it } from "bun:test";
import { parseSongData, SCHEMA_VERSION } from "./songData.ts";

const gueltig = {
  schemaVersion: 1,
  bpm: 294.5,
  gap: 1200,
  language: "de",
  notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal", confidence: 0.91 }],
  lineBreaks: [{ afterNoteIndex: 0, beat: 32 }],
  meta: {
    durationSec: 214.3,
    device: "cuda",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
};

describe("parseSongData", () => {
  it("nimmt gueltige Daten an", () => {
    const d = parseSongData(gueltig);
    expect(d.bpm).toBe(294.5);
    expect(d.notes[0]?.syllable).toBe("Hal");
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("lehnt unbekannte schemaVersion ab, ohne teilweise zu parsen", () => {
    expect(() => parseSongData({ ...gueltig, schemaVersion: 2 })).toThrow(/schemaVersion/);
  });

  it("lehnt fehlende Noten ab", () => {
    expect(() => parseSongData({ ...gueltig, notes: [] })).toThrow(/notes/);
  });

  it("lehnt nicht-numerischen Beat ab", () => {
    const kaputt = { ...gueltig, notes: [{ ...gueltig.notes[0], beat: "0" }] };
    expect(() => parseSongData(kaputt)).toThrow(/beat/);
  });

  it("lehnt Nicht-Objekte ab", () => {
    expect(() => parseSongData(null)).toThrow();
    expect(() => parseSongData("nope")).toThrow();
  });

  it("erlaubt fehlende optionale Konfidenz", () => {
    const ohne = { ...gueltig, notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal" }] };
    expect(parseSongData(ohne).notes[0]?.confidence).toBeUndefined();
  });

  it("lehnt fehlende lineBreaks ab", () => {
    const { lineBreaks, ...ohne } = gueltig;
    expect(() => parseSongData(ohne)).toThrow(/lineBreaks/);
  });

  it("lehnt nicht-Array lineBreaks ab, statt still auf [] zu fallen", () => {
    expect(() => parseSongData({ ...gueltig, lineBreaks: "nope" })).toThrow(/lineBreaks/);
  });

  it("erlaubt leere lineBreaks", () => {
    expect(parseSongData({ ...gueltig, lineBreaks: [] }).lineBreaks).toEqual([]);
  });

  it("koerziert stageVersions-Werte zu Strings", () => {
    const d = parseSongData({
      ...gueltig,
      meta: { ...gueltig.meta, stageVersions: { separate: 1 } },
    });
    expect(d.meta.stageVersions).toEqual({ separate: "1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/songData.test.ts`
Expected: FAIL — `Cannot find module './songData.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
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
      syllable: text(n.syllable, `notes[${i}].syllable`),
    };
    if (n.confidence !== undefined) {
      note.confidence = zahl(n.confidence, `notes[${i}].confidence`);
    }
    return note;
  });

  // lineBreaks ist Pflichtdatum, kein Diagnosefeld: ein stiller Rückfall auf
  // [] wuerde den ganzen Liedtext auf eine Zeile legen — unsingbar. Leer ist
  // erlaubt, fehlend oder falsch typisiert nicht.
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
    // Werte koerzieren statt casten: meta bleibt tolerant, aber der
    // deklarierte Typ Record<string, string> wird dadurch wahr. Ein blosser
    // Cast liesse {cuda: 123} als String durchgehen.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/songData.test.ts`
Expected: PASS, 6 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/create/songData.ts src/core/create/songData.test.ts
git commit -m "feat(create): versioned song data contract with hand-written validation"
```

---

### Task 4: Noten-Serialisierer `writeSongTxt.ts`

Neuland: der Bestand schreibt USDB-Text unverändert weg und patcht nur Header. Die Header-Konventionen (inklusive Komma-Dezimaltrenner bei `#BPM`) sind aus `repairSongs.ts` bekannt.

**Files:**
- Create: `src/core/create/writeSongTxt.ts`
- Test: `src/core/create/writeSongTxt.test.ts`

**Interfaces:**
- Consumes: `SongData` aus Task 3.
- Produces: `renderSongTxt(data: SongData, headers: TxtHeaderInput): string` mit `type TxtHeaderInput = { artist: string; title: string; mp3: string; language?: string; genre?: string; year?: number; cover?: string; video?: string; creator?: string }`. Task 11 und Task 12 verwenden es.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/create/writeSongTxt.test.ts
import { describe, expect, it } from "bun:test";
import type { SongData } from "./songData.ts";
import { renderSongTxt } from "./writeSongTxt.ts";

const daten: SongData = {
  schemaVersion: 1,
  bpm: 294.5,
  gap: 1200,
  language: "German",
  notes: [
    { beat: 0, length: 4, pitch: 5, syllable: "Hal" },
    { beat: 4, length: 4, pitch: 7, syllable: "lo" },
    { beat: 16, length: 8, pitch: 9, syllable: "Welt" },
  ],
  lineBreaks: [{ afterNoteIndex: 1, beat: 12 }],
  meta: {
    durationSec: 10,
    device: "cpu",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
};

const headers = { artist: "Testkuenstler", title: "Testlied", mp3: "Testlied.ogg" };

describe("renderSongTxt", () => {
  it("schreibt Pflicht-Header zuerst", () => {
    const zeilen = renderSongTxt(daten, headers).split("\n");
    expect(zeilen[0]).toBe("#TITLE:Testlied");
    expect(zeilen[1]).toBe("#ARTIST:Testkuenstler");
    expect(zeilen).toContain("#MP3:Testlied.ogg");
  });

  it("schreibt BPM mit Punkt und GAP als ganze Zahl", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).toContain("#BPM:294.5");
    expect(txt).toContain("#GAP:1200");
  });

  it("schreibt Notenzeilen als ': beat length pitch silbe'", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).toContain(": 0 4 5 Hal");
    expect(txt).toContain(": 4 4 7 lo");
  });

  it("setzt den Zeilenumbruch als '- beat' an der richtigen Stelle", () => {
    const zeilen = renderSongTxt(daten, headers).split("\n");
    const iLo = zeilen.indexOf(": 4 4 7 lo");
    const iWelt = zeilen.indexOf(": 16 8 9 Welt");
    const iBreak = zeilen.indexOf("- 12");
    expect(iBreak).toBeGreaterThan(iLo);
    expect(iBreak).toBeLessThan(iWelt);
  });

  it("endet mit E und Zeilenumbruch", () => {
    expect(renderSongTxt(daten, headers).endsWith("E\n")).toBe(true);
  });

  it("laesst optionale Header weg, wenn nicht gesetzt", () => {
    const txt = renderSongTxt(daten, headers);
    expect(txt).not.toContain("#GENRE:");
    expect(txt).not.toContain("#YEAR:");
  });

  it("schreibt optionale Header, wenn gesetzt", () => {
    const txt = renderSongTxt(daten, { ...headers, genre: "Pop", year: 1987, cover: "c.jpg" });
    expect(txt).toContain("#GENRE:Pop");
    expect(txt).toContain("#YEAR:1987");
    expect(txt).toContain("#COVER:c.jpg");
  });

  it("erzeugt eine vollstaendige, stabile Ausgabe", () => {
    expect(renderSongTxt(daten, headers)).toBe(
      [
        "#TITLE:Testlied",
        "#ARTIST:Testkuenstler",
        "#MP3:Testlied.ogg",
        "#LANGUAGE:German",
        "#BPM:294.5",
        "#GAP:1200",
        ": 0 4 5 Hal",
        ": 4 4 7 lo",
        "- 12",
        ": 16 8 9 Welt",
        "E",
        "",
      ].join("\n"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/writeSongTxt.test.ts`
Expected: FAIL — `Cannot find module './writeSongTxt.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/create/writeSongTxt.ts
import type { SongData } from "./songData.ts";

export type TxtHeaderInput = {
  artist: string;
  title: string;
  mp3: string;
  language?: string;
  genre?: string;
  year?: number;
  cover?: string;
  video?: string;
  creator?: string;
};

/**
 * Serialisiert SongData ins UltraStar-Format.
 * BPM wird bewusst mit Punkt geschrieben: repairSongs.ts liest zwar auch
 * Komma (deutsche Bestandsdateien), neu erzeugte Dateien sollen aber die
 * eindeutige Variante nutzen.
 */
export const renderSongTxt = (data: SongData, headers: TxtHeaderInput): string => {
  const zeilen: string[] = [
    `#TITLE:${headers.title}`,
    `#ARTIST:${headers.artist}`,
    `#MP3:${headers.mp3}`,
  ];

  const sprache = headers.language ?? data.language;
  if (sprache) zeilen.push(`#LANGUAGE:${sprache}`);
  if (headers.genre) zeilen.push(`#GENRE:${headers.genre}`);
  if (headers.year !== undefined) zeilen.push(`#YEAR:${headers.year}`);
  if (headers.cover) zeilen.push(`#COVER:${headers.cover}`);
  if (headers.video) zeilen.push(`#VIDEO:${headers.video}`);
  if (headers.creator) zeilen.push(`#CREATOR:${headers.creator}`);

  zeilen.push(`#BPM:${data.bpm}`);
  zeilen.push(`#GAP:${Math.round(data.gap)}`);

  // Umbrueche nach Notenindex vorgruppieren, damit sie in einem Durchlauf
  // an der richtigen Stelle eingefuegt werden koennen.
  const umbruchNach = new Map<number, number>();
  for (const b of data.lineBreaks) umbruchNach.set(b.afterNoteIndex, b.beat);

  data.notes.forEach((note, i) => {
    zeilen.push(
      `: ${Math.round(note.beat)} ${Math.round(note.length)} ${Math.round(note.pitch)} ${note.syllable}`,
    );
    const umbruch = umbruchNach.get(i);
    // Kein Umbruch nach der letzten Note: dort folgt direkt das E.
    if (umbruch !== undefined && i < data.notes.length - 1) {
      zeilen.push(`- ${Math.round(umbruch)}`);
    }
  });

  zeilen.push("E");
  return `${zeilen.join("\n")}\n`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/writeSongTxt.test.ts`
Expected: PASS, 8 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/create/writeSongTxt.ts src/core/create/writeSongTxt.test.ts
git commit -m "feat(create): UltraStar txt note serializer"
```

---

### Task 5: Python-Projekt und Kanäle

Legt das Sidecar-Paket an, den Fortschritts- und Fehlerkanal und den Test-Einstieg. Ohne Modell-Abhängigkeiten — die kommen erst in Task 9, damit Tasks 6–8 schnell testbar bleiben.

**Files:**
- Create: `python-sidecar/pyproject.toml`
- Create: `python-sidecar/ultrastar_pipeline/__init__.py`
- Create: `python-sidecar/ultrastar_pipeline/progress.py`
- Test: `python-sidecar/tests/test_progress.py`
- Modify: `package.json` (Skripte `test:py`, `test:py:slow`)

**Interfaces:**
- Consumes: nichts.
- Produces: `emit_progress(stage: str, percent: float) -> None`, `emit_error(kind: str, **felder) -> None`, Konstanten `PROGRESS_PREFIX = "@@PROGRESS "`, `ERROR_PREFIX = "@@ERROR "`. Tasks 6–9 verwenden diese.

- [ ] **Step 1: Write the failing test**

```python
# python-sidecar/tests/test_progress.py
import json

from ultrastar_pipeline.progress import (
    ERROR_PREFIX,
    PROGRESS_PREFIX,
    emit_error,
    emit_progress,
)


def test_progress_hat_marker_und_json(capsys):
    emit_progress("separate", 0.4)
    zeile = capsys.readouterr().out.strip()
    assert zeile.startswith(PROGRESS_PREFIX)
    assert json.loads(zeile[len(PROGRESS_PREFIX):]) == {"stage": "separate", "percent": 0.4}


def test_progress_begrenzt_auf_null_bis_eins(capsys):
    emit_progress("align", 1.7)
    zeile = capsys.readouterr().out.strip()
    assert json.loads(zeile[len(PROGRESS_PREFIX):])["percent"] == 1.0


def test_error_hat_marker_und_kind(capsys):
    emit_error("language_unsupported", language="is")
    zeile = capsys.readouterr().out.strip()
    assert zeile.startswith(ERROR_PREFIX)
    assert json.loads(zeile[len(ERROR_PREFIX):]) == {
        "kind": "language_unsupported",
        "language": "is",
    }


def test_json_ist_einzeilig(capsys):
    emit_error("alignment_failed", detail="mehrere\nZeilen")
    assert capsys.readouterr().out.count("\n") == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python-sidecar && python -m pytest tests/test_progress.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ultrastar_pipeline'`

- [ ] **Step 3: Write minimal implementation**

```toml
# python-sidecar/pyproject.toml
[project]
name = "ultrastar-pipeline"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[project.optional-dependencies]
# Modell-Abhaengigkeiten getrennt, damit reine Tests ohne sie laufen.
models = ["demucs", "whisperx", "swift-f0", "librosa", "torch", "torchaudio"]
dev = ["pytest", "pyphen"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: braucht Modelle oder GPU, standardmaessig uebersprungen"]
# -ra macht uebersprungene Tests im Bericht sichtbar: ein Lauf ohne GPU
# darf nicht wie "alles gruen" aussehen.
addopts = "-m 'not slow' -ra"
```

```python
# python-sidecar/ultrastar_pipeline/__init__.py
"""Kopfloser Pipeline-Kern: Audio + Liedtext -> song_data.json."""
```

```python
# python-sidecar/ultrastar_pipeline/progress.py
"""Fortschritts- und Fehlerkanal.

torch, Demucs und WhisperX schreiben reichlich eigenen Text, teils auf
stdout. Reines JSON-Lines waere damit nicht verlaesslich parsebar, deshalb
werden unsere Zeilen mit einem Marker praefigiert. TypeScript filtert
darauf, alles andere gilt als Log.
"""

import json
import sys
from typing import Any

PROGRESS_PREFIX = "@@PROGRESS "
ERROR_PREFIX = "@@ERROR "


def _schreibe(prefix: str, nutzlast: dict[str, Any]) -> None:
    # Kompaktes JSON ohne Zeilenumbruch: eine Meldung ist genau eine Zeile.
    zeile = json.dumps(nutzlast, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(f"{prefix}{zeile}\n")
    sys.stdout.flush()


def emit_progress(stage: str, percent: float) -> None:
    """Fortschritt einer Stufe melden. percent wird auf 0..1 begrenzt."""
    _schreibe(
        PROGRESS_PREFIX,
        {"stage": stage, "percent": min(1.0, max(0.0, float(percent)))},
    )


def emit_error(kind: str, **felder: Any) -> None:
    """Strukturierten Fehler melden, damit TS ihn typisiert abbilden kann."""
    _schreibe(ERROR_PREFIX, {"kind": kind, **felder})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python-sidecar && python -m pip install -e ".[dev]" && python -m pytest tests/ -v`
Expected: PASS, 4 Tests

- [ ] **Step 5: Add the Python test entry points**

In `package.json` bei den Skripten ergänzen — pytest wird von `bun test src` nicht erfasst und braucht einen eigenen Einstieg:

```json
"test:py": "cd python-sidecar && python -m pytest tests/ -v",
"test:py:slow": "cd python-sidecar && python -m pytest tests/ -v -m slow"
```

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/pyproject.toml python-sidecar/ultrastar_pipeline/__init__.py python-sidecar/ultrastar_pipeline/progress.py python-sidecar/tests/test_progress.py package.json
git commit -m "feat(sidecar): python package scaffold with marker-prefixed progress channel"
```

---

### Task 6: Silbentrennung und Tempo

Beide mit reinem Kern. `syllables.py` fällt auf ganze Wörter zurück, wenn kein pyphen-Wörterbuch existiert. Aus `tempo.py` entsteht hier nur die Halb/Doppel-Korrektur — der librosa-Aufruf kommt in Task 9.

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/syllables.py`
- Create: `python-sidecar/ultrastar_pipeline/tempo.py`
- Test: `python-sidecar/tests/test_syllables.py`
- Test: `python-sidecar/tests/test_tempo.py`

**Interfaces:**
- Consumes: nichts.
- Produces: `split_syllables(word: str, language: str) -> list[str]`, `has_dictionary(language: str) -> bool`, `korrigiere_tempo(bpm: float, min_bpm: float = 70.0, max_bpm: float = 180.0) -> float`. Task 7 verwendet `split_syllables`; Task 9 verwendet `korrigiere_tempo` und `has_dictionary`.

- [ ] **Step 1: Write the failing tests**

```python
# python-sidecar/tests/test_syllables.py
from ultrastar_pipeline.syllables import has_dictionary, split_syllables


def test_zerlegt_deutsches_wort():
    assert split_syllables("Hallo", "de") == ["Hal", "lo"]


def test_behaelt_kurzes_wort_ganz():
    assert split_syllables("Welt", "de") == ["Welt"]


def test_silben_ergeben_wieder_das_wort():
    for wort in ["Hallo", "Wiedersehen", "Liebe", "understanding"]:
        for sprache in ["de", "en"]:
            assert "".join(split_syllables(wort, sprache)) == wort


def test_faellt_bei_unbekannter_sprache_auf_ganzes_wort_zurueck():
    assert split_syllables("Hallo", "xx-nicht-existent") == ["Hallo"]
    assert has_dictionary("xx-nicht-existent") is False


def test_leeres_wort_ergibt_leere_liste():
    assert split_syllables("", "de") == []
```

```python
# python-sidecar/tests/test_tempo.py
import pytest

from ultrastar_pipeline.tempo import korrigiere_tempo


@pytest.mark.parametrize(
    "eingabe,erwartet",
    [
        (120.0, 120.0),  # schon im Zielbereich
        (60.0, 120.0),   # zu langsam -> verdoppeln
        (35.0, 70.0),    # eine Verdopplung erreicht die Untergrenze, dann Schluss
        (300.0, 150.0),  # zu schnell -> halbieren
        (600.0, 150.0),  # zweimal halbieren
        (200.0, 100.0),  # knapp ueber max -> halbieren
        (70.0, 70.0),    # genau auf der Untergrenze: unveraendert
        (180.0, 180.0),  # genau auf der Obergrenze: unveraendert
    ],
)
def test_korrigiert_halb_und_doppel(eingabe, erwartet):
    assert korrigiere_tempo(eingabe) == pytest.approx(erwartet)


def test_bricht_bei_unsinnigem_wert_nicht_endlos():
    assert korrigiere_tempo(0.0) == 0.0
    assert korrigiere_tempo(-5.0) == -5.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:py`
Expected: FAIL — `ModuleNotFoundError: No module named 'ultrastar_pipeline.syllables'`

- [ ] **Step 3: Write minimal implementation**

```python
# python-sidecar/ultrastar_pipeline/syllables.py
"""Silbentrennung mit Rueckfall.

Fehlt fuer eine Sprache das pyphen-Woerterbuch, wird das ganze Wort als
eine Silbe behandelt. Das ist schlechter singbar, aber immer noch
spielbar — und wird als Warnung nach meta gemeldet.
"""

from functools import lru_cache

try:  # pyphen ist optional, damit reine Tests ohne Modell-Extras laufen
    import pyphen
except ImportError:  # pragma: no cover
    pyphen = None  # type: ignore[assignment]


@lru_cache(maxsize=32)
def _woerterbuch(language: str):
    if pyphen is None:
        return None
    try:
        if not pyphen.language_fallback(language):
            return None
        return pyphen.Pyphen(lang=language)
    except Exception:
        return None


def has_dictionary(language: str) -> bool:
    """Gibt es fuer diese Sprache eine echte Silbentrennung?"""
    return _woerterbuch(language) is not None


def split_syllables(word: str, language: str) -> list[str]:
    """Wort in Silben zerlegen. Die Teile ergeben verlustfrei das Wort."""
    if not word:
        return []
    wb = _woerterbuch(language)
    if wb is None:
        return [word]
    # \x00 als Trennmarke: kommt in Liedtexten nicht vor.
    teile = [t for t in wb.inserted(word, hyphen="\x00").split("\x00") if t]
    return teile or [word]
```

```python
# python-sidecar/ultrastar_pipeline/tempo.py
"""Tempoerkennung.

Beat-Tracker verfehlen das Tempo klassischerweise um Faktor zwei — mal
halb, mal doppelt. korrigiere_tempo schiebt den Wert in einen
musikalisch plausiblen Bereich zurueck.
"""


def korrigiere_tempo(bpm: float, min_bpm: float = 70.0, max_bpm: float = 180.0) -> float:
    """Halb/Doppel-Fehler ausgleichen, ohne endlos zu laufen.

    Der Zielbereich ist einschliesslich: ein Wert genau auf min_bpm oder
    max_bpm ist bereits richtig und wird unveraendert zurueckgegeben.
    Die Vergleiche muessen darum strikt bleiben — mit <= bzw. >= wuerden
    Grenzwerte aus dem Bereich hinausgeschoben (70 -> 140, 180 -> 90).
    """
    if bpm <= 0:
        return bpm
    wert = float(bpm)
    # Iterationsgrenze verhindert Endlosschleifen bei Bereichen, die kein
    # Faktor-2-Vielfaches treffen kann.
    for _ in range(8):
        if wert < min_bpm:
            wert *= 2.0
        elif wert > max_bpm:
            wert /= 2.0
        else:
            break
    return wert
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:py`
Expected: PASS, 18 Tests (4 aus Task 5 plus 14 neue — die parametrize-Blöcke expandieren, die Zahl also nicht nach Augenmass schätzen)

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/syllables.py python-sidecar/ultrastar_pipeline/tempo.py python-sidecar/tests/test_syllables.py python-sidecar/tests/test_tempo.py
git commit -m "feat(sidecar): syllable splitting with fallback and half/double tempo fix"
```

---

### Task 7: Notenbau `notes.py` — der Kern

Hier wird die Sync-Qualität entschieden. Rein: keine Modelle, kein Dateisystem, keine GPU. Ein Test sichert ab, dass es so bleibt.

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/notes.py`
- Test: `python-sidecar/tests/test_notes.py`

**Interfaces:**
- Consumes: `split_syllables` aus Task 6.
- Produces: Dataclasses `AlignedWord(text, start, end, confidence, line_index)`, `PitchPoint(time, midi, voiced)`, `Note(beat, length, pitch, syllable, confidence)`, `LineBreak(after_note_index, beat)`, Konstante `MIDI_NULLAGE = 60`, sowie `build_notes(words, pitch, bpm, language, beats_per_bpm_unit=4) -> tuple[list[Note], list[LineBreak], int]` (der `int` ist der GAP in ms). Task 9 und Task 11 verwenden diese.

- [ ] **Step 1: Write the failing test**

```python
# python-sidecar/tests/test_notes.py
import sys

from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes


def w(text, start, end, line=0, conf=0.9):
    return AlignedWord(text=text, start=start, end=end, confidence=conf, line_index=line)


def flacher_pitch(midi=60.0, bis=10.0):
    """Konstante Tonhoehe, alle 10 ms ein Punkt."""
    return [PitchPoint(time=i / 100, midi=midi, voiced=True) for i in range(int(bis * 100))]


def test_erzeugt_eine_note_pro_silbe():
    noten, _, _ = build_notes([w("Hallo", 1.0, 1.5)], flacher_pitch(), bpm=120, language="de")
    assert [n.syllable for n in noten] == ["Hal", "lo"]


def test_erste_note_beginnt_auf_beat_null_und_setzt_gap():
    noten, _, gap = build_notes([w("Hallo", 2.0, 2.5)], flacher_pitch(), bpm=120, language="de")
    assert noten[0].beat == 0
    assert gap == 2000


def test_noten_sind_zeitlich_aufsteigend():
    words = [w("eins", 1.0, 1.4), w("zwei", 1.5, 1.9), w("drei", 2.0, 2.4)]
    noten, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    beats = [n.beat for n in noten]
    assert beats == sorted(beats)


def test_laenge_ist_mindestens_eins():
    noten, _, _ = build_notes([w("ah", 1.0, 1.005)], flacher_pitch(), bpm=120, language="de")
    assert all(n.length >= 1 for n in noten)


def test_umbruch_zwischen_zeilen():
    words = [w("eins", 1.0, 1.4, line=0), w("zwei", 3.0, 3.4, line=1)]
    noten, umbrueche, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert len(umbrueche) == 1
    assert umbrueche[0].after_note_index == 0
    assert umbrueche[0].beat > noten[0].beat


def test_kein_umbruch_vor_der_ersten_note():
    words = [w("eins", 1.0, 1.4, line=3)]
    _, umbrueche, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert umbrueche == []


def test_tonhoehe_kommt_aus_dem_pitch_verlauf():
    noten, _, _ = build_notes(
        [w("Hallo", 1.0, 1.5)], flacher_pitch(midi=62.0), bpm=120, language="de"
    )
    assert len({n.pitch for n in noten}) == 1
    assert noten[0].pitch == 2  # 62 MIDI - Nullage 60


def test_unvoiced_pitch_faellt_auf_rueckfall_zurueck():
    stumm = [PitchPoint(time=i / 100, midi=0.0, voiced=False) for i in range(1000)]
    noten, _, _ = build_notes([w("Hallo", 1.0, 1.5)], stumm, bpm=120, language="de")
    assert all(isinstance(n.pitch, int) for n in noten)


def test_leere_eingabe_ergibt_keine_noten():
    noten, umbrueche, gap = build_notes([], flacher_pitch(), bpm=120, language="de")
    assert noten == []
    assert umbrueche == []
    assert gap == 0


def test_notes_importiert_keine_modelle():
    """notes.py muss rein bleiben, damit es ohne GPU testbar ist."""
    import ultrastar_pipeline.notes  # noqa: F401

    assert not any(m in sys.modules for m in ("torch", "demucs", "whisperx", "librosa"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:py`
Expected: FAIL — `ModuleNotFoundError: No module named 'ultrastar_pipeline.notes'`

- [ ] **Step 3: Write minimal implementation**

```python
# python-sidecar/ultrastar_pipeline/notes.py
"""Alignment + Tonhoehe + Tempo -> UltraStar-Noten.

Bewusst rein: keine Modelle, kein Dateisystem, keine GPU. Hier wird die
Sync-Qualitaet entschieden, und genau deshalb muss dieses Modul in
Millisekunden testbar bleiben — sonst laeuft bei jeder Justierung Demucs.
"""

from dataclasses import dataclass
from statistics import median

from .syllables import split_syllables


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start: float  # Sekunden
    end: float
    confidence: float
    line_index: int


@dataclass(frozen=True)
class PitchPoint:
    time: float  # Sekunden
    midi: float
    voiced: bool


@dataclass(frozen=True)
class Note:
    beat: int
    length: int
    pitch: int
    syllable: str
    confidence: float


@dataclass(frozen=True)
class LineBreak:
    after_note_index: int
    beat: int


# UltraStar-Tonhoehe 0 entspricht C4 (MIDI 60).
MIDI_NULLAGE = 60


def _beats_pro_sekunde(bpm: float, beats_per_bpm_unit: int) -> float:
    return bpm * beats_per_bpm_unit / 60.0


def _mittlere_tonhoehe(
    pitch: list[PitchPoint], von: float, bis: float, rueckfall: int
) -> int:
    werte = [p.midi for p in pitch if p.voiced and von <= p.time < bis and p.midi > 0]
    if not werte:
        return rueckfall
    return int(round(median(werte))) - MIDI_NULLAGE


def build_notes(
    words: list[AlignedWord],
    pitch: list[PitchPoint],
    bpm: float,
    language: str,
    beats_per_bpm_unit: int = 4,
) -> tuple[list[Note], list[LineBreak], int]:
    """Noten, Zeilenumbrueche und GAP (ms) aus dem Alignment bauen."""
    if not words:
        return [], [], 0

    bps = _beats_pro_sekunde(bpm, beats_per_bpm_unit)
    gap_sekunden = words[0].start
    gap_ms = int(round(gap_sekunden * 1000))

    # Globaler Rueckfall fuer Woerter ohne verwertbare Tonhoehe.
    gesungen = [p.midi for p in pitch if p.voiced and p.midi > 0]
    rueckfall = int(round(median(gesungen))) - MIDI_NULLAGE if gesungen else 0

    noten: list[Note] = []
    umbrueche: list[LineBreak] = []
    letzte_zeile = words[0].line_index

    for wort in words:
        if wort.line_index != letzte_zeile:
            # Umbruch nur, wenn schon Noten existieren — sonst gibt es
            # nichts zu trennen.
            if noten:
                umbrueche.append(
                    LineBreak(
                        after_note_index=len(noten) - 1,
                        beat=int(round((wort.start - gap_sekunden) * bps)),
                    )
                )
            letzte_zeile = wort.line_index

        silben = split_syllables(wort.text, language)
        if not silben:
            continue

        dauer = max(wort.end - wort.start, 1e-3)
        pro_silbe = dauer / len(silben)

        for i, silbe in enumerate(silben):
            von = wort.start + i * pro_silbe
            bis = von + pro_silbe
            noten.append(
                Note(
                    beat=int(round((von - gap_sekunden) * bps)),
                    length=max(1, int(round(pro_silbe * bps))),
                    pitch=_mittlere_tonhoehe(pitch, von, bis, rueckfall),
                    syllable=silbe,
                    confidence=wort.confidence,
                )
            )

    return noten, umbrueche, gap_ms
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:py`
Expected: PASS, 24 Tests

- [ ] **Step 5: Angleichung an den gemessenen Faktor**

`beats_per_bpm_unit` muss zum in Task 1 gemessenen `BEATS_PER_BPM_UNIT` passen. Ist der Messwert nicht 4, den Standardwert in `build_notes` entsprechend ändern und die Tests erneut laufen lassen — sie prüfen Eigenschaften, nicht den Faktor, und müssen weiter grün sein. Ausnahme: `test_erzeugt_eine_note_pro_silbe` und `test_tonhoehe_kommt_aus_dem_pitch_verlauf` sind faktorunabhängig, `test_laenge_ist_mindestens_eins` bleibt durch das `max(1, ...)` erfüllt.

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/notes.py python-sidecar/tests/test_notes.py
git commit -m "feat(sidecar): pure note builder mapping alignment and pitch to UltraStar beats"
```

#### Nachtrag: der Code oben ist überholt (2026-07-26)

**Bei einem erneuten Lauf nicht die Codeblöcke dieses Tasks übernehmen.** Das Review fand darin einen Critical und zwei Important; die verbindliche Fassung ist der committete Code (`0796d07`, korrigiert in `4c3e217` und `35dbe81`). Fünf Korrekturen, jeweils mit dem Grund:

1. **Der Reinheits-Test bewies nichts.** Er prüfte `sys.modules` nach dem Import — und weil die ML-Pakete gar nicht installiert sind, war die Zusicherung leer wahr, unabhängig davon, was `notes.py` importiert. Ersetzt durch eine AST-Analyse der Importanweisungen von `notes.py` **und** `syllables.py`. Bekannte Grenze: ein verbotenes Paket, das über ein drittes lokales Modul hereinkäme, wird nicht erfasst.

2. **Beat und Länge rundeten unabhängig.** Zwei Silben eines schnell gesungenen Wortes konnten auf denselben Beat fallen und behielten beide Länge ≥ 1 — übereinandergestapelte Noten. Behoben durch zwei Durchläufe: Beats mindestens einen Schritt auseinanderziehen, dann Längen kürzen. **Kürzen statt Verschieben**, weil der Einsatzzeitpunkt die singbare Größe ist.

3. **Eine Zeile ohne Silben erzeugte zwei Umbrüche mit gleichem Index.** Die Zeilenbuchführung lief vor dem Abbruch. Silben werden jetzt zuerst berechnet, und ein Wort ohne Silben verbucht keinen Zeilenwechsel.

4. **Die Umbruch-Beats wurden durch Korrektur 2 inkonsistent** — sie stammen aus unverschobenen Zeiten, während die Noten nach hinten wanderten, sodass ein Umbruch vor der Note liegen konnte, der er folgt. Dritter Durchlauf klemmt jeden Umbruch in die Lücke zwischen seiner Note und der nächsten; ein Umbruch hinter der letzten Note entfällt. Dieser Defekt entstand **durch die Behebung von Korrektur 2** — ein Hinweis darauf, die Wechselwirkung mitzuprüfen, nicht nur die Einzelbefunde.

5. **Ein Test prüfte nur den Typ der Tonhöhe, nicht den Wert.** Bei vollständig stimmloser Eingabe ist der Rückfall exakt 0 und wird jetzt so geprüft.

Testzahl danach: **31** (13 in `test_notes.py` plus 18 aus den Tasks 5 und 6).

---

### Task 8: Cache und Vertrag auf Python-Seite

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/cache.py`
- Create: `python-sidecar/ultrastar_pipeline/contract.py`
- Test: `python-sidecar/tests/test_cache.py`
- Test: `python-sidecar/tests/test_contract.py`

**Interfaces:**
- Consumes: `Note`, `LineBreak` aus Task 7.
- Produces: `audio_fingerprint(path: Path) -> str`, `stage_path(work_dir: Path, audio_hash: str, stage: str, params: dict, stage_version: str, suffix: str) -> Path`, `atomic_write_bytes(target: Path, daten: bytes) -> None`, `SCHEMA_VERSION = 1`, `baue_song_data(*, bpm, gap, language, notes, line_breaks, duration_sec, device, stage_versions, warnings, largest_gap_sec=0.0) -> dict`. Task 9 verwendet alle.

- [ ] **Step 1: Write the failing tests**

```python
# python-sidecar/tests/test_cache.py
from ultrastar_pipeline.cache import atomic_write_bytes, audio_fingerprint, stage_path


def test_fingerprint_haengt_am_inhalt_nicht_am_pfad(tmp_path):
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    a.write_bytes(b"identisch")
    b.write_bytes(b"identisch")
    assert audio_fingerprint(a) == audio_fingerprint(b)


def test_fingerprint_aendert_sich_mit_dem_inhalt(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"eins")
    erster = audio_fingerprint(a)
    a.write_bytes(b"zwei")
    assert audio_fingerprint(a) != erster


def test_stage_path_unterscheidet_parameter(tmp_path):
    p1 = stage_path(tmp_path, "abc", "separate", {"model": "htdemucs"}, "1", ".wav")
    p2 = stage_path(tmp_path, "abc", "separate", {"model": "mdx"}, "1", ".wav")
    assert p1 != p2


def test_stage_path_unterscheidet_stufenversion(tmp_path):
    p1 = stage_path(tmp_path, "abc", "align", {}, "1", ".json")
    p2 = stage_path(tmp_path, "abc", "align", {}, "2", ".json")
    assert p1 != p2


def test_stage_path_ist_stabil(tmp_path):
    args = (tmp_path, "abc", "pitch", {"hop": 256}, "1", ".json")
    assert stage_path(*args) == stage_path(*args)


def test_atomic_write_hinterlaesst_keine_temporaerdatei(tmp_path):
    ziel = tmp_path / "unter" / "ergebnis.json"
    atomic_write_bytes(ziel, b"inhalt")
    assert ziel.read_bytes() == b"inhalt"
    assert list(tmp_path.rglob("*.tmp")) == []
```

```python
# python-sidecar/tests/test_contract.py
from ultrastar_pipeline.contract import SCHEMA_VERSION, baue_song_data
from ultrastar_pipeline.notes import LineBreak, Note


def _baue(noten, umbrueche=()):
    return baue_song_data(
        bpm=120.0,
        gap=1000,
        language="de",
        notes=list(noten),
        line_breaks=list(umbrueche),
        duration_sec=10.0,
        device="cpu",
        stage_versions={},
        warnings=[],
    )


def test_enthaelt_schema_version():
    assert _baue([Note(0, 4, 5, "Hal", 0.9)])["schemaVersion"] == SCHEMA_VERSION == 1


def test_notenfelder_heissen_wie_im_vertrag():
    d = _baue([Note(1, 2, 3, "Sil", 0.8)], [LineBreak(0, 8)])
    assert d["notes"][0] == {
        "beat": 1,
        "length": 2,
        "pitch": 3,
        "syllable": "Sil",
        "confidence": 0.8,
    }
    assert d["lineBreaks"][0] == {"afterNoteIndex": 0, "beat": 8}


def test_konfidenz_wird_aggregiert_und_markiert():
    d = _baue([Note(i, 2, 3, "x", 0.2) for i in range(5)])
    assert d["meta"]["confidence"]["median"] == 0.2
    assert d["meta"]["confidence"]["unsureRatio"] == 1.0
    assert d["meta"]["lowConfidence"] is True


def test_hohe_konfidenz_ist_nicht_markiert():
    d = _baue([Note(i, 2, 3, "x", 0.95) for i in range(5)])
    assert d["meta"]["lowConfidence"] is False
    assert d["meta"]["confidence"]["unsureRatio"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:py`
Expected: FAIL — `ModuleNotFoundError: No module named 'ultrastar_pipeline.cache'`

- [ ] **Step 3: Write minimal implementation**

```python
# python-sidecar/ultrastar_pipeline/cache.py
"""Zwischenstufen-Cache.

Geschluesselt ueber den Audio-INHALT, nicht den Pfad — dieselbe Datei an
anderer Stelle trifft denselben Cache. Stufenparameter und Stufenversion
gehen mit ein, damit eine Codeaenderung den Cache invalidiert.

Geschrieben wird erst nach .tmp und dann umbenannt, damit ein Abbruch den
Cache nicht vergiftet. Dasselbe Muster nutzt desktop/main/binaries.ts.
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Any

_BLOCK = 1024 * 1024


def audio_fingerprint(path: Path) -> str:
    """SHA-256 ueber den Dateiinhalt, blockweise gelesen."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(_BLOCK):
            h.update(block)
    return h.hexdigest()[:16]


def _param_hash(params: dict[str, Any], stage_version: str) -> str:
    roh = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{roh}|{stage_version}".encode()).hexdigest()[:8]


def stage_path(
    work_dir: Path,
    audio_hash: str,
    stage: str,
    params: dict[str, Any],
    stage_version: str,
    suffix: str,
) -> Path:
    """Zielpfad fuer das Ergebnis einer Stufe."""
    return work_dir / audio_hash / f"{stage}-{_param_hash(params, stage_version)}{suffix}"


def atomic_write_bytes(target: Path, daten: bytes) -> None:
    """Erst nach .tmp schreiben, dann umbenennen."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f"{target.suffix}.tmp")
    with open(tmp, "wb") as f:
        f.write(daten)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)
```

```python
# python-sidecar/ultrastar_pipeline/contract.py
"""Serialisierung nach song_data.json.

Python kennt das UltraStar-Format nicht — es liefert nur diesen Vertrag.
Das .txt schreibt TypeScript.
"""

from statistics import median
from typing import Any

from .notes import LineBreak, Note

SCHEMA_VERSION = 1

# Unter diesem Median gilt das Gesamtergebnis als unsicher.
KONFIDENZ_SCHWELLE = 0.5
# Einzelne Woerter unter diesem Wert zaehlen als unsicher.
UNSICHER_AB = 0.6


def baue_song_data(
    *,
    bpm: float,
    gap: int,
    language: str,
    notes: list[Note],
    line_breaks: list[LineBreak],
    duration_sec: float,
    device: str,
    stage_versions: dict[str, str],
    warnings: list[str],
    largest_gap_sec: float = 0.0,
) -> dict[str, Any]:
    """Vertragsobjekt bauen, inklusive aggregierter Konfidenz."""
    konfidenzen = [n.confidence for n in notes]
    med = median(konfidenzen) if konfidenzen else 0.0
    unsicher = (
        sum(1 for c in konfidenzen if c < UNSICHER_AB) / len(konfidenzen)
        if konfidenzen
        else 0.0
    )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "bpm": bpm,
        "gap": gap,
        "language": language,
        "notes": [
            {
                "beat": n.beat,
                "length": n.length,
                "pitch": n.pitch,
                "syllable": n.syllable,
                "confidence": n.confidence,
            }
            for n in notes
        ],
        "lineBreaks": [
            {"afterNoteIndex": b.after_note_index, "beat": b.beat} for b in line_breaks
        ],
        "meta": {
            "durationSec": duration_sec,
            "device": device,
            "stageVersions": stage_versions,
            "warnings": warnings,
            "confidence": {
                "median": med,
                "unsureRatio": unsicher,
                "largestGapSec": largest_gap_sec,
            },
            "lowConfidence": bool(notes) and med < KONFIDENZ_SCHWELLE,
        },
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:py`
Expected: PASS, 34 Tests

- [ ] **Step 5: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/cache.py python-sidecar/ultrastar_pipeline/contract.py python-sidecar/tests/test_cache.py python-sidecar/tests/test_contract.py
git commit -m "feat(sidecar): content-keyed stage cache and song data contract"
```

---

### Task 9: Modell-Adapter und CLI

Die drei dünnen Adapter plus die Orchestrierung. Der Volllauf-Rauchtest ist mit `slow` markiert und läuft standardmäßig nicht.

**Files:**
- Create: `python-sidecar/ultrastar_pipeline/separate.py`
- Create: `python-sidecar/ultrastar_pipeline/align.py`
- Create: `python-sidecar/ultrastar_pipeline/pitch.py`
- Create: `python-sidecar/ultrastar_pipeline/__main__.py`
- Test: `python-sidecar/tests/test_cli.py`

**Interfaces:**
- Consumes: alles aus Tasks 5–8.
- Produces: CLI `python -m ultrastar_pipeline --audio P --lyrics-file P --language de [--bpm N] [--device auto|cuda|cpu] [--work-dir D] --out P`. Exit 0 bei Erfolg, 1 bei Fehler (mit `@@ERROR`-Zeile), 2 bei Aufrufmissbrauch. Ausnahmen `LanguageUnsupported(language)` und `AlignmentFailed` aus `align.py`. Task 10 spawnt diese CLI.

- [ ] **Step 1: Write the failing test**

```python
# python-sidecar/tests/test_cli.py
import json
import subprocess
import sys
from pathlib import Path

import pytest

from ultrastar_pipeline.progress import ERROR_PREFIX

WURZEL = Path(__file__).resolve().parent.parent


def _lauf(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "ultrastar_pipeline", *args],
        capture_output=True,
        text=True,
        cwd=WURZEL,
    )


def _fehler_kind(ausgabe: str) -> str | None:
    for zeile in ausgabe.splitlines():
        if zeile.startswith(ERROR_PREFIX):
            return json.loads(zeile[len(ERROR_PREFIX):])["kind"]
    return None


def test_fehlende_argumente_ergeben_exit_2():
    assert _lauf().returncode == 2


def test_fehlendes_audio_meldet_strukturierten_fehler(tmp_path):
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Hallo Welt\n", encoding="utf8")
    p = _lauf(
        "--audio", str(tmp_path / "gibtsnicht.wav"),
        "--lyrics-file", str(lyrics),
        "--language", "de",
        "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "audio_unreadable"


def test_leerer_text_meldet_strukturierten_fehler(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"kein echtes audio")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("\n\n", encoding="utf8")
    p = _lauf(
        "--audio", str(audio), "--lyrics-file", str(lyrics),
        "--language", "de", "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "lyrics_empty"


def test_ungeloeste_textfrage_bricht_ab(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"kein echtes audio")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Zeile (2x)\n", encoding="utf8")
    p = _lauf(
        "--audio", str(audio), "--lyrics-file", str(lyrics),
        "--language", "de", "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "lyrics_unresolved"


@pytest.mark.slow
def test_voller_lauf_erzeugt_gueltiges_json(tmp_path):
    """Braucht Modelle. Aufruf: bun run test:py:slow"""
    clip = WURZEL / "tests" / "fixtures" / "clip.wav"
    if not clip.is_file():
        pytest.skip("tests/fixtures/clip.wav fehlt (nicht im Repo, lokal ablegen)")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Hallo Welt\n", encoding="utf8")
    out = tmp_path / "out.json"
    p = _lauf(
        "--audio", str(clip), "--lyrics-file", str(lyrics),
        "--language", "de", "--device", "cpu",
        "--work-dir", str(tmp_path / "cache"), "--out", str(out),
    )
    assert p.returncode == 0, p.stdout
    daten = json.loads(out.read_text(encoding="utf8"))
    assert daten["schemaVersion"] == 1
    assert len(daten["notes"]) > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:py`
Expected: FAIL — `No module named ultrastar_pipeline.__main__`

- [ ] **Step 3: Write the three adapters**

```python
# python-sidecar/ultrastar_pipeline/separate.py
"""Stimmtrennung ueber Demucs. Duenner Adapter, sonst nichts.

Die Modell-Importe stehen absichtlich in der Funktion: so bleibt der
Modulkopf modellfrei und der Import kostet nichts, solange nicht getrennt
wird.
"""

from pathlib import Path

from .cache import atomic_write_bytes, stage_path
from .progress import emit_progress

STAGE_VERSION = "1"
MODELL = "htdemucs"


def separate(audio: Path, work_dir: Path, audio_hash: str, device: str) -> Path:
    """Gesangsspur erzeugen und cachen. Gibt den Pfad zur vocals.wav zurueck."""
    ziel = stage_path(work_dir, audio_hash, "separate", {"model": MODELL}, STAGE_VERSION, ".wav")
    if ziel.is_file():
        emit_progress("separate", 1.0)
        return ziel

    emit_progress("separate", 0.0)
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio
    from demucs.pretrained import get_model

    modell = get_model(MODELL)
    modell.to(device)
    modell.eval()

    wav = AudioFile(audio).read(
        streams=0, samplerate=modell.samplerate, channels=modell.audio_channels
    )
    referenz = wav.mean(0)
    wav = (wav - referenz.mean()) / referenz.std()

    with torch.no_grad():
        quellen = apply_model(modell, wav[None], device=device, progress=False)[0]
    quellen = quellen * referenz.std() + referenz.mean()

    roh = ziel.with_suffix(".roh.wav")
    roh.parent.mkdir(parents=True, exist_ok=True)
    save_audio(quellen[modell.sources.index("vocals")], str(roh), modell.samplerate)
    atomic_write_bytes(ziel, roh.read_bytes())
    roh.unlink(missing_ok=True)

    emit_progress("separate", 1.0)
    return ziel
```

```python
# python-sidecar/ultrastar_pipeline/align.py
"""Forced Alignment ueber WhisperX. Duenner Adapter."""

import json
from pathlib import Path

from .cache import atomic_write_bytes, stage_path
from .notes import AlignedWord
from .progress import emit_progress

STAGE_VERSION = "1"


class LanguageUnsupported(Exception):
    """Fuer diese Sprache gibt es kein Alignment-Modell."""

    def __init__(self, language: str) -> None:
        super().__init__(language)
        self.language = language


class AlignmentFailed(Exception):
    """Alignment lieferte kein verwertbares Ergebnis."""


def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
) -> list[AlignedWord]:
    """Bekannte Zeilen auf die Gesangsspur ausrichten."""
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {"language": language, "lines": len(lines)},
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    # Jede Textzeile wird ein Segment: die Zeilenzuordnung bleibt damit
    # erhalten und liefert spaeter die Zeilenumbrueche.
    segmente = [{"text": zeile, "start": 0.0, "end": 0.0} for zeile in lines]
    ergebnis = whisperx.align(
        segmente, modell, metadaten, str(vocals), device, return_char_alignments=False
    )

    woerter: list[AlignedWord] = []
    for i, segment in enumerate(ergebnis.get("segments", [])):
        for wort in segment.get("words", []):
            if wort.get("start") is None or wort.get("end") is None:
                continue
            text = str(wort.get("word", "")).strip()
            if not text:
                continue
            woerter.append(
                AlignedWord(
                    text=text,
                    start=float(wort["start"]),
                    end=float(wort["end"]),
                    confidence=float(wort.get("score", 0.0)),
                    line_index=i,
                )
            )

    if not woerter:
        raise AlignmentFailed("keine Woerter zugeordnet")

    atomic_write_bytes(
        ziel, json.dumps([w.__dict__ for w in woerter], ensure_ascii=False).encode("utf8")
    )
    emit_progress("align", 1.0)
    return woerter
```

```python
# python-sidecar/ultrastar_pipeline/pitch.py
"""Tonhoehenverlauf ueber SwiftF0. Duenner Adapter."""

import json
import math
from pathlib import Path

from .cache import atomic_write_bytes, stage_path
from .notes import PitchPoint
from .progress import emit_progress

STAGE_VERSION = "1"


def _hz_zu_midi(hz: float) -> float:
    """Frequenz in MIDI-Halbtoene. 0 bedeutet: keine Tonhoehe."""
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def track_pitch(vocals: Path, work_dir: Path, audio_hash: str) -> list[PitchPoint]:
    """f0-Verlauf der Gesangsspur, in MIDI-Halbtoenen."""
    ziel = stage_path(work_dir, audio_hash, "pitch", {}, STAGE_VERSION, ".json")
    if ziel.is_file():
        emit_progress("pitch", 1.0)
        return [PitchPoint(**p) for p in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("pitch", 0.0)
    from swift_f0 import detect_voicing, extract_f0

    ergebnis = extract_f0(str(vocals))
    stimmhaft = detect_voicing(ergebnis)

    punkte = [
        PitchPoint(time=float(t), midi=_hz_zu_midi(float(f)), voiced=bool(v))
        for t, f, v in zip(ergebnis.timestamps, ergebnis.f0_values, stimmhaft)
    ]

    atomic_write_bytes(ziel, json.dumps([p.__dict__ for p in punkte]).encode("utf8"))
    emit_progress("pitch", 1.0)
    return punkte
```

- [ ] **Step 4: Write the CLI**

```python
# python-sidecar/ultrastar_pipeline/__main__.py
"""CLI des Pipeline-Kerns.

Reihenfolge: tempo (billig) -> separate -> align -> pitch -> notes.
Die drei teuren Stufen sind gecacht, notes nie: es ist billig und genau
das, was justiert wird.
"""

import argparse
import json
import sys
from pathlib import Path

from .align import AlignmentFailed, LanguageUnsupported, align
from .cache import atomic_write_bytes, audio_fingerprint
from .contract import baue_song_data
from .notes import build_notes
from .pitch import track_pitch
from .progress import emit_error, emit_progress
from .separate import separate
from .syllables import has_dictionary
from .tempo import korrigiere_tempo

# Marker, die eine Aufbereitung durch lyrics.ts erfordern. Kopflos wird
# hier nicht geraten — es wird abgebrochen.
UNGELOESTE_MARKER = ("(2x)", "(x2)", "[chorus]", "[refrain]")


def _waehle_device(wunsch: str, warnungen: list[str]) -> str:
    if wunsch != "auto":
        return wunsch
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    warnungen.append("Keine GPU gefunden, Verarbeitung auf CPU (deutlich langsamer).")
    return "cpu"


def _erkenne_bpm(audio: Path) -> float:
    import librosa

    y, sr = librosa.load(str(audio), mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return korrigiere_tempo(float(tempo))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ultrastar_pipeline")
    p.add_argument("--audio", required=True, type=Path)
    p.add_argument("--lyrics-file", required=True, type=Path)
    p.add_argument("--language", required=True)
    p.add_argument("--bpm", type=float, default=None)
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--work-dir", type=Path, default=Path(".pipeline-cache"))
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args(argv)

    warnungen: list[str] = []

    if not args.audio.is_file():
        emit_error("audio_unreadable", path=str(args.audio))
        return 1
    if not args.lyrics_file.is_file():
        emit_error("lyrics_unreadable", path=str(args.lyrics_file))
        return 1

    roh = args.lyrics_file.read_text(encoding="utf8")
    zeilen = [z.strip() for z in roh.splitlines() if z.strip()]
    if not zeilen:
        emit_error("lyrics_empty")
        return 1

    klein = roh.lower()
    gefunden = [m for m in UNGELOESTE_MARKER if m in klein]
    if gefunden:
        emit_error("lyrics_unresolved", markers=gefunden)
        return 1

    if not has_dictionary(args.language):
        warnungen.append(
            f"Keine Silbentrennung fuer '{args.language}', ganze Woerter werden genutzt."
        )

    device = _waehle_device(args.device, warnungen)

    try:
        emit_progress("tempo", 0.0)
        bpm = args.bpm if args.bpm is not None else _erkenne_bpm(args.audio)
        emit_progress("tempo", 1.0)

        fingerprint = audio_fingerprint(args.audio)
        vocals = separate(args.audio, args.work_dir, fingerprint, device)
        woerter = align(vocals, zeilen, args.language, args.work_dir, fingerprint, device)
        verlauf = track_pitch(vocals, args.work_dir, fingerprint)

        # Groesste nicht zugeordnete Luecke: ein Indiz dafuer, dass der
        # Text nicht zum Audio passt (fehlende Strophe, falscher Song).
        luecken = [b.start - a.end for a, b in zip(woerter, woerter[1:])]
        groesste_luecke = max(luecken) if luecken else 0.0

        emit_progress("notes", 0.0)
        noten, umbrueche, gap = build_notes(woerter, verlauf, bpm, args.language)
        emit_progress("notes", 1.0)

    except LanguageUnsupported as exc:
        emit_error("language_unsupported", language=exc.language)
        return 1
    except AlignmentFailed as exc:
        emit_error("alignment_failed", detail=str(exc))
        return 1
    except MemoryError:
        emit_error("device_error", detail="Speicher voll. Mit --device cpu erneut versuchen.")
        return 1
    except Exception as exc:  # noqa: BLE001 - letzte Instanz, strukturiert melden
        art = type(exc).__name__
        # Kein automatisches Ausweichen auf CPU: das verwandelt einen
        # 40-Sekunden-Fehler stillschweigend in zehn Minuten.
        if "OutOfMemory" in art or "out of memory" in str(exc).lower():
            emit_error(
                "device_error", detail="GPU-Speicher voll. Mit --device cpu erneut versuchen."
            )
        else:
            emit_error("pipeline_failed", detail=f"{art}: {exc}")
        return 1

    daten = baue_song_data(
        bpm=bpm,
        gap=gap,
        language=args.language,
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=verlauf[-1].time if verlauf else 0.0,
        device=device,
        stage_versions={"separate": "1", "align": "1", "pitch": "1", "notes": "1"},
        warnings=warnungen,
        largest_gap_sec=groesste_luecke,
    )
    atomic_write_bytes(
        args.out, json.dumps(daten, ensure_ascii=False, indent=2).encode("utf8")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test:py`
Expected: PASS, 38 Tests, 1 als `slow` übersprungen und im `-ra`-Bericht sichtbar

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/ultrastar_pipeline/separate.py python-sidecar/ultrastar_pipeline/align.py python-sidecar/ultrastar_pipeline/pitch.py python-sidecar/ultrastar_pipeline/__main__.py python-sidecar/tests/test_cli.py
git commit -m "feat(sidecar): model adapters and pipeline CLI with structured errors"
```

---

### Task 10: TS-Orchestrierung `pipeline.ts`

Spawnen, `@@PROGRESS` lesen, abbrechen, Fehler typisiert abbilden. Getestet gegen einen Ersatz-Sidecar — kein Modell nötig.

**Files:**
- Create: `src/core/create/pipeline.ts`
- Test: `src/core/create/pipeline.test.ts`

**Interfaces:**
- Consumes: `parseSongData`, `SongData` aus Task 3.
- Produces: `runPipeline(input: PipelineInput): Effect.Effect<SongData, PipelineError>` mit `type PipelineInput = { audioPath: string; lyricsPath: string; language: string; outPath: string; bpm?: number; device?: "auto" | "cuda" | "cpu"; workDir?: string; pythonBin?: string; onProgress?: (stage: string, percent: number) => void; signal?: AbortSignal }` und `type PipelineError = { kind: PipelineErrorKind; detail?: string }`. Task 12 verwendet `runPipeline`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/create/pipeline.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { runPipeline } from "./pipeline.ts";

/** Ersatz-Sidecar: ein .ts-Skript, das den echten Python-Prozess vertritt. */
const fakeSidecar = async (koerper: string): Promise<{ bin: string; dir: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  const skript = join(dir, "fake.ts");
  await writeFile(skript, koerper, "utf8");
  return { bin: skript, dir };
};

const basis = (dir: string) => ({
  audioPath: join(dir, "a.wav"),
  lyricsPath: join(dir, "l.txt"),
  language: "de",
  outPath: join(dir, "out.json"),
});

const gueltigesJson = JSON.stringify({
  schemaVersion: 1,
  bpm: 120,
  gap: 0,
  language: "de",
  notes: [{ beat: 0, length: 4, pitch: 5, syllable: "Hal", confidence: 0.9 }],
  lineBreaks: [],
  meta: {
    durationSec: 1,
    device: "cpu",
    stageVersions: {},
    warnings: [],
    lowConfidence: false,
  },
});

describe("runPipeline", () => {
  it("liest Fortschritt, ignoriert Log-Rauschen und liefert validierte Daten", async () => {
    const { bin, dir } = await fakeSidecar(`
      const out = process.argv[process.argv.indexOf("--out") + 1];
      console.log('@@PROGRESS {"stage":"separate","percent":0.5}');
      console.log("irgendein torch-Rauschen, das ignoriert werden muss");
      console.log('@@PROGRESS {"stage":"notes","percent":1}');
      await Bun.write(out, ${JSON.stringify(gueltigesJson)});
    `);
    const gesehen: string[] = [];
    const daten = await Effect.runPromise(
      runPipeline({ ...basis(dir), pythonBin: bin, onProgress: (s) => gesehen.push(s) }),
    );
    expect(daten.bpm).toBe(120);
    expect(gesehen).toEqual(["separate", "notes"]);
  });

  it("bildet @@ERROR auf typisierte Fehler ab", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"language_unsupported","language":"is"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    expect(e._tag).toBe("Left");
    if (e._tag === "Left") expect(e.left.kind).toBe("LanguageUnsupported");
  });

  it("bildet device_error ab", async () => {
    const { bin, dir } = await fakeSidecar(`
      console.log('@@ERROR {"kind":"device_error","detail":"voll"}');
      process.exit(1);
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("DeviceError");
    else throw new Error("haette fehlschlagen muessen");
  });

  it("meldet ContractMismatch bei falscher schemaVersion", async () => {
    const { bin, dir } = await fakeSidecar(`
      const out = process.argv[process.argv.indexOf("--out") + 1];
      await Bun.write(out, JSON.stringify({ schemaVersion: 99 }));
    `);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("ContractMismatch");
    else throw new Error("haette fehlschlagen muessen");
  });

  it("meldet Cancelled bei Abbruch", async () => {
    const { bin, dir } = await fakeSidecar(`await new Promise((r) => setTimeout(r, 5000));`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: bin, signal: controller.signal })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("Cancelled");
    else throw new Error("haette abbrechen muessen");
  });

  it("meldet EnvMissing, wenn der Interpreter fehlt", async () => {
    const { dir } = await fakeSidecar("");
    const e = await Effect.runPromise(
      Effect.either(runPipeline({ ...basis(dir), pythonBin: "/gibt/es/nicht/python" })),
    );
    if (e._tag === "Left") expect(e.left.kind).toBe("EnvMissing");
    else throw new Error("haette fehlschlagen muessen");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/pipeline.test.ts`
Expected: FAIL — `Cannot find module './pipeline.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/create/pipeline.ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parseSongData, type SongData } from "./songData.ts";

export type PipelineErrorKind =
  | "EnvMissing"
  | "LanguageUnsupported"
  | "AlignmentFailed"
  | "DeviceError"
  | "Cancelled"
  | "ContractMismatch"
  | "PipelineFailed";

export type PipelineError = { kind: PipelineErrorKind; detail?: string };

export type PipelineInput = {
  audioPath: string;
  lyricsPath: string;
  language: string;
  outPath: string;
  bpm?: number;
  device?: "auto" | "cuda" | "cpu";
  workDir?: string;
  /** Interpreter bzw. Skript. Tests setzen hier einen Ersatz-Sidecar ein. */
  pythonBin?: string;
  onProgress?: (stage: string, percent: number) => void;
  signal?: AbortSignal;
};

const PROGRESS_PREFIX = "@@PROGRESS ";
const ERROR_PREFIX = "@@ERROR ";

/** Python-Fehlerart -> unsere typisierte Art. */
const FEHLER_ABBILDUNG: Record<string, PipelineErrorKind> = {
  language_unsupported: "LanguageUnsupported",
  alignment_failed: "AlignmentFailed",
  device_error: "DeviceError",
  audio_unreadable: "PipelineFailed",
  lyrics_unreadable: "PipelineFailed",
  lyrics_empty: "PipelineFailed",
  lyrics_unresolved: "PipelineFailed",
  pipeline_failed: "PipelineFailed",
};

const baueArgumente = (input: PipelineInput): string[] => {
  const args = [
    "--audio", input.audioPath,
    "--lyrics-file", input.lyricsPath,
    "--language", input.language,
    "--out", input.outPath,
  ];
  if (input.bpm !== undefined) args.push("--bpm", String(input.bpm));
  if (input.device) args.push("--device", input.device);
  if (input.workDir) args.push("--work-dir", input.workDir);
  return args;
};

/**
 * Startet den Sidecar, liest Fortschritt und liefert validierte Daten.
 * Zeilen ohne Marker sind Log — torch und Demucs schreiben reichlich.
 */
export const runPipeline = (
  input: PipelineInput,
): Effect.Effect<SongData, PipelineError> =>
  Effect.tryPromise({
    try: async (): Promise<SongData> => {
      const bin = input.pythonBin ?? "python";
      // Ein .ts-Ersatz-Sidecar laeuft ueber bun, echtes Python als Modul.
      const [befehl, vorArgs] = bin.endsWith(".ts")
        ? (["bun", [bin]] as const)
        : ([bin, ["-m", "ultrastar_pipeline"]] as const);

      const kind = spawn(befehl, [...vorArgs, ...baueArgumente(input)], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let letzterFehler: { kind: string; detail?: string } | null = null;
      let rest = "";

      const verarbeite = (stueck: string): void => {
        rest += stueck;
        const zeilen = rest.split("\n");
        rest = zeilen.pop() ?? "";
        for (const zeile of zeilen) {
          if (zeile.startsWith(PROGRESS_PREFIX)) {
            try {
              const p = JSON.parse(zeile.slice(PROGRESS_PREFIX.length));
              input.onProgress?.(String(p.stage), Number(p.percent));
            } catch {
              // Eine defekte Fortschrittszeile ist kein Grund abzubrechen.
            }
          } else if (zeile.startsWith(ERROR_PREFIX)) {
            try {
              letzterFehler = JSON.parse(zeile.slice(ERROR_PREFIX.length));
            } catch {
              letzterFehler = { kind: "pipeline_failed" };
            }
          }
        }
      };

      kind.stdout?.setEncoding("utf8");
      kind.stdout?.on("data", verarbeite);
      let logs = "";
      kind.stderr?.setEncoding("utf8");
      kind.stderr?.on("data", (s: string) => {
        logs += s;
      });

      // Abbruch killt den ganzen Prozessbaum: Demucs startet Kindprozesse.
      let abgebrochen = false;
      const abbrechen = (): void => {
        abgebrochen = true;
        if (kind.pid === undefined) return;
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(kind.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          try {
            process.kill(-kind.pid, "SIGKILL");
          } catch {
            kind.kill("SIGKILL");
          }
        }
      };
      input.signal?.addEventListener("abort", abbrechen, { once: true });

      const code = await new Promise<number>((resolve, reject) => {
        kind.on("error", reject);
        kind.on("close", (c) => resolve(c ?? 1));
      });
      input.signal?.removeEventListener("abort", abbrechen);
      if (rest.length > 0) verarbeite("\n");

      if (abgebrochen) throw { kind: "Cancelled" } satisfies PipelineError;

      if (code !== 0) {
        if (letzterFehler) {
          throw {
            kind: FEHLER_ABBILDUNG[letzterFehler.kind] ?? "PipelineFailed",
            detail: letzterFehler.detail ?? letzterFehler.kind,
          } satisfies PipelineError;
        }
        throw {
          kind: "PipelineFailed",
          detail: `Exit ${code}. ${logs.slice(-500)}`,
        } satisfies PipelineError;
      }

      try {
        return parseSongData(JSON.parse(await readFile(input.outPath, "utf8")));
      } catch (fehler) {
        throw {
          kind: "ContractMismatch",
          detail: fehler instanceof Error ? fehler.message : String(fehler),
        } satisfies PipelineError;
      }
    },
    catch: (fehler): PipelineError => {
      if (
        typeof fehler === "object" &&
        fehler !== null &&
        "kind" in fehler &&
        typeof (fehler as { kind: unknown }).kind === "string"
      ) {
        return fehler as PipelineError;
      }
      const meldung = fehler instanceof Error ? fehler.message : String(fehler);
      // ENOENT beim Spawn heisst: Interpreter nicht gefunden.
      if (meldung.includes("ENOENT")) {
        return {
          kind: "EnvMissing",
          detail: "Python-Interpreter nicht gefunden. Umgebung einrichten (Teilprojekt 2).",
        };
      }
      return { kind: "PipelineFailed", detail: meldung };
    },
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/pipeline.test.ts`
Expected: PASS, 6 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/create/pipeline.ts src/core/create/pipeline.test.ts
git commit -m "feat(create): sidecar orchestration with typed errors and tree kill"
```

---

### Task 11: Integrationstest ohne Modelle

Deckt `notes → JSON → .txt` in CI ab, ohne GPU und ohne 4 GB Modelle. Die Fixtures sind Alignment- und Pitch-JSON, nicht Audio — klein und rechtlich unbedenklich.

**Files:**
- Create: `python-sidecar/tests/fixtures/align-kurz.json`
- Create: `python-sidecar/tests/fixtures/pitch-kurz.json`
- Test: `python-sidecar/tests/test_integration.py`
- Create: `src/core/create/fixtures/song-data-kurz.json`
- Test: `src/core/create/integration.test.ts`

**Interfaces:**
- Consumes: `build_notes`, `baue_song_data` (Python); `parseSongData`, `renderSongTxt` (TS).
- Produces: nichts Neues.

- [ ] **Step 1: Write the fixtures**

```json
[
  { "text": "Hallo", "start": 1.0, "end": 1.6, "confidence": 0.95, "line_index": 0 },
  { "text": "Welt", "start": 1.7, "end": 2.2, "confidence": 0.91, "line_index": 0 },
  { "text": "Guten", "start": 3.0, "end": 3.5, "confidence": 0.88, "line_index": 1 },
  { "text": "Tag", "start": 3.6, "end": 4.1, "confidence": 0.93, "line_index": 1 }
]
```

Speichern als `python-sidecar/tests/fixtures/align-kurz.json`.

```json
[
  { "time": 1.0, "midi": 60.0, "voiced": true },
  { "time": 1.3, "midi": 62.0, "voiced": true },
  { "time": 1.7, "midi": 64.0, "voiced": true },
  { "time": 2.0, "midi": 64.0, "voiced": true },
  { "time": 3.0, "midi": 65.0, "voiced": true },
  { "time": 3.6, "midi": 67.0, "voiced": true },
  { "time": 4.0, "midi": 67.0, "voiced": true }
]
```

Speichern als `python-sidecar/tests/fixtures/pitch-kurz.json`.

- [ ] **Step 2: Write the failing Python integration test**

```python
# python-sidecar/tests/test_integration.py
"""Kette notes -> Vertrag, ohne Modelle. Laeuft in CI ohne GPU."""

import json
from pathlib import Path

from ultrastar_pipeline.contract import baue_song_data
from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes

FIXTURES = Path(__file__).parent / "fixtures"


def _lade():
    woerter = [
        AlignedWord(**w)
        for w in json.loads((FIXTURES / "align-kurz.json").read_text(encoding="utf8"))
    ]
    verlauf = [
        PitchPoint(**p)
        for p in json.loads((FIXTURES / "pitch-kurz.json").read_text(encoding="utf8"))
    ]
    return woerter, verlauf


def _baue():
    woerter, verlauf = _lade()
    noten, umbrueche, gap = build_notes(woerter, verlauf, bpm=120.0, language="de")
    daten = baue_song_data(
        bpm=120.0,
        gap=gap,
        language="de",
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=4.1,
        device="cpu",
        stage_versions={},
        warnings=[],
    )
    return noten, umbrueche, daten


def test_kette_erzeugt_vertragskonformes_json():
    _, _, daten = _baue()
    assert daten["schemaVersion"] == 1
    assert len(daten["notes"]) >= 4
    assert daten["gap"] == 1000
    assert daten["meta"]["lowConfidence"] is False


def test_zeilenumbruch_zwischen_den_beiden_zeilen():
    noten, umbrueche, _ = _baue()
    assert len(umbrueche) == 1
    assert 0 <= umbrueche[0].after_note_index < len(noten) - 1


def test_beats_sind_aufsteigend():
    noten, _, _ = _baue()
    beats = [n.beat for n in noten]
    assert beats == sorted(beats)


def test_json_ist_serialisierbar(tmp_path):
    _, _, daten = _baue()
    ziel = tmp_path / "song_data.json"
    ziel.write_text(json.dumps(daten, ensure_ascii=False, indent=2), encoding="utf8")
    assert json.loads(ziel.read_text(encoding="utf8"))["bpm"] == 120.0
```

- [ ] **Step 3: Run and export the shared TS fixture**

Run: `bun run test:py`
Expected: PASS

Dann die geteilte Fixture erzeugen, damit beide Seiten dieselben Daten sehen:

```bash
cd python-sidecar && python -c "
import json, pathlib
from ultrastar_pipeline.contract import baue_song_data
from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes
f = pathlib.Path('tests/fixtures')
w = [AlignedWord(**x) for x in json.loads((f/'align-kurz.json').read_text(encoding='utf8'))]
p = [PitchPoint(**x) for x in json.loads((f/'pitch-kurz.json').read_text(encoding='utf8'))]
n, b, g = build_notes(w, p, bpm=120.0, language='de')
d = baue_song_data(bpm=120.0, gap=g, language='de', notes=n, line_breaks=b,
                   duration_sec=4.1, device='cpu', stage_versions={}, warnings=[])
out = pathlib.Path('../src/core/create/fixtures'); out.mkdir(parents=True, exist_ok=True)
(out/'song-data-kurz.json').write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf8')
print('geschrieben:', len(d['notes']), 'Noten')
"
```

- [ ] **Step 4: Write the failing TS integration test**

```ts
// src/core/create/integration.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseSongData } from "./songData.ts";
import { renderSongTxt } from "./writeSongTxt.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "song-data-kurz.json");
const lade = async () => parseSongData(JSON.parse(await readFile(FIXTURE, "utf8")));

describe("Kette JSON -> .txt ohne Modelle", () => {
  it("nimmt die vom Sidecar erzeugte Fixture an", async () => {
    const daten = await lade();
    expect(daten.schemaVersion).toBe(1);
    expect(daten.notes.length).toBeGreaterThanOrEqual(4);
  });

  it("erzeugt ein wohlgeformtes .txt", async () => {
    const daten = await lade();
    const txt = renderSongTxt(daten, {
      artist: "Testkuenstler",
      title: "Testlied",
      mp3: "Testlied.ogg",
    });
    const zeilen = txt.split("\n");
    expect(zeilen[0]).toBe("#TITLE:Testlied");
    expect(txt).toContain("#BPM:120");
    expect(txt.endsWith("E\n")).toBe(true);
    expect(zeilen.filter((z) => z.startsWith(": ")).length).toBe(daten.notes.length);
    expect(zeilen.filter((z) => z.startsWith("- ")).length).toBe(daten.lineBreaks.length);
  });

  it("haelt die Beats im .txt aufsteigend", async () => {
    const daten = await lade();
    const txt = renderSongTxt(daten, { artist: "A", title: "T", mp3: "t.ogg" });
    const beats = txt
      .split("\n")
      .filter((z) => z.startsWith(": "))
      .map((z) => Number.parseInt(z.split(" ")[1] ?? "0", 10));
    expect(beats).toEqual([...beats].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `bun test src/core/create/ && bun run test:py`
Expected: PASS auf beiden Seiten

- [ ] **Step 6: Commit**

```bash
git add python-sidecar/tests/fixtures python-sidecar/tests/test_integration.py src/core/create/fixtures src/core/create/integration.test.ts
git commit -m "test(create): model-free integration path from notes to txt"
```

---

### Task 12: Bewertungs-Harness und Basiswert

Der eigentliche Qualitätsnachweis. Muss **vor** jeder Feinarbeit an `notes.py` einen dokumentierten Basiswert liefern.

**Files:**
- Create: `src/core/create/evaluate.ts`
- Test: `src/core/create/evaluate.test.ts`
- Create: `scripts/evaluate-pipeline.ts`
- Create: `scripts/reference-corpus.example.json`
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-07-26-song-creation-pipeline-core-design.md`

**Interfaces:**
- Consumes: `beatToMs` (Task 1), `renderSongTxt` (Task 4), `runPipeline` (Task 10).
- Produces: `parseReferenceTxt(txt: string): ReferenceSong`, `compareToReference(unser: ReferenceSong, referenz: ReferenceSong): Metrics` mit `type ReferenceSong = { bpm: number; gap: number; syllables: { syllable: string; onsetMs: number }[] }` und `type Metrics = { paare: number; medianAbweichungMs: number; p90AbweichungMs: number; anteilUnter50ms: number; anteilUnter100ms: number; notenzahlDifferenz: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/create/evaluate.test.ts
import { describe, expect, it } from "bun:test";
import { compareToReference, parseReferenceTxt } from "./evaluate.ts";

const txt = [
  "#TITLE:T",
  "#ARTIST:A",
  "#BPM:120",
  "#GAP:1000",
  ": 0 4 5 Hal",
  ": 4 4 7 lo",
  "- 12",
  ": 16 8 9 Welt",
  "E",
  "",
].join("\n");

describe("parseReferenceTxt", () => {
  it("liest BPM, GAP und Silben mit Onset", () => {
    const r = parseReferenceTxt(txt);
    expect(r.bpm).toBe(120);
    expect(r.gap).toBe(1000);
    expect(r.syllables.map((s) => s.syllable)).toEqual(["Hal", "lo", "Welt"]);
    expect(r.syllables[0]?.onsetMs).toBe(1000);
  });

  it("versteht Komma als Dezimaltrenner im BPM", () => {
    expect(parseReferenceTxt(txt.replace("#BPM:120", "#BPM:294,5")).bpm).toBe(294.5);
  });

  it("ignoriert Umbruch- und Kopfzeilen als Silben", () => {
    expect(parseReferenceTxt(txt).syllables).toHaveLength(3);
  });
});

describe("compareToReference", () => {
  it("meldet null Abweichung bei identischen Daten", () => {
    const r = parseReferenceTxt(txt);
    const m = compareToReference(r, r);
    expect(m.medianAbweichungMs).toBe(0);
    expect(m.anteilUnter50ms).toBe(1);
    expect(m.notenzahlDifferenz).toBe(0);
  });

  it("misst eine konstante Verschiebung", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = {
      ...referenz,
      syllables: referenz.syllables.map((s) => ({ ...s, onsetMs: s.onsetMs + 80 })),
    };
    const m = compareToReference(unser, referenz);
    expect(m.medianAbweichungMs).toBeCloseTo(80, 6);
    expect(m.anteilUnter50ms).toBe(0);
    expect(m.anteilUnter100ms).toBe(1);
  });

  it("meldet abweichende Notenzahl und vergleicht nur die Schnittmenge", () => {
    const referenz = parseReferenceTxt(txt);
    const unser = { ...referenz, syllables: referenz.syllables.slice(0, 2) };
    const m = compareToReference(unser, referenz);
    expect(m.notenzahlDifferenz).toBe(-1);
    expect(m.paare).toBe(2);
  });

  it("liefert bei leerer Eingabe keine NaN-Werte", () => {
    const leer = { bpm: 120, gap: 0, syllables: [] };
    const m = compareToReference(leer, leer);
    expect(Number.isNaN(m.medianAbweichungMs)).toBe(false);
    expect(m.paare).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/create/evaluate.test.ts`
Expected: FAIL — `Cannot find module './evaluate.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/create/evaluate.ts
import { beatToMs } from "./format.ts";

export type ReferenceSong = {
  bpm: number;
  gap: number;
  syllables: { syllable: string; onsetMs: number }[];
};

export type Metrics = {
  paare: number;
  medianAbweichungMs: number;
  p90AbweichungMs: number;
  anteilUnter50ms: number;
  anteilUnter100ms: number;
  notenzahlDifferenz: number;
};

const zahlAusHeader = (txt: string, name: string, standard: number): number => {
  const m = new RegExp(`^#${name}:(.*)$`, "m").exec(txt);
  if (!m?.[1]) return standard;
  // Deutsche Bestandsdateien nutzen Komma als Dezimaltrenner.
  const wert = Number.parseFloat(m[1].trim().replace(",", "."));
  return Number.isNaN(wert) ? standard : wert;
};

/** Liest ein UltraStar-.txt in eine vergleichbare Silbenfolge. */
export const parseReferenceTxt = (txt: string): ReferenceSong => {
  const bpm = zahlAusHeader(txt, "BPM", 0);
  const gap = zahlAusHeader(txt, "GAP", 0);
  const syllables: { syllable: string; onsetMs: number }[] = [];

  for (const zeile of txt.split("\n")) {
    const m = /^[:*FR]\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/.exec(zeile.trimEnd());
    if (!m?.[1]) continue;
    syllables.push({
      syllable: m[4] ?? "",
      onsetMs: beatToMs(Number.parseInt(m[1], 10), bpm, gap),
    });
  }
  return { bpm, gap, syllables };
};

const quantil = (werte: number[], q: number): number => {
  if (werte.length === 0) return 0;
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))] ?? 0;
};

/**
 * Vergleicht unsere Ausgabe gegen eine von Menschen gesyncte Referenz.
 * Verglichen wird paarweise nach Position: weil die Lyrics aus der
 * Referenz selbst stammen, stimmen die Silbenfolgen 1:1 ueberein.
 */
export const compareToReference = (
  unser: ReferenceSong,
  referenz: ReferenceSong,
): Metrics => {
  const anzahl = Math.min(unser.syllables.length, referenz.syllables.length);
  const abweichungen: number[] = [];
  for (let i = 0; i < anzahl; i++) {
    abweichungen.push(
      Math.abs((unser.syllables[i]?.onsetMs ?? 0) - (referenz.syllables[i]?.onsetMs ?? 0)),
    );
  }

  const anteil = (grenze: number): number =>
    abweichungen.length === 0
      ? 0
      : abweichungen.filter((d) => d < grenze).length / abweichungen.length;

  return {
    paare: anzahl,
    medianAbweichungMs: quantil(abweichungen, 0.5),
    p90AbweichungMs: quantil(abweichungen, 0.9),
    anteilUnter50ms: anteil(50),
    anteilUnter100ms: anteil(100),
    notenzahlDifferenz: unser.syllables.length - referenz.syllables.length,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/create/evaluate.test.ts`
Expected: PASS, 7 Tests

- [ ] **Step 5: Write the corpus manifest example and the harness**

```json
{
  "hinweis": "Kopieren nach reference-corpus.json und fuellen. Weder diese Datei noch Audio oder Referenz-.txt gehoeren ins Repo (Urheberrecht). Jedes songDir enthaelt song.txt; die Tonspur wird ueber deren #MP3-Header aufgeloest.",
  "language": "de",
  "songs": [
    { "artist": "Interpret", "title": "Titel", "songDir": "C:/Songs/Interpret - Titel" }
  ]
}
```

Speichern als `scripts/reference-corpus.example.json`.

```ts
// scripts/evaluate-pipeline.ts
// Qualitaetsnachweis: laesst die Pipeline gegen von Menschen gesyncte
// Referenzsongs laufen und meldet die Abweichung.
// Aufruf: bun run scripts/evaluate-pipeline.ts scripts/reference-corpus.json
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  compareToReference,
  type Metrics,
  parseReferenceTxt,
} from "../src/core/create/evaluate.ts";
import { runPipeline } from "../src/core/create/pipeline.ts";
import { renderSongTxt } from "../src/core/create/writeSongTxt.ts";

type Eintrag = { artist: string; title: string; songDir: string };

// Rueckfall, falls der #MP3-Header fehlt.
const AUDIO_KANDIDATEN = ["song.ogg", "song.mp3", "video.mp4", "audio.ogg", "audio.mp3"];

/**
 * Audio ueber den #MP3-Header des Referenz-.txt auflösen. Die Bibliothek
 * legt die Tonspur ueberwiegend als video.mp4 ab, nicht als song.ogg —
 * geratene Dateinamen finden dort nichts.
 */
const findeAudio = async (dir: string, referenzTxt: string): Promise<string | null> => {
  const ausHeader = /^#MP3:(.*)$/m.exec(referenzTxt)?.[1]?.trim();
  if (ausHeader) {
    try {
      await access(join(dir, ausHeader));
      return join(dir, ausHeader);
    } catch {
      // Header zeigt ins Leere, Kandidaten versuchen
    }
  }
  for (const name of AUDIO_KANDIDATEN) {
    try {
      await access(join(dir, name));
      return join(dir, name);
    } catch {
      // weiter suchen
    }
  }
  return null;
};

/**
 * Baut aus dem Referenz-.txt die Lyrics-Zeilen zurueck: Silben eines
 * Abschnitts zusammensetzen, an "- " umbrechen. Damit stimmt die
 * Silbenfolge 1:1 mit der Referenz und der Vergleich ist wohldefiniert.
 */
const lyricsAusReferenz = (referenzTxt: string): string[] => {
  const zeilen: string[] = [];
  let laufend = "";
  for (const z of referenzTxt.split("\n")) {
    const note = /^[:*FR]\s+-?\d+\s+\d+\s+-?\d+\s?(.*)$/.exec(z.trimEnd());
    if (note) {
      laufend += note[1] ?? "";
      continue;
    }
    if (z.startsWith("- ") && laufend.trim()) {
      zeilen.push(laufend.trim());
      laufend = "";
    }
  }
  if (laufend.trim()) zeilen.push(laufend.trim());
  return zeilen;
};

const main = async (): Promise<void> => {
  const manifestPfad = process.argv[2];
  if (!manifestPfad) {
    console.error("Aufruf: bun run scripts/evaluate-pipeline.ts <manifest.json>");
    process.exit(2);
  }

  const manifest = JSON.parse(await readFile(manifestPfad, "utf8")) as {
    language?: string;
    songs: Eintrag[];
  };
  const sprache = manifest.language ?? "de";
  const ergebnisse: { name: string; m: Metrics }[] = [];

  for (const song of manifest.songs) {
    const referenzTxt = await readFile(join(song.songDir, "song.txt"), "utf8");
    const referenz = parseReferenceTxt(referenzTxt);
    const audio = await findeAudio(song.songDir, referenzTxt);
    if (!audio) {
      console.error(`${song.artist} - ${song.title}: kein Audio gefunden, uebersprungen`);
      continue;
    }

    const lyricsPfad = join(song.songDir, ".eval-lyrics.txt");
    await writeFile(lyricsPfad, `${lyricsAusReferenz(referenzTxt).join("\n")}\n`, "utf8");

    const ergebnis = await Effect.runPromise(
      Effect.either(
        runPipeline({
          audioPath: audio,
          lyricsPath: lyricsPfad,
          language: sprache,
          outPath: join(song.songDir, ".eval-song-data.json"),
          device: "auto",
          onProgress: (stage, p) =>
            process.stderr.write(`\r${song.title}: ${stage} ${Math.round(p * 100)}%    `),
        }),
      ),
    );
    process.stderr.write("\n");

    if (ergebnis._tag === "Left") {
      console.error(`${song.title}: FEHLER ${ergebnis.left.kind} ${ergebnis.left.detail ?? ""}`);
      continue;
    }

    const unser = parseReferenceTxt(
      renderSongTxt(ergebnis.right, {
        artist: song.artist,
        title: song.title,
        mp3: "x.ogg",
      }),
    );
    ergebnisse.push({
      name: `${song.artist} - ${song.title}`,
      m: compareToReference(unser, referenz),
    });
  }

  if (ergebnisse.length === 0) {
    console.error("Kein Song ausgewertet.");
    process.exit(1);
  }

  console.log("");
  console.log("| Song | Paare | Median ms | p90 ms | <50ms | <100ms | Notendiff |");
  console.log("|---|---|---|---|---|---|---|");
  for (const { name, m } of ergebnisse) {
    console.log(
      `| ${name} | ${m.paare} | ${m.medianAbweichungMs.toFixed(0)} | ` +
        `${m.p90AbweichungMs.toFixed(0)} | ${(m.anteilUnter50ms * 100).toFixed(0)}% | ` +
        `${(m.anteilUnter100ms * 100).toFixed(0)}% | ${m.notenzahlDifferenz} |`,
    );
  }

  const mittel = (f: (m: Metrics) => number): number =>
    ergebnisse.reduce((s, z) => s + f(z.m), 0) / ergebnisse.length;

  console.log("");
  console.log(`Songs:             ${ergebnisse.length}`);
  console.log(`Median-Abweichung: ${mittel((m) => m.medianAbweichungMs).toFixed(0)} ms`);
  console.log(`p90-Abweichung:    ${mittel((m) => m.p90AbweichungMs).toFixed(0)} ms`);
  console.log(`Anteil <50 ms:     ${(mittel((m) => m.anteilUnter50ms) * 100).toFixed(0)}%`);
  console.log(`Anteil <100 ms:    ${(mittel((m) => m.anteilUnter100ms) * 100).toFixed(0)}%`);
};

await main();
```

- [ ] **Step 6: Ignore local corpus and artifacts**

An `.gitignore` anhängen:

```
# Bewertungs-Harness (Urheberrecht: kein Audio, keine Referenz-.txt im Repo)
scripts/reference-corpus.json
.pipeline-cache/
.eval-lyrics.txt
.eval-song-data.json
```

- [ ] **Step 7: Run the harness and record the baseline**

Run: `bun run scripts/evaluate-pipeline.ts scripts/reference-corpus.json`

Mindestens 20 Songs, über Sprachen und Tempi gemischt. Ergebnis als Nachtrag ans Design-Dokument anhängen:

```markdown
## Nachtrag: Basiswert des Bewertungs-Harness (2026-07-26)

Erster Lauf über <n> Songs mit `bun run scripts/evaluate-pipeline.ts`:

| Kennzahl | Wert |
|---|---|
| Median-Abweichung | <x> ms |
| p90-Abweichung | <y> ms |
| Anteil < 50 ms | <a> % |
| Anteil < 100 ms | <b> % |

Regressionsgrenze ab jetzt: die Median-Abweichung darf <x> ms nicht
überschreiten, der Anteil < 100 ms nicht unter <b> % fallen.
Verschlechtert sich der Wert, ist die Änderung schuld, nicht die Messung.
```

- [ ] **Step 8: Run all tests and commit**

Run: `bun test src && bun run test:py`
Expected: PASS auf beiden Seiten

```bash
git add src/core/create/evaluate.ts src/core/create/evaluate.test.ts scripts/evaluate-pipeline.ts scripts/reference-corpus.example.json .gitignore docs/superpowers/specs/2026-07-26-song-creation-pipeline-core-design.md
git commit -m "feat(create): evaluation harness against human-synced reference songs"
```

#### Nachtrag: zwei Pflichtergänzungen, vor Step 7 zu erledigen (2026-07-26)

Beides fiel während der Tasks 5 bis 9 auf und ist im Ledger vermerkt.

**A — Die Metrik muss Tonhöhen vergleichen, nicht nur Einsatzzeitpunkte.**

Wie oben entworfen misst `compareToReference` ausschließlich Onsets. Eine Melodie, die durchgehend um Halbtöne verschoben ist, erzielt damit **fehlerfreie Timing-Kennzahlen und ist trotzdem unsingbar** — die Messung könnte den Fehler prinzipiell nicht sehen. Das ist derselbe blinde Fleck, der die Beat-Konvention beinahe falsch festgeschrieben hätte.

Konkret betroffen ist `MIDI_NULLAGE = 60` in `notes.py`. Der Wert ruht auf einer Annahme: über 300 Referenzsongs liegt der Median der Song-Median-Tonhöhen bei 8, was zu „Tonhöhe 0 bedeutet C4" passt — aber ein Irrtum um eine ganze Oktave sähe genauso aus. Nur dieser Vergleich klärt es.

Erforderlich:

- `parseReferenceTxt` liest die Tonhöhe mit, die das bestehende Notenzeilen-Muster in Gruppe 3 schon erfasst und bislang verwirft. `ReferenceSong.syllables` wird damit zu `{ syllable, onsetMs, pitch }[]`.
- `Metrics` erhält zwei Felder:
  - `medianPitchOffset` — Median von (unsere Tonhöhe minus Referenz) über alle Paare. **Ein Wert ungleich null bedeutet systematische Transposition**, also eine falsche Nullage, und ist der eigentliche Prüfwert für `MIDI_NULLAGE`.
  - `anteilPitchExakt` — Anteil der Paare, die nach Abzug von `medianPitchOffset` genau übereinstimmen. Das trennt einen konstanten Versatz von echten Formfehlern der Melodie: ersterer ist eine Konstante, letzterer ein Qualitätsproblem.
- Tests für beide, auf synthetischen Paaren: identische Eingabe ergibt Offset 0 und Anteil 1; eine um drei Halbtöne verschobene Kopie ergibt Offset 3 und weiterhin Anteil 1; eine einzelne verfälschte Note senkt nur den Anteil.
- Der Bericht des Harness gibt beide Werte aus, und der Nachtrag im Design-Dokument hält sie mit fest.

**B — Die Modellpakete gehören in eine virtuelle Umgebung.**

Step 7 ist der erste und einzige Schritt des ganzen Plans, der torch, Demucs, WhisperX, SwiftF0 und librosa tatsächlich braucht — mehrere Gigabyte. Der Editable-Install aus Task 5 lief ohne aktive venv und landete in den User-Site-Packages; dasselbe mit den Modellpaketen würde das globale Python-Environment des Nutzers vollschreiben und Versionskonflikte mit allem anderen riskieren, was dort liegt.

Vor Step 7 daher eine venv anlegen und ausschließlich darin installieren:

```bash
cd python-sidecar
python -m venv .venv
.venv/Scripts/activate        # Windows; sonst: source .venv/bin/activate
python -m pip install -e ".[dev,models]"
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

`.venv/` gehört in `.gitignore` — der bestehende Eintrag von Step 6 ist entsprechend zu erweitern. Der Harness muss den Interpreter dieser venv verwenden; `runPipeline` nimmt ihn über `pythonBin` an, das genau dafür vorhanden ist.

**Reihenfolge:** A vor Step 7, sonst misst der erste Basiswert die Tonhöhen nicht und muss wiederholt werden. B ebenfalls vor Step 7, weil danach die Pakete schon am falschen Ort liegen.

**C — Ein geparkter Befund wird hier fällig.** Die Zeilenrückgewinnung in `align.py` zählt Wörter über Leerzeichen-Trennung. WhisperX kann anders tokenisieren, was die Zuordnung verschiebt *und* die Abweichungswarnung fälschlich auslöst. Sobald echte Aligner-Ausgabe vorliegt: erst ansehen, dann **einmal** informiert korrigieren — nicht vorher raten.

---

## Nach dem Plan

Erst wenn der Basiswert aus Task 12 dokumentiert ist, beginnt die Feinarbeit an `notes.py` — mit dem Harness als Regressionsschutz. Naheliegende Justierungen: Silbendauer-Verteilung innerhalb eines Wortes (derzeit gleichmäßig), Behandlung stimmloser Passagen, Umbruch-Beat relativ zur nächsten Note, Glättung der Tonhöhe über Nachbarnoten.

Teilprojekt 2 (Sidecar-Umgebung) ist der nächste Baustein. Vorher muss die Frage der Modell-Lizenzen geklärt sein — siehe „Offene Risiken" im Spec.
