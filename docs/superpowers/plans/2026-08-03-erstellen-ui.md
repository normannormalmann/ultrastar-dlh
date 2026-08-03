# Erstellen-UI Implementation Plan (Teilprojekt 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Erstellen-Ansicht bauen, die den seit TP3/TP4 fertigen, aber unbedienbaren Erstellungspfad in fünf Schritten bedienbar macht — samt Queue-Sicht, Abschluss und persistierter Queue.

**Architecture:** Ein Assistent im Renderer (`CreateView` plus fünf dumme Step-Komponenten, Zustand in einem DOM-freien Modul `createDraft.ts`) füllt einen `CreateJob` und schiebt ihn über `create:queueAdd` in die bestehende Queue aus `creations.ts`. Alles Netz- und Dateibehaftete liegt hinter fünf neuen IPC-Kanälen im Main-Prozess; alles Regelhafte liegt in reinen Modulen, die `bun test` ohne DOM und ohne GPU prüft.

**Tech Stack:** Bun, TypeScript, Effect (nur in `src/core/`), Electron (main/preload/renderer), React 19, lucide-react, Biome, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-03-erstellen-ui-design.md` — bei jedem Zweifel gilt die Spec, nicht dieser Plan.

## Global Constraints

- **Kommentare und JSDoc auf Englisch.** Bestehende deutsche Kommentare in `src/core/create/` und `src/desktop/main/creations.ts` werden nicht übersetzt und nicht gelöscht.
- **Nutzertexte im Renderer sind Deutsch** (`src/desktop/renderer/`, `lang="de"`). Keine englischen Labels, keine Übersetzung bestehender deutscher Strings.
- **Dateinamen:** Plain-TS `camelCase.ts`, React-Komponenten `PascalCase.tsx` passend zum Export, Tests `<modul>.test.ts` neben der Datei. Kein kebab-case.
- **Effect nur in `src/core/`.** `src/desktop/main/` und `src/desktop/renderer/` sind reguläres `async`/`await` und rufen Core über `Effect.runPromise(...)`.
- **Kein `Effect.runPromise` innerhalb eines `Effect.tryPromise`/`Effect.gen`** — dort wird mit `yield*` komponiert.
- **Keine neuen Abhängigkeiten.** Kein Testing-Library, kein happy-dom, kein zod. Handgeschriebene Validierung, wie im Bestand.
- **Tests:** `bun test src/pfad/zur/datei.test.ts` für einzelne Dateien, `bun test src` für alles.
- **Typprüfung:** `bunx tsc --noEmit`.
- **NIEMALS `bun run lint` aufrufen.** Das Skript ist `biome lint --write .` und schreibt **repo-weit** — es verändert dabei auch Dateien, die nicht zur Aufgabe gehören. Geprüft wird ausschließlich gezielt: `bunx biome check src/pfad/zur/datei.ts`.
- **Commit-Nachrichten** enden auf `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Arbeitszweig:** `feat/erstellen-ui`, von `main`.

---

## Dateistruktur

**Neu:**

| Datei | Verantwortung |
|---|---|
| `src/core/create/job.ts` | Der `CreateJob`-Typ — Core-Wahrheit, damit `core/storage` ihn kennen darf |
| `src/core/create/probe.ts` | Spieldauer einer Quelle über yt-dlp bzw. ffmpeg |
| `src/core/storage/createQueue.ts` | `create-queue.json` laden und speichern |
| `src/desktop/main/coverCandidates.ts` | Cover-Kandidaten beschaffen, ablegen, aufräumen |
| `src/desktop/renderer/views/CreateView.tsx` | Assistent-Hülle: Schrittleiste, Umgebungs-Banner, Navigation |
| `src/desktop/renderer/views/createDraft.ts` | DOM-frei: Entwurf, Validierung, Job-Erzeugung, Duplikat-Erkennung |
| `src/desktop/renderer/components/create/StepSong.tsx` | Schritt 1 |
| `src/desktop/renderer/components/create/StepSource.tsx` | Schritt 2 |
| `src/desktop/renderer/components/create/StepLyrics.tsx` | Schritt 3 |
| `src/desktop/renderer/components/create/StepCover.tsx` | Schritt 4 |
| `src/desktop/renderer/components/create/StepReview.tsx` | Schritt 5 |
| `src/desktop/renderer/components/CreationRow.tsx` | Eine Erstellungs-Zeile samt Abschluss-Aufklappen |

**Geändert:** `src/core/create/lyrics.ts`, `src/core/create/lrclib.ts`, `src/core/create/packageSong.ts`, `src/desktop/main/creations.ts`, `src/desktop/main/environment.ts`, `src/desktop/main/ipc.ts`, `src/desktop/main/index.ts`, `src/desktop/preload/index.ts`, `src/desktop/shared/ipcContract.ts`, `src/desktop/renderer/App.tsx`, `src/desktop/renderer/components/Sidebar.tsx`, `src/desktop/renderer/views/QueueView.tsx`, `e2e/app.spec.ts`.

---

### Task 1: `resolveLyrics` — offene Textfragen anwenden

`normalizeLyrics` meldet heute `offeneFragen`, aber niemand kann sie beantworten. Der Durchlauf über die Zeilen wird so umgebaut, dass **eine** Funktion beide Fälle bedient: ohne Antworten sammelt sie Fragen, mit Antworten wendet sie sie an. Zwei getrennte Durchläufe wären zwei Wahrheiten über die Textaufbereitung.

**Files:**
- Modify: `src/core/create/lyrics.ts`
- Test: `src/core/create/lyrics.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type Antwort = { kind: "repeat_scope"; zeilenIndex: number; wahl: "zeile" | "block" } | { kind: "chorus_reference"; zeilenIndex: number; wahl: "einsetzen" | "verwerfen" }`
  - `resolveLyrics(raw: string, antworten: Antwort[]): string[]` — wirft `Error` bei unbeantworteter Frage und bei `"einsetzen"` ohne Refrain-Vorlage.
  - `normalizeLyrics(raw: string): NormalizedLyrics` bleibt im Verhalten unverändert.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `src/core/create/lyrics.test.ts` anhängen (Import in der Datei um `resolveLyrics` erweitern):

```ts
describe("resolveLyrics", () => {
  it("doppelt nur die Zeile", () => {
    expect(
      resolveLyrics("Zeile A\nZeile B 2x", [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" },
      ]),
    ).toEqual(["Zeile A", "Zeile B", "Zeile B"]);
  });

  it("doppelt den ganzen Block", () => {
    expect(
      resolveLyrics("Zeile A\nZeile B (2x)", [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "block" },
      ]),
    ).toEqual(["Zeile A", "Zeile B", "Zeile A", "Zeile B"]);
  });

  it("setzt den Refrain ein", () => {
    const raw = "Ref 1\nRef 2\n\nStrophe\n\n[Chorus]";
    expect(
      resolveLyrics(raw, [
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "einsetzen" },
      ]),
    ).toEqual(["Ref 1", "Ref 2", "Strophe", "Ref 1", "Ref 2"]);
  });

  it("verwirft den Verweis auf Wunsch", () => {
    const raw = "Ref 1\nRef 2\n\nStrophe\n\n[Chorus]";
    expect(
      resolveLyrics(raw, [
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "verwerfen" },
      ]),
    ).toEqual(["Ref 1", "Ref 2", "Strophe"]);
  });

  it("lehnt einsetzen ohne Vorlage ab", () => {
    // Nur der Verweis, sonst nichts: erst dann ist es ein alleinstehender
    // Refrain-Verweis. Folgt eine gesungene Zeile ("[Chorus]\nStrophe"),
    // ist die Klammerzeile eine Ueberschrift und wird schlicht entfernt --
    // es entsteht gar keine Rueckfrage, und eine Antwort waere ein No-op.
    expect(() =>
      resolveLyrics("[Chorus]", [
        { kind: "chorus_reference", zeilenIndex: 0, wahl: "einsetzen" },
      ]),
    ).toThrow(/nichts einzusetzen/);
  });

  it("lehnt eine unbeantwortete Frage ab", () => {
    expect(() => resolveLyrics("Zeile A\nZeile B 2x", [])).toThrow(
      /Unbeantwortete/,
    );
  });

  it("beantwortet mehrere Fragen in einem Text", () => {
    const raw = "A\nB 2x\n\nC\n\n[Chorus]";
    expect(normalizeLyrics(raw).offeneFragen).toHaveLength(2);
    expect(
      resolveLyrics(raw, [
        { kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" },
        { kind: "chorus_reference", zeilenIndex: 5, wahl: "einsetzen" },
      ]),
    ).toEqual(["A", "B", "B", "C", "A", "B", "B"]);
  });
});
```

Der letzte Fall hält fest, was der geteilte Durchlauf bedeutet: die Refrain-Vorlage ist der erste zusammenhängende Block **nach** dem Anwenden der vorherigen Antworten, also inklusive der gedoppelten Zeile. Das ist gewollt — die Vorlage soll das sein, was tatsächlich gesungen wird.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/core/create/lyrics.test.ts`
Expected: FAIL — `resolveLyrics is not a function`.

- [ ] **Step 3: `lyrics.ts` umbauen**

Die Konstanten `LRC`, `WIEDERHOLUNG`, `KLAMMER_MARKER`, `IST_REFRAIN`, der Typ `Eintrag` und die Helfer `aktuellerBlock`/`refrainBlock` bleiben unverändert. Der Körper von `normalizeLyrics` wird durch den geteilten Durchlauf ersetzt:

```ts
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
 * Mehrdeutigkeiten als offene Fragen -- entscheidet sie aber nicht:
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
```

- [ ] **Step 4: Tests laufen lassen**

Run: `bun test src/core/create/lyrics.test.ts`
Expected: PASS — die sieben neuen **und** alle bestehenden `normalizeLyrics`-Tests.

- [ ] **Step 5: Prüfen und committen**

```bash
bunx biome check src/core/create/lyrics.ts src/core/create/lyrics.test.ts
bunx tsc --noEmit
git add src/core/create/lyrics.ts src/core/create/lyrics.test.ts
git commit -m "feat(create): resolveLyrics applies the UI's answers to open questions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `probe.ts` — Spieldauer einer Quelle

Schritt 3 braucht die Spieldauer für LRCLIB. Beim Suchtreffer kommt sie gratis mit; bei eingefügtem Link und lokaler Datei muss sie ermittelt werden.

**Files:**
- Create: `src/core/create/probe.ts`
- Test: `src/core/create/probe.test.ts`

**Interfaces:**
- Consumes: `MediaQuelle` aus `src/core/create/media.ts`.
- Produces:
  - `dauerAusYtDlp(stdout: string): number | null`
  - `dauerAusFfmpeg(stderr: string): number | null`
  - `dauerSekunden(quelle: MediaQuelle): Effect.Effect<number | null, never>`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

`src/core/create/probe.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { dauerAusFfmpeg, dauerAusYtDlp, dauerSekunden } from "./probe.ts";

// Real tool output, not invented.
const YTDLP = "213.0\n";
const FFMPEG = `ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers
Input #0, mp3, from 'song.mp3':
  Metadata:
    title           : Rock Me Amadeus
  Duration: 00:03:33.42, start: 0.025057, bitrate: 320 kb/s
At least one output file must be specified
`;

describe("dauerAusYtDlp", () => {
  it("liest die nackte Sekundenzahl", () => {
    expect(dauerAusYtDlp(YTDLP)).toBe(213);
  });

  it("nimmt die erste Zeile bei mehreren", () => {
    expect(dauerAusYtDlp("213.0\n42.0\n")).toBe(213);
  });

  it("liefert null bei NA", () => {
    expect(dauerAusYtDlp("NA\n")).toBeNull();
  });

  it("liefert null bei leerer Ausgabe", () => {
    expect(dauerAusYtDlp("")).toBeNull();
  });
});

describe("dauerAusFfmpeg", () => {
  it("liest Duration aus dem Banner", () => {
    expect(dauerAusFfmpeg(FFMPEG)).toBeCloseTo(213.42, 2);
  });

  it("liefert null ohne Duration", () => {
    expect(dauerAusFfmpeg("ffmpeg version n7.1\nInvalid data found\n")).toBeNull();
  });

  it("liefert null bei Duration N/A", () => {
    expect(dauerAusFfmpeg("  Duration: N/A, bitrate: N/A\n")).toBeNull();
  });
});

describe("dauerSekunden", () => {
  // Bails out before spawning, so this test starts no process.
  it("weist alles ab, was keine http(s)-URL ist", async () => {
    for (const url of ["--exec=echo pwned", "file:///etc/passwd", "keine url"]) {
      expect(
        await Effect.runPromise(dauerSekunden({ kind: "youtube", url })),
      ).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/core/create/probe.test.ts`
Expected: FAIL — `Cannot find module './probe.ts'`.

- [ ] **Step 3: `probe.ts` schreiben**

```ts
// src/core/create/probe.ts
// Playing time of a source. Only needed for the two side entrances (pasted
// link, local file); a search hit already carries its duration. The LRCLIB
// endpoint matches on duration, so a guessed number is worse than none -
// every failure path returns null.
import { spawn } from "node:child_process";
import { Effect } from "effect";
import type { MediaQuelle } from "./media.ts";

const PROBE_TIMEOUT_MS = 30_000;
const FFMPEG_DAUER = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;

/** `yt-dlp --print duration` prints bare seconds, one line per video. */
export const dauerAusYtDlp = (stdout: string): number | null => {
  const erste = stdout.trim().split("\n")[0]?.trim() ?? "";
  const wert = Number.parseFloat(erste);
  return Number.isFinite(wert) && wert > 0 ? wert : null;
};

/**
 * ffmpeg has no machine-readable duration output; it sits in the banner on
 * stderr. Deliberately text parsing with a null fallback: if ffmpeg ever
 * changes the banner, step 3 loses its suggestion - it must not receive a
 * wrong number.
 */
export const dauerAusFfmpeg = (stderr: string): number | null => {
  const t = FFMPEG_DAUER.exec(stderr);
  if (!t) return null;
  const [, h, m, s, ms] = t;
  const sek =
    Number(h) * 3600 + Number(m) * 60 + Number(s) + (ms ? Number(`0.${ms}`) : 0);
  return sek > 0 ? sek : null;
};

/**
 * Resolves with both streams regardless of the exit code: `ffmpeg -i <file>`
 * without an output file always exits non-zero ("At least one output file must
 * be specified") - and prints the duration before it does.
 */
const laufe = (
  befehl: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const kind = spawn(befehl, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const uhr = setTimeout(() => {
      kind.kill();
      reject(new Error(`${befehl}: Zeitueberschreitung bei der Dauer-Probe.`));
    }, PROBE_TIMEOUT_MS);
    kind.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    kind.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    kind.on("error", (e) => {
      clearTimeout(uhr);
      reject(e);
    });
    kind.on("close", () => {
      clearTimeout(uhr);
      resolve({ stdout, stderr });
    });
  });

/**
 * The URL reaches argv as a *positional* argument, so a value starting with
 * "-" would be read as an option ("--exec=..." being the ugly case), and
 * yt-dlp's extractors accept far more than http. Both holes close here.
 */
const istWebUrl = (roh: string): boolean => {
  try {
    const u = new URL(roh);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * yt-dlp and ffmpeg live on PATH: managedBinDir() is prepended by the desktop
 * main process, same as in media.ts.
 */
export const dauerSekunden = (
  quelle: MediaQuelle,
): Effect.Effect<number | null, never> =>
  Effect.catchAll(
    Effect.tryPromise(async () => {
      if (quelle.kind === "youtube") {
        if (!istWebUrl(quelle.url)) return null;
        const { stdout } = await laufe("yt-dlp", [
          "--print",
          "duration",
          "--skip-download",
          "--no-warnings",
          // Nothing after this is read as a flag.
          "--",
          quelle.url,
        ]);
        return dauerAusYtDlp(stdout);
      }
      // No "--" for ffmpeg: it has no argv terminator, and the path sits in
      // the value position of -i, which ffmpeg consumes as a filename
      // whatever it starts with. A "--" here would BE the filename.
      const { stderr } = await laufe("ffmpeg", ["-i", quelle.pfad]);
      return dauerAusFfmpeg(stderr);
    }),
    () => Effect.succeed(null),
  );
```

- [ ] **Step 4: Tests laufen lassen**

Run: `bun test src/core/create/probe.test.ts`
Expected: PASS (7 Tests).

- [ ] **Step 5: Prüfen und committen**

```bash
bunx biome check src/core/create/probe.ts src/core/create/probe.test.ts
bunx tsc --noEmit
git add src/core/create/probe.ts src/core/create/probe.test.ts
git commit -m "feat(create): probe the playing time of a link or a local file

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `lrclib.ts` auf reine Netzabfrage umbauen

`holeSyncedLyrics` schreibt heute in ein Songverzeichnis, das es zum Zeitpunkt der Abfrage noch nicht gibt — und kein Aufrufer existiert. Der Assistent braucht den Text, nicht eine Datei.

**Files:**
- Modify: `src/core/create/lrclib.ts`
- Test: `src/core/create/lrclib.test.ts` (umschreiben, nicht ergänzen)

**Interfaces:**
- Consumes: nichts.
- Produces: `fetchSyncedLyrics(a: LrclibAnfrage): Promise<string | null>` mit `LrclibAnfrage = { artist: string; title: string; durationSec: number; fetchFn?: typeof fetch }`. `holeSyncedLyrics` und `cachedLyricsPfad` verschwinden.

- [ ] **Step 1: Tests umschreiben**

`src/core/create/lrclib.test.ts` vollständig ersetzen:

```ts
import { describe, expect, it } from "bun:test";
import { fetchSyncedLyrics } from "./lrclib.ts";

const antwort = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as unknown as Response;

// Bun's `typeof fetch` also carries `preconnect`; an attrappe only needs the
// call signature. Same cast as in coverArtArchive.test.ts and media.test.ts.
const fake = (
  f: (url: string | URL | Request) => Promise<Response>,
): typeof fetch => f as unknown as typeof fetch;

const anfrage = {
  artist: "Falco",
  title: "Rock Me Amadeus",
  durationSec: 213.4,
};

describe("fetchSyncedLyrics", () => {
  it("liefert die synchronisierten Lyrics", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () =>
        antwort({ syncedLyrics: "[00:12.00]Er war ein Punker" }),
      ),
    });
    expect(text).toBe("[00:12.00]Er war ein Punker");
  });

  it("rundet die Dauer auf ganze Sekunden", async () => {
    let gesehen = "";
    await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async (url) => {
        gesehen = String(url);
        return antwort({ syncedLyrics: "x" });
      }),
    });
    expect(gesehen).toContain("duration=213");
    expect(gesehen).toContain("artist_name=Falco");
  });

  it("liefert null ohne synchronisierte Lyrics", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => antwort({ plainLyrics: "ohne Zeitstempel" })),
    });
    expect(text).toBeNull();
  });

  it("liefert null bei 404", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => antwort({}, false)),
    });
    expect(text).toBeNull();
  });

  it("liefert null, wenn das Netz wegbricht", async () => {
    const text = await fetchSyncedLyrics({
      ...anfrage,
      fetchFn: fake(async () => {
        throw new Error("ENOTFOUND");
      }),
    });
    expect(text).toBeNull();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/core/create/lrclib.test.ts`
Expected: FAIL — `fetchSyncedLyrics` existiert nicht.

- [ ] **Step 3: `lrclib.ts` ersetzen**

```ts
// src/core/create/lrclib.ts
// Zweite Evidenzquelle fuer das Alignment: synchronisierte Lyrics (.lrc)
// von lrclib.net. Bewusst nur der exakte Get-Endpunkt (Artist, Titel,
// Dauer; der Server toleriert +-2 s) -- eine Fuzzy-Suche koennte die
// falsche Edition liefern, und ein falsches .lrc setzt falsche Pfosten.
//
// Reine Netzabfrage: Aufrufer ist die Erstellen-UI, und zu deren Zeitpunkt
// existiert noch kein Songverzeichnis, in das man cachen koennte. Der Text
// reist stattdessen im Job mit.

export type LrclibAnfrage = {
  artist: string;
  title: string;
  durationSec: number;
  /** Tests injizieren hier einen Ersatz -- nie gegen das echte Netz testen. */
  fetchFn?: typeof fetch;
};

/**
 * Holt synchronisierte Lyrics. Jeder Fehlschlag (kein Treffer, nur
 * unsynchronisierter Text, Netz weg) liefert null -- eine fehlende .lrc ist
 * nie ein Abbruchgrund, nur eine fehlende zweite Evidenzquelle.
 */
export const fetchSyncedLyrics = async (
  a: LrclibAnfrage,
): Promise<string | null> => {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", a.artist);
  url.searchParams.set("track_name", a.title);
  url.searchParams.set("duration", String(Math.round(a.durationSec)));

  const f = a.fetchFn ?? fetch;
  try {
    const antwort = await f(url.toString(), {
      // lrclib.net bittet Clients, sich zu identifizieren.
      headers: {
        "User-Agent":
          "UltraStar-CLI (https://github.com/normannormalmann/UltraStar-CLI)",
      },
    });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as { syncedLyrics?: string | null };
    return daten.syncedLyrics ? daten.syncedLyrics : null;
  } catch {
    return null;
  }
};
```

- [ ] **Step 4: Den einen Aufrufer der alten API umbauen**

`scripts/evaluate-pipeline.ts` nutzt beide entfallenden Funktionen (Import in Zeile 13, Aufrufe in `main`). Es braucht weiterhin eine **Datei**, weil `runPipeline` einen `syncedLyricsPath` nimmt — das Cachen wandert also ins Skript. Dateiname bleibt `synced-lyrics.lrc`, damit .lrc aus früheren Korpusläufen weiter zählen.

```ts
// Import ersetzen:
import { fetchSyncedLyrics } from "../src/core/create/lrclib.ts";

// Neben den Typen:
const LRC_DATEI = "synced-lyrics.lrc";

const gecachteLrc = async (songDir: string): Promise<string | null> => {
  const pfad = join(songDir, LRC_DATEI);
  try {
    await access(pfad);
    return pfad;
  } catch {
    return null;
  }
};

// In main, der Cache-Block:
let lrcPfad = await gecachteLrc(song.songDir);
let ergebnis = await lauf(lrcPfad ?? undefined);
process.stderr.write("\n");

if (ergebnis._tag === "Right" && !lrcPfad) {
  const lrcText = await fetchSyncedLyrics({
    artist: song.artist,
    title: song.title,
    durationSec: ergebnis.right.meta.durationSec,
  });
  if (lrcText) {
    lrcPfad = join(song.songDir, LRC_DATEI);
    await writeFile(lrcPfad, lrcText, "utf8");
  }
  if (lrcPfad) { /* ... unveraendert: neu ausrichten ... */ }
}
```

`access`, `writeFile` und `join` sind dort schon importiert.

- [ ] **Step 5: Tests laufen lassen und prüfen, dass niemand mehr die alte API nutzt**

```bash
bun test src/core/create/lrclib.test.ts scripts/evaluate-pipeline.test.ts
grep -rn "holeSyncedLyrics\|cachedLyricsPfad" src/ scripts/ python-sidecar/ e2e/
```
Expected: Tests PASS; der `grep` findet **nichts** mehr.

- [ ] **Step 6: Prüfen und committen**

`scripts/evaluate-pipeline.ts` scheitert an `biome check` schon vor dieser Änderung (unsortierte Importe, nie formatierte Langzeilen) — **nicht** mit `--write` daraufgehen, das schreibt die ganze Datei um. Nur die beiden lrclib-Dateien prüfen.

```bash
bunx biome check src/core/create/lrclib.ts src/core/create/lrclib.test.ts
bunx tsc --noEmit
git add src/core/create/lrclib.ts src/core/create/lrclib.test.ts scripts/evaluate-pipeline.ts
git commit -m "refactor(create): lrclib returns the lyrics text instead of writing a file

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `CreateJob` in den Core, Queue auf Platte

`core/storage/createQueue.ts` muss den Job-Typ kennen. Er liegt heute in `desktop/shared/ipcContract.ts` — Core darf nicht auf Desktop zeigen. Also wandert der Typ in den Core, und der Vertrag re-exportiert ihn, genau wie er `Song` aus `core/api/usdb/search.ts` re-exportiert.

**Files:**
- Create: `src/core/create/job.ts`
- Create: `src/core/storage/createQueue.ts`
- Create: `src/core/storage/createQueue.test.ts`
- Modify: `src/desktop/shared/ipcContract.ts:85-97`

**Interfaces:**
- Consumes: `MediaQuelle` aus `media.ts`.
- Produces:
  - `type CreateJob = { id: string; quelle: MediaQuelle; language: string; artist: string; title: string; lyricsText: string; syncedLyricsText?: string; coverWahl?: { pfad: string } | "keins"; genre?: string; year?: number; bpm?: number }`
  - `loadCreateQueue: Effect.Effect<CreateJob[], Error>`
  - `saveCreateQueue(jobs: CreateJob[]): Effect.Effect<void, Error>`
  - `ipcContract.ts` exportiert `CreateJobRequest` weiter — als Alias auf `CreateJob`.

- [ ] **Step 1: `job.ts` schreiben**

```ts
// src/core/create/job.ts
// One queued song creation. Lives in core rather than in the IPC contract
// because core/storage persists it: core must not depend on desktop/.
import type { MediaQuelle } from "./media.ts";

export type CreateJob = {
  id: string;
  quelle: MediaQuelle;
  language: string;
  /** artist/title also drive the folder name. */
  artist: string;
  title: string;
  /** The resolved lines, joined by "\n". creations.ts writes them to the job dir. */
  lyricsText: string;
  /** LRCLIB's .lrc, if there was a hit - the second evidence source. */
  syncedLyricsText?: string;
  /** Step 4's result. Absent means "decide automatically", NOT "no image". */
  coverWahl?: { pfad: string } | "keins";
  genre?: string;
  year?: number;
  bpm?: number;
};
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`src/core/storage/createQueue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { CreateJob } from "../create/job.ts";
import { loadCreateQueue, saveCreateQueue } from "./createQueue.ts";
import { resolveDataFilePath } from "./paths.ts";

const zuvor = process.env.ULTRASTAR_APP_NAME;

const job = (id: string): CreateJob => ({
  id,
  quelle: { kind: "youtube", url: `https://youtu.be/${id}` },
  language: "Deutsch",
  artist: "Falco",
  title: "Rock Me Amadeus",
  lyricsText: "Er war ein Punker",
});

beforeEach(() => {
  // env-paths derives the cache dir from the app name; a unique name per test
  // keeps the real user cache untouched.
  process.env.ULTRASTAR_APP_NAME = `ultrastar-test-${Date.now()}-${Math.round(
    Math.random() * 1e6,
  )}`;
});

afterEach(() => {
  process.env.ULTRASTAR_APP_NAME = zuvor;
});

describe("createQueue", () => {
  it("liefert eine leere Queue, wenn keine Datei existiert", async () => {
    expect(await Effect.runPromise(loadCreateQueue)).toEqual([]);
  });

  it("speichert und liest zurueck", async () => {
    const jobs = [job("a"), job("b")];
    await Effect.runPromise(saveCreateQueue(jobs));
    expect(await Effect.runPromise(loadCreateQueue)).toEqual(jobs);
  });

  it("liefert eine leere Queue bei kaputtem JSON", async () => {
    await Effect.runPromise(saveCreateQueue([job("a")]));
    const datei = await Effect.runPromise(
      resolveDataFilePath("create-queue.json"),
    );
    await writeFile(datei, "{kein json");
    expect(await Effect.runPromise(loadCreateQueue)).toEqual([]);
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/core/storage/createQueue.test.ts`
Expected: FAIL — `Cannot find module './createQueue.ts'`.

- [ ] **Step 4: `createQueue.ts` schreiben**

Bewusst Zeile für Zeile am Vorbild `src/core/storage/queue.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { CreateJob } from "../create/job.ts";
import { resolveDataFilePath } from "./paths.ts";

const DATEI = "create-queue.json";

export const loadCreateQueue: Effect.Effect<CreateJob[], Error> = Effect.gen(
  function* () {
    const filePath = yield* resolveDataFilePath(DATEI);
    return yield* Effect.catchAll(
      Effect.tryPromise({
        try: async () => {
          const text = await readFile(filePath, "utf8");
          const json = JSON.parse(text);
          return Array.isArray(json) ? (json as CreateJob[]) : [];
        },
        catch: (e) =>
          e instanceof Error ? e : new Error("Failed to load create queue"),
      }),
      () => Effect.succeed([] as CreateJob[]),
    );
  },
);

export const saveCreateQueue = (
  jobs: CreateJob[],
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const filePath = yield* resolveDataFilePath(DATEI);
    yield* Effect.tryPromise({
      try: async () => writeFile(filePath, JSON.stringify(jobs, null, 2)),
      catch: (e) =>
        e instanceof Error ? e : new Error("Failed to save create queue"),
    });
  });
```

- [ ] **Step 5: Den Vertrag auf den Core-Typ umstellen**

In `src/desktop/shared/ipcContract.ts` den `CreateJobRequest`-Block (Zeilen 85–97) löschen. Bei den Core-Importen ergänzen:

```ts
import type { CreateJob } from "../../core/create/job.ts";
```
und beim Re-Export:
```ts
export type { CreateJob };
/** Wire name kept for the existing callers. */
export type CreateJobRequest = CreateJob;
```

- [ ] **Step 6: Tests und Typen prüfen**

```bash
bun test src/core/storage/createQueue.test.ts
bunx tsc --noEmit
```
Expected: Tests PASS. `tsc` meldet jetzt Fehler in `creations.ts` und `ipc.ts`, weil `lyricsPath`/`syncedLyricsPath` verschwunden sind — **erwartet**, behoben in Task 6. Fehlerliste notieren, weitermachen.

- [ ] **Step 7: Committen**

```bash
bunx biome check src/core/create/job.ts src/core/storage/createQueue.ts src/core/storage/createQueue.test.ts src/desktop/shared/ipcContract.ts
git add src/core/create/job.ts src/core/storage/createQueue.ts src/core/storage/createQueue.test.ts src/desktop/shared/ipcContract.ts
git commit -m "feat(create): the job type moves to core and the queue gets a file

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `assemblePackage` nimmt die Bildwahl an

Heute entscheidet der Paketbau das Cover selbst (`packageSong.ts:119`). Mit der Bildwahl in Schritt 4 kommt die Entscheidung von außen — ohne dass der kopflose Gebrauch bricht.

**Files:**
- Modify: `src/core/create/packageSong.ts:35-43,111-141`
- Test: `src/core/create/packageSong.test.ts`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `PackageOptions.coverWahl?: { pfad: string } | "keins"`. Gesetzt → kein `findCover`-Aufruf. `"keins"` → kein `cover.jpg`, kein `#COVER`. Fehlt → Verhalten wie bisher.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `src/core/create/packageSong.test.ts` anhängen. **Wichtig:** die Datei hat schon Helfer, um `jobDir`, `medien` und `songData` aufzubauen — deren Namen aus der Datei übernehmen, statt neue zu erfinden. Im Folgenden heißt der Helfer, der ein vollständiges Optionsobjekt liefert, `basisOptionen()`; existiert er nicht unter diesem Namen, wird er aus dem vorhandenen Aufbau der bestehenden Tests extrahiert (kleines Refactoring, gleiches Verhalten).

```ts
it("fragt bei gesetzter coverWahl nicht das Cover Art Archive", async () => {
  let gefragt = false;
  const bild = join(jobDir, "eigenes.jpg");
  await writeFile(bild, "JPEGDATEN");
  const ergebnis = await Effect.runPromise(
    assemblePackage({
      ...basisOptionen(),
      coverWahl: { pfad: bild },
      deps: {
        findCoverFn: () => {
          gefragt = true;
          return Effect.succeed(null);
        },
      },
    }),
  );
  expect(gefragt).toBe(false);
  expect(await readFile(join(ergebnis.songDir, "cover.jpg"), "utf8")).toBe(
    "JPEGDATEN",
  );
  expect(await readFile(join(ergebnis.songDir, "song.txt"), "utf8")).toContain(
    "#COVER:cover.jpg",
  );
});

it("schreibt bei coverWahl keins kein Bild und kein #COVER", async () => {
  const ergebnis = await Effect.runPromise(
    assemblePackage({ ...basisOptionen(), coverWahl: "keins" }),
  );
  expect(existsSync(join(ergebnis.songDir, "cover.jpg"))).toBe(false);
  expect(
    await readFile(join(ergebnis.songDir, "song.txt"), "utf8"),
  ).not.toContain("#COVER");
});

it("warnt, wenn das gewaehlte Bild verschwunden ist", async () => {
  const ergebnis = await Effect.runPromise(
    assemblePackage({
      ...basisOptionen(),
      coverWahl: { pfad: join(jobDir, "gibtsnicht.jpg") },
    }),
  );
  // Deliberately not just "ohne Bild": the old "Kein Cover gefunden"
  // warning ends in those words too, so this test would pass unimplemented.
  expect(ergebnis.warnungen.join(" ")).toContain("Gewaehltes Bild");
  expect(existsSync(join(ergebnis.songDir, "cover.jpg"))).toBe(false);
});
```

Der Helfer heißt in der Datei `basis(library, jobDir)` neben `aufbau()`; `existsSync` ist dort nicht importiert, `readdir` schon — beides aus der Datei übernehmen statt neu einzuführen.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/core/create/packageSong.test.ts`
Expected: FAIL — `coverWahl` ist kein bekanntes Feld.

- [ ] **Step 3: `PackageOptions` erweitern**

```ts
export type PackageOptions = {
  songData: SongData;
  medien: AcquiredMedia;
  meta: PackageMeta;
  libraryDir: string;
  layout: FolderLayout;
  jobDir: string;
  /**
   * The UI's image choice. Absent means "decide automatically" (the findCover
   * path below), NOT "no image" - that is what "keins" is for.
   */
  coverWahl?: { pfad: string } | "keins";
  deps?: PackageDeps;
};
```

- [ ] **Step 4: Den Cover-Block ersetzen**

Zeilen 117–123 (`const roh = …` bis `if (!hatCover) …`) werden zu:

```ts
    // The Cover Art Archive outranks the thumbnail: a real album cover is
    // square and unlettered, a video thumbnail is neither. With an explicit
    // choice from the UI that ranking is already settled - asking the network
    // again would be a second, contradicting decision.
    const wahl = opts.coverWahl;
    const gewaehltFehlt = typeof wahl === "object" && !existsSync(wahl.pfad);
    if (gewaehltFehlt) {
      warnungen.push("Gewaehltes Bild nicht mehr vorhanden - Paket ohne Bild.");
    }
    const gewaehlterPfad =
      typeof wahl === "object" && !gewaehltFehlt ? wahl.pfad : null;

    const roh =
      wahl === undefined
        ? yield* findCoverFn(opts.meta.artist, opts.meta.title)
        : null;
    // An empty body would write a 0-byte cover.jpg and still set #COVER.
    const gefunden = roh !== null && roh.length > 0 ? roh : null;
    const kandidat =
      wahl === undefined ? (opts.medien.coverKandidat ?? null) : null;
    const hatCover =
      gewaehlterPfad !== null || gefunden !== null || kandidat !== null;
    if (!hatCover && wahl === undefined) {
      warnungen.push("Kein Cover gefunden - Paket ohne Bild.");
    }
```

Und im Schreibblock die Zeilen 137–141:

```ts
        if (gewaehlterPfad) {
          await copyFile(gewaehlterPfad, join(rohbau, "cover.jpg"));
        } else if (gefunden) {
          await writeFile(join(rohbau, "cover.jpg"), gefunden);
        } else if (kandidat) {
          await copyFile(kandidat, join(rohbau, "cover.jpg"));
        }
```

- [ ] **Step 5: Tests laufen lassen**

Run: `bun test src/core/create/packageSong.test.ts`
Expected: PASS — die drei neuen **und** alle bestehenden Fälle; der Altfall „kein Cover gefunden" läuft mit `coverWahl: undefined` und muss unverändert grün sein.

- [ ] **Step 6: Prüfen und committen**

```bash
bunx biome check src/core/create/packageSong.ts src/core/create/packageSong.test.ts
git add src/core/create/packageSong.ts src/core/create/packageSong.test.ts
git commit -m "feat(create): the package build accepts an explicit cover choice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Die Queue schreibt Text und meldet das Ergebnis zurück

Der Job trägt Text statt Pfade; der Worker will Pfade. Und die Abschluss-Ansicht braucht `songDir`, `dirName` und `lowConfidence` im Eintrag.

**Files:**
- Modify: `src/desktop/main/creations.ts`
- Modify: `src/desktop/main/ipc.ts:69-100`
- Modify: `src/desktop/shared/ipcContract.ts` (`CreationEntry`)
- Test: `src/desktop/main/creations.test.ts`

**Interfaces:**
- Consumes: `CreateJob` (Task 4).
- Produces:
  - `CreationsDeps.schreibeJobDateien: (job: CreateJobRequest, jobDir: string) => Promise<{ lyricsPath: string; syncedLyricsPath?: string }>`
  - `CreationsDeps.assemble` liefert zusätzlich `lowConfidence: boolean`.
  - `CreationEntry` bekommt `songDir?: string`, `dirName?: string`, `lowConfidence?: boolean`.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `src/desktop/main/creations.test.ts` anhängen. Die Datei hat bereits eine Dep-Fabrik und einen Beispieljob; im Folgenden heißen sie `basisDeps()`, `basisJob()` und `basisWorker()` — die tatsächlichen Namen aus der Datei übernehmen. `basisDeps()` bekommt Standardwerte für die neuen Deps (`schreibeJobDateien` schreibt nichts und liefert Pfade, `assemble` liefert `lowConfidence: false`).

```ts
it("schreibt Liedtext und .lrc in den jobDir und reicht die Pfade weiter", async () => {
  const geschrieben: string[] = [];
  let gesehen: WorkerJob | null = null;
  const c = createCreations({
    ...basisDeps(),
    schreibeJobDateien: async (job, jobDir) => {
      geschrieben.push(job.lyricsText);
      if (job.syncedLyricsText !== undefined) {
        geschrieben.push(job.syncedLyricsText);
      }
      return {
        lyricsPath: join(jobDir, "lyrics.txt"),
        syncedLyricsPath:
          job.syncedLyricsText === undefined
            ? undefined
            : join(jobDir, "synced.lrc"),
      };
    },
    newWorker: () => ({
      submitJob: async (j: WorkerJob) => {
        gesehen = j;
      },
      cancelCurrentJob: () => {},
      shutdown: async () => {},
      isAlive: () => true,
    }),
  });
  c.queueAdd([
    { ...basisJob(), lyricsText: "Zeile eins", syncedLyricsText: "[00:01.00]x" },
  ]);
  await c.start();
  expect(geschrieben).toEqual(["Zeile eins", "[00:01.00]x"]);
  expect(gesehen?.lyricsPath).toContain("lyrics.txt");
  expect(gesehen?.syncedLyricsPath).toContain("synced.lrc");
});

it("traegt songDir, dirName und lowConfidence in den fertigen Eintrag", async () => {
  const c = createCreations({
    ...basisDeps(),
    assemble: async () => ({
      songDir: "J:/Songs/Falco - Rock Me Amadeus",
      dirName: "Falco - Rock Me Amadeus",
      warnungen: [],
      lowConfidence: true,
    }),
  });
  c.queueAdd([basisJob()]);
  await c.start();
  const e = c.entriesForTests()[0];
  expect(e?.status).toBe("completed");
  expect(e?.songDir).toBe("J:/Songs/Falco - Rock Me Amadeus");
  expect(e?.dirName).toBe("Falco - Rock Me Amadeus");
  expect(e?.lowConfidence).toBe(true);
});

it("macht den Job zum Fehler, wenn das Schreiben des Texts scheitert", async () => {
  const c = createCreations({
    ...basisDeps(),
    schreibeJobDateien: async () => {
      throw new Error("Platte voll");
    },
  });
  c.queueAdd([basisJob()]);
  await c.start();
  const e = c.entriesForTests()[0];
  expect(e?.status).toBe("failed");
  expect(e?.error).toContain("Platte voll");
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/desktop/main/creations.test.ts`
Expected: FAIL — `schreibeJobDateien` unbekannt, `lowConfidence` fehlt.

- [ ] **Step 3: `CreationEntry` erweitern**

In `src/desktop/shared/ipcContract.ts`:

```ts
export type CreationEntry = {
  id: string;
  artist?: string;
  title?: string;
  status: CreationStatus;
  /** Pipeline stage of the running job (separate, transcribe, align, ...). */
  stage?: string;
  progress?: number; // 0..1
  error?: string;
  /** Finished job only: the folder in the library, for "open folder". */
  songDir?: string;
  /** The leaf name actually used - it can carry a "(2)" suffix. */
  dirName?: string;
  /** From song_data.json meta: the sync is shaky and wants the editor. */
  lowConfidence?: boolean;
};
```

- [ ] **Step 4: `creations.ts` anpassen**

`CreationsDeps` erweitern:

```ts
  /**
   * Writes the job's text payload into the scratch dir. The job carries text
   * because the renderer has text and the persisted queue must survive a
   * restart; the worker wants paths.
   */
  schreibeJobDateien: (
    job: CreateJobRequest,
    jobDir: string,
  ) => Promise<{ lyricsPath: string; syncedLyricsPath?: string }>;
```
und den Rückgabetyp von `assemble` um `lowConfidence: boolean` ergänzen.

`toWorkerJob` nimmt die Pfade als Parameter:

```ts
const toWorkerJob = (
  job: CreateJobRequest,
  medien: AcquiredMedia,
  dateien: { lyricsPath: string; syncedLyricsPath?: string },
  workDir: string,
  jobDir: string,
): WorkerJob => ({
  id: job.id,
  audioPath: medien.audioPath,
  lyricsPath: dateien.lyricsPath,
  language: job.language,
  outPath: join(jobDir, "song_data.json"),
  bpm: job.bpm,
  syncedLyricsPath: dateien.syncedLyricsPath,
  workDir,
});
```

In `start()` direkt nach `const jobDir = deps.jobDir(jobDef.id);`:

```ts
          // Inside the try on purpose: a failed write must mark the job
          // failed, not abandon the queue.
          const dateien = await deps.schreibeJobDateien(jobDef, jobDir);
```

**Achtung, gemessen:** dieses zusätzliche `await` sitzt *vor*
`laufenderAbbruch = new AbortController()`. Drei bestehende Tests
(„Abbruch waehrend der Beschaffung", „behaelt den warmen Worker",
„shutdown bricht eine laufende Beschaffung ab") synchronisieren über eine
feste Zahl von `await Promise.resolve()`; mit dem neuen `await` läuft
`cancel()` bevor der Controller existiert, und zwei der Tests **hängen**
danach stumm (bun gibt gar nichts aus), statt zu scheitern. Die
Tick-Zählung dort durch ein Tor ersetzen, das die `acquire`-Attrappe
öffnet, statt die Reihenfolge im Produktionscode zu verbiegen — erst
schreiben, dann beschaffen ist richtig, damit ein Plattenfehler vor dem
langen Download auffällt.
Den `submitJob`-Aufruf auf `toWorkerJob(jobDef, medien, dateien, deps.workDir(), jobDir)` umstellen. Nach `const paket = await deps.assemble(...)`:

```ts
          eintrag.songDir = paket.songDir;
          eintrag.dirName = paket.dirName;
          eintrag.lowConfidence = paket.lowConfidence;
```

- [ ] **Step 5: Verdrahtung in `ipc.ts`**

`mkdir`, `writeFile` aus `node:fs/promises` importieren (falls noch nicht vorhanden) und bei `createCreations({...})` ergänzen:

```ts
  schreibeJobDateien: async (job, jobDir) => {
    await mkdir(jobDir, { recursive: true });
    const lyricsPath = join(jobDir, "lyrics.txt");
    await writeFile(lyricsPath, `${job.lyricsText.trimEnd()}\n`, "utf8");
    if (job.syncedLyricsText === undefined) return { lyricsPath };
    const syncedLyricsPath = join(jobDir, "synced.lrc");
    await writeFile(syncedLyricsPath, job.syncedLyricsText, "utf8");
    return { lyricsPath, syncedLyricsPath };
  },
```

und `assemble` ersetzen:

```ts
  assemble: async (job, medien, jobDir) => {
    const roh = await readFile(join(jobDir, "song_data.json"), "utf8");
    const songData = parseSongData(JSON.parse(roh));
    const paket = await Effect.runPromise(
      assemblePackage({
        songData,
        medien,
        meta: {
          artist: job.artist,
          title: job.title,
          genre: job.genre,
          year: job.year,
        },
        libraryDir: state.downloadDir,
        layout: state.folderLayout,
        jobDir,
        coverWahl: job.coverWahl,
      }),
    );
    return { ...paket, lowConfidence: songData.meta.lowConfidence };
  },
```

- [ ] **Step 6: Tests und Typen prüfen**

```bash
bun test src/desktop/main/creations.test.ts
bunx tsc --noEmit
```
Expected: Tests PASS, `tsc` sauber — die Fehler aus Task 4 sind damit erledigt.

- [ ] **Step 7: Committen**

```bash
bunx biome check src/desktop/main/creations.ts src/desktop/main/ipc.ts src/desktop/shared/ipcContract.ts src/desktop/main/creations.test.ts
git add src/desktop/main/creations.ts src/desktop/main/ipc.ts src/desktop/shared/ipcContract.ts src/desktop/main/creations.test.ts
git commit -m "feat(create): the job carries lyrics as text, the entry carries the result

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Die Erstellen-Queue übersteht den Neustart

**Files:**
- Modify: `src/desktop/main/creations.ts`
- Modify: `src/desktop/main/ipc.ts`, `src/desktop/main/index.ts`
- Test: `src/desktop/main/creations.test.ts`

**Interfaces:**
- Consumes: `loadCreateQueue`, `saveCreateQueue` (Task 4).
- Produces:
  - `CreationsDeps.ladeQueue: () => Promise<CreateJobRequest[]>`
  - `CreationsDeps.speichereQueue: (jobs: CreateJobRequest[]) => Promise<void>`
  - `creations.initialisiere(): Promise<void>` — lädt die Queue, setzt jeden Job auf `queued`, startet **nicht**.
  - `creations.wartendeIds(): string[]`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

```ts
it("laedt wartende Jobs beim Start und startet nichts", async () => {
  let gestartet = false;
  const c = createCreations({
    ...basisDeps(),
    ladeQueue: async () => [basisJob(), { ...basisJob(), id: "zwei" }],
    newWorker: () => {
      gestartet = true;
      return basisWorker();
    },
  });
  await c.initialisiere();
  expect(c.entriesForTests().map((e) => e.status)).toEqual([
    "queued",
    "queued",
  ]);
  expect(c.wartendeIds()).toHaveLength(2);
  expect(gestartet).toBe(false);
});

it("speichert bei jeder Aenderung der Queue", async () => {
  const gespeichert: number[] = [];
  const c = createCreations({
    ...basisDeps(),
    speichereQueue: async (jobs) => {
      gespeichert.push(jobs.length);
    },
  });
  c.queueAdd([basisJob(), { ...basisJob(), id: "zwei" }]);
  c.queueRemove("zwei");
  c.queueClear();
  await Bun.sleep(1);
  expect(gespeichert).toEqual([2, 1, 0]);
});

it("bricht die Queue nicht ab, wenn das Speichern scheitert", async () => {
  const fehler: string[] = [];
  const c = createCreations({
    ...basisDeps(),
    speichereQueue: async () => {
      throw new Error("Platte voll");
    },
    broadcast: (kanal, nutzlast) => {
      if (kanal === "event:error") {
        fehler.push((nutzlast as { message: string }).message);
      }
    },
  });
  expect(c.queueAdd([basisJob()])).toBe(1);
  await Bun.sleep(1);
  expect(fehler.join(" ")).toContain("Platte voll");
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/desktop/main/creations.test.ts`
Expected: FAIL — `initialisiere` ist keine Funktion.

- [ ] **Step 3: `creations.ts` erweitern**

Deps:

```ts
  ladeQueue: () => Promise<CreateJobRequest[]>;
  /** Failure is reported, never fatal: a full disk must not stop the queue. */
  speichereQueue: (jobs: CreateJobRequest[]) => Promise<void>;
```

Im Körper von `createCreations`:

```ts
  const sichere = (): void => {
    void deps.speichereQueue([...queue]).catch((e: unknown) => {
      deps.broadcast("event:error", {
        context: "erstellen",
        message: `Queue konnte nicht gespeichert werden: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    });
  };

  /**
   * Loads the persisted queue. A stored job never ran to completion, so it
   * comes back as "queued" - and nothing is started here: a program launch
   * must not seize the GPU unasked.
   */
  const initialisiere = async (): Promise<void> => {
    const jobs = await deps.ladeQueue();
    for (const j of jobs) {
      if (eintraege.has(j.id)) continue;
      queue.push(j);
      eintraege.set(j.id, {
        id: j.id,
        artist: j.artist,
        title: j.title,
        status: "queued",
      });
    }
    melde();
  };

  const wartendeIds = (): string[] => queue.map((j) => j.id);
```

`sichere()` aufrufen: in `queueAdd`, `queueRemove`, `queueClear` jeweils nach `melde()`, und in `start()` unmittelbar nach `const jobDef = queue.shift() as CreateJobRequest;` — ein begonnener Job ist aus der wartenden Queue heraus. `initialisiere` und `wartendeIds` ins Rückgabeobjekt aufnehmen.

- [ ] **Step 4: Verdrahten**

`ipc.ts`, bei `createCreations({...})`:

```ts
  ladeQueue: () => Effect.runPromise(loadCreateQueue),
  speichereQueue: (jobs) => Effect.runPromise(saveCreateQueue(jobs)),
```
mit `import { loadCreateQueue, saveCreateQueue } from "../../core/storage/createQueue.ts";`

`src/desktop/main/index.ts`, dort wo der Zustand nach `app.whenReady()` geladen wird:

```ts
  await creations.initialisiere();
```
`creations` wird aus `./ipc.ts` importiert — es ist dort bereits exportiert.

- [ ] **Step 5: Tests, Typen, Commit**

```bash
bun test src/desktop/main/creations.test.ts
bunx tsc --noEmit
bunx biome check src/desktop/main/creations.ts src/desktop/main/ipc.ts src/desktop/main/index.ts
git add src/desktop/main/
git commit -m "feat(create): the creation queue survives a restart

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Cover-Kandidaten beschaffen und aufräumen

**Files:**
- Create: `src/desktop/main/coverCandidates.ts`
- Create: `src/desktop/main/coverCandidates.test.ts`
- Modify: `src/desktop/main/environment.ts:34-48`, `src/desktop/main/creations.ts`, `src/desktop/main/ipc.ts`, `src/desktop/main/index.ts`

**Interfaces:**
- Consumes: `findCover` aus `src/core/api/artwork/coverArtArchive.ts`, `creationCoverDir`.
- Produces:
  - `creationCoverDir(jobId: string): string` (in `environment.ts`)
  - `type CoverKandidat = { kind: "caa" | "thumbnail"; pfad: string; dataUrl: string }`
  - `holeCoverKandidatenIn(dir: string, a: KandidatenAnfrage): Promise<CoverKandidat[]>`
  - `holeCoverKandidaten(jobId: string, a: KandidatenAnfrage): Promise<CoverKandidat[]>`
  - `raeumeWaisenIn(wurzel: string, bekannteIds: string[]): Promise<void>`
  - `raeumeCoverJob(jobId: string): Promise<void>`, `raeumeCoverWaisen(bekannteIds: string[]): Promise<void>`
  - `CreationsDeps.raeumeCover: (jobId: string) => Promise<void>`

- [ ] **Step 1: `creationCoverDir` ergänzen**

In `src/desktop/main/environment.ts` direkt unter `creationJobDir`:

```ts
/**
 * Where step 4's image candidates live. Outside the job dir on purpose: they
 * are fetched before the job exists. Hence the orphan sweep in
 * coverCandidates.ts.
 */
export const creationCoverDir = (jobId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
    throw new Error(`Ungueltige Job-Id: ${jobId}`);
  }
  return join(app.getPath("userData"), "create-cover", jobId);
};
```

- [ ] **Step 2: Die fehlschlagenden Tests schreiben**

`src/desktop/main/coverCandidates.test.ts` — geprüft werden die electron-freien Kerne:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { holeCoverKandidatenIn, raeumeWaisenIn } from "./coverCandidates.ts";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const alsAntwort = (): Response =>
  ({
    ok: true,
    arrayBuffer: async () => jpeg.buffer.slice(0),
  }) as unknown as Response;

describe("holeCoverKandidatenIn", () => {
  it("legt beide Kandidaten ab und liefert Data-URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Falco",
      title: "Rock Me Amadeus",
      thumbnailUrl: "https://example.invalid/t.jpg",
      deps: { findCoverFn: () => Effect.succeed(jpeg), fetchFn: alsAntwort },
    });
    expect(kandidaten.map((k) => k.kind)).toEqual(["caa", "thumbnail"]);
    expect(kandidaten[0]?.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(
      true,
    );
    expect((await readFile(kandidaten[0]?.pfad ?? "")).length).toBe(jpeg.length);
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert nur den Thumbnail, wenn das Archiv leer ist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Nische",
      title: "Unbekannt",
      thumbnailUrl: "https://example.invalid/t.jpg",
      deps: { findCoverFn: () => Effect.succeed(null), fetchFn: alsAntwort },
    });
    expect(kandidaten.map((k) => k.kind)).toEqual(["thumbnail"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert eine leere Liste, wenn beide Quellen versagen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cover-"));
    const kandidaten = await holeCoverKandidatenIn(dir, {
      artist: "Nische",
      title: "Unbekannt",
      deps: { findCoverFn: () => Effect.succeed(null) },
    });
    expect(kandidaten).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("raeumeWaisenIn", () => {
  it("loescht nur unbekannte Job-Ordner", async () => {
    const wurzel = await mkdtemp(join(tmpdir(), "cover-root-"));
    await Bun.write(join(wurzel, "behalten", "caa.jpg"), "x");
    await Bun.write(join(wurzel, "weg", "caa.jpg"), "x");
    await raeumeWaisenIn(wurzel, ["behalten"]);
    expect(await Bun.file(join(wurzel, "behalten", "caa.jpg")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(wurzel, "weg", "caa.jpg")).exists()).toBe(false);
    await rm(wurzel, { recursive: true, force: true });
  });

  it("stoert sich nicht an einem fehlenden Cache", async () => {
    await raeumeWaisenIn(join(tmpdir(), "gibt-es-nicht-12345"), []);
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/desktop/main/coverCandidates.test.ts`
Expected: FAIL — `Cannot find module './coverCandidates.ts'`.

- [ ] **Step 4: `coverCandidates.ts` schreiben**

```ts
// src/desktop/main/coverCandidates.ts
// Step 4's image candidates. They are fetched before the job exists, so they
// live in their own cache next to the job dirs - and therefore need an orphan
// sweep at app start. The electron-free "…In" cores are exported so the test
// needs no app mock, same split as creations.ts against ipc.ts.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { findCover } from "../../core/api/artwork/coverArtArchive.ts";
import { creationCoverDir } from "./environment.ts";

export type CoverKandidat = {
  kind: "caa" | "thumbnail";
  pfad: string;
  dataUrl: string;
};

export type KandidatenDeps = {
  findCoverFn?: typeof findCover;
  fetchFn?: typeof fetch;
};

export type KandidatenAnfrage = {
  artist: string;
  title: string;
  thumbnailUrl?: string;
  deps?: KandidatenDeps;
};

const alsDataUrl = (bytes: Uint8Array): string =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

const holeThumbnail = async (
  url: string,
  f: typeof fetch,
): Promise<Uint8Array | null> => {
  try {
    const antwort = await f(url);
    if (!antwort.ok) return null;
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
};

export const holeCoverKandidatenIn = async (
  dir: string,
  a: KandidatenAnfrage,
): Promise<CoverKandidat[]> => {
  const findCoverFn = a.deps?.findCoverFn ?? findCover;
  const f = a.deps?.fetchFn ?? fetch;
  await mkdir(dir, { recursive: true });

  const kandidaten: CoverKandidat[] = [];

  const roh = await Effect.runPromise(findCoverFn(a.artist, a.title));
  if (roh !== null && roh.length > 0) {
    const pfad = join(dir, "caa.jpg");
    await writeFile(pfad, roh);
    kandidaten.push({ kind: "caa", pfad, dataUrl: alsDataUrl(roh) });
  }

  if (a.thumbnailUrl) {
    const bytes = await holeThumbnail(a.thumbnailUrl, f);
    if (bytes) {
      const pfad = join(dir, "thumbnail.jpg");
      await writeFile(pfad, bytes);
      kandidaten.push({ kind: "thumbnail", pfad, dataUrl: alsDataUrl(bytes) });
    }
  }

  return kandidaten;
};

export const raeumeWaisenIn = async (
  wurzel: string,
  bekannteIds: string[],
): Promise<void> => {
  let eintraege: string[] = [];
  try {
    eintraege = await readdir(wurzel);
  } catch {
    return; // Kein Cache-Verzeichnis: nichts aufzuraeumen.
  }
  const bekannt = new Set(bekannteIds);
  for (const name of eintraege) {
    if (bekannt.has(name)) continue;
    await rm(join(wurzel, name), { recursive: true, force: true });
  }
};

export const holeCoverKandidaten = (
  jobId: string,
  a: KandidatenAnfrage,
): Promise<CoverKandidat[]> =>
  holeCoverKandidatenIn(creationCoverDir(jobId), a);

export const raeumeCoverJob = (jobId: string): Promise<void> =>
  rm(creationCoverDir(jobId), { recursive: true, force: true });

export const raeumeCoverWaisen = (bekannteIds: string[]): Promise<void> =>
  // creationCoverDir validates the id; its parent is the cache root.
  raeumeWaisenIn(dirname(creationCoverDir("waise")), bekannteIds);
```

- [ ] **Step 5: Aufräumen an die Queue hängen**

In `creations.ts` ein Dep ergänzen:

```ts
  /** Called once a job can no longer need its image candidates. */
  raeumeCover: (jobId: string) => Promise<void>;
```

Aufrufen — jeweils feuernd und schluckend, denn ein hängender Windows-Handle darf einen fertigen Song nicht zum Fehler machen:

```ts
  const raeumeCoverStill = (id: string): void => {
    void deps.raeumeCover(id).catch(() => {
      // Cache-Ordner bleibt liegen; der Waisen-Lauf beim Start holt ihn.
    });
  };
```
in `queueRemove(id)` (nach `melde()`), und in `start()` am Ende jedes Job-Durchlaufs — im Erfolgszweig nach `deps.aufraeumen(jobDir)` und im `catch` nach dem Setzen von `failed`/`cancelled`: `raeumeCoverStill(jobDef.id);`

In `ipc.ts`: `raeumeCover: raeumeCoverJob,` (Import aus `./coverCandidates.ts`).

In `index.ts`, direkt nach `await creations.initialisiere();`:

```ts
  // Orphans from a session that fetched candidates but never queued the job.
  await raeumeCoverWaisen(creations.wartendeIds());
```

- [ ] **Step 6: Tests, Typen, Commit**

```bash
bun test src/desktop/main/coverCandidates.test.ts src/desktop/main/creations.test.ts
bunx tsc --noEmit
bunx biome check src/desktop/main/coverCandidates.ts src/desktop/main/coverCandidates.test.ts src/desktop/main/environment.ts src/desktop/main/creations.ts src/desktop/main/ipc.ts src/desktop/main/index.ts
git add src/desktop/main/
git commit -m "feat(create): image candidates get their own cache with an orphan sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Die fünf neuen IPC-Kanäle

**Files:**
- Modify: `src/desktop/shared/ipcContract.ts`
- Modify: `src/desktop/preload/index.ts`
- Modify: `src/desktop/main/ipc.ts`

**Interfaces:**
- Consumes: `searchYoutubeVideos`, `dauerSekunden` (Task 2), `fetchSyncedLyrics` (Task 3), `holeCoverKandidaten` (Task 8).
- Produces auf `window.ultrastar`:
  - `createYoutubeSearch(query: string): Promise<YoutubeVideo[]>`
  - `createSourceInfo(quelle: MediaQuelle): Promise<{ durationSec: number } | null>`
  - `createLyricsSearch(a: LyricsSuche): Promise<string | null>`
  - `createCoverCandidates(a: CoverSuche): Promise<CoverKandidat[]>`
  - `createChooseFile(art: "audio" | "bild"): Promise<string | null>`

- [ ] **Step 1: Den Vertrag erweitern**

Typ-Importe und Re-Exporte in `src/desktop/shared/ipcContract.ts`:

```ts
import type { YoutubeVideo } from "../../core/api/youtube/search.ts";
import type { MediaQuelle } from "../../core/create/media.ts";
import type { CoverKandidat } from "../main/coverCandidates.ts";

export type { YoutubeVideo, MediaQuelle, CoverKandidat };

export type LyricsSuche = {
  artist: string;
  title: string;
  durationSec: number;
};

export type CoverSuche = {
  jobId: string;
  artist: string;
  title: string;
  thumbnailUrl?: string;
};
```

In `INVOKE_CHANNELS` nach `"create:cancel"`:

```ts
  "create:youtubeSearch",
  "create:sourceInfo",
  "create:lyricsSearch",
  "create:coverCandidates",
  "create:chooseFile",
```

In `UltrastarApi` nach `createCancel`:

```ts
  /** Five hits with duration and thumbnails; [] if yt-dlp is missing. */
  createYoutubeSearch: (query: string) => Promise<YoutubeVideo[]>;
  /** Playing time of a pasted link or a local file; null if unknown. */
  createSourceInfo: (
    quelle: MediaQuelle,
  ) => Promise<{ durationSec: number } | null>;
  createLyricsSearch: (a: LyricsSuche) => Promise<string | null>;
  createCoverCandidates: (a: CoverSuche) => Promise<CoverKandidat[]>;
  createChooseFile: (art: "audio" | "bild") => Promise<string | null>;
```

- [ ] **Step 2: Preload nachziehen**

In `src/desktop/preload/index.ts` nach `createCancel`:

```ts
  createYoutubeSearch: (query) =>
    ipcRenderer.invoke("create:youtubeSearch", query),
  createSourceInfo: (quelle) => ipcRenderer.invoke("create:sourceInfo", quelle),
  createLyricsSearch: (a) => ipcRenderer.invoke("create:lyricsSearch", a),
  createCoverCandidates: (a) => ipcRenderer.invoke("create:coverCandidates", a),
  createChooseFile: (art) => ipcRenderer.invoke("create:chooseFile", art),
```

- [ ] **Step 3: Handler schreiben**

In `src/desktop/main/ipc.ts` im `handlers`-Objekt nach `"create:cancel"`:

```ts
    "create:youtubeSearch": async (query: string) =>
      Effect.runPromise(
        Effect.catchAll(searchYoutubeVideos(query), () =>
          Effect.succeed([] as YoutubeVideo[]),
        ),
      ),
    "create:sourceInfo": async (quelle: MediaQuelle) => {
      const dauer = await Effect.runPromise(dauerSekunden(quelle));
      return dauer === null ? null : { durationSec: dauer };
    },
    "create:lyricsSearch": async (a: LyricsSuche) => fetchSyncedLyrics(a),
    "create:coverCandidates": async (a: CoverSuche) =>
      holeCoverKandidaten(a.jobId, {
        artist: a.artist,
        title: a.title,
        thumbnailUrl: a.thumbnailUrl,
      }),
    "create:chooseFile": async (art: "audio" | "bild") => {
      const filters =
        art === "audio"
          ? [
              {
                name: "Audio",
                extensions: ["mp3", "m4a", "wav", "flac", "ogg", "opus"],
              },
            ]
          : [{ name: "Bilder", extensions: ["jpg", "jpeg", "png", "webp"] }];
      const ergebnis = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters,
      });
      return ergebnis.canceled ? null : (ergebnis.filePaths[0] ?? null);
    },
```

Importe ergänzen: `searchYoutubeVideos` (`../../core/api/youtube/search.ts`), `dauerSekunden` (`../../core/create/probe.ts`), `fetchSyncedLyrics` (`../../core/create/lrclib.ts`), `holeCoverKandidaten` (`./coverCandidates.ts`), die Typen `YoutubeVideo`, `MediaQuelle`, `LyricsSuche`, `CoverSuche` aus dem Vertrag. `dialog` nutzt `settings:chooseDirectory` schon — Import prüfen, nicht doppeln.

- [ ] **Step 4: Vollständigkeit prüfen**

```bash
bun test src/desktop/shared/ipcContract.test.ts
bunx tsc --noEmit
```
Expected: PASS und sauber. Der `Record<InvokeChannel, …>`-Typ über `handlers` macht einen vergessenen Handler zum `tsc`-Fehler statt zum Laufzeitfehler.

- [ ] **Step 5: Committen**

```bash
bunx biome check src/desktop/shared/ipcContract.ts src/desktop/preload/index.ts src/desktop/main/ipc.ts
git add src/desktop/shared/ipcContract.ts src/desktop/preload/index.ts src/desktop/main/ipc.ts
git commit -m "feat(create): five channels for search, duration, lyrics, cover and file pick

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `createDraft.ts` — der Entwurf als reines Modul

Die Regel-Logik des Assistenten, DOM-frei und mit `bun test` prüfbar. Die Step-Komponenten bleiben dumm.

**Files:**
- Create: `src/desktop/renderer/views/createDraft.ts`
- Create: `src/desktop/renderer/views/createDraft.test.ts`

**Interfaces:**
- Consumes: `Antwort`, `normalizeLyrics`, `resolveLyrics` (Task 1), `CreateJob` (Task 4), `DownloadedEntry`, `MediaQuelle`.
- Produces:
  - `type Schritt = 1 | 2 | 3 | 4 | 5`
  - `type Entwurf` mit den Feldern `id`, `artist`, `title`, `language`, `genre`, `year`, `bpm`, `quelle`, `durationSec`, `thumbnailUrl`, `rohtext`, `antworten`, `syncedText`, `coverWahl`
  - `leererEntwurf(id: string): Entwurf`
  - `schrittFertig(e: Entwurf, s: Schritt): { ok: true } | { ok: false; grund: string }`
  - `zuJob(e: Entwurf): CreateJob`
  - `istDuplikat(e: Entwurf, downloaded: DownloadedEntry[]): boolean`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

`src/desktop/renderer/views/createDraft.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { DownloadedEntry } from "../../shared/ipcContract.ts";
import {
  type Entwurf,
  istDuplikat,
  leererEntwurf,
  schrittFertig,
  zuJob,
} from "./createDraft.ts";

const voll = (): Entwurf => ({
  ...leererEntwurf("abc-123"),
  artist: "Falco",
  title: "Rock Me Amadeus",
  language: "Deutsch",
  quelle: { kind: "youtube", url: "https://youtu.be/x" },
  durationSec: 213,
  rohtext: "Er war ein Punker\nUnd er lebte in der grossen Stadt",
  coverWahl: "keins",
});

describe("schrittFertig", () => {
  it("verlangt Interpret und Titel in Schritt 1", () => {
    const e = leererEntwurf("abc-123");
    expect(schrittFertig(e, 1)).toEqual({
      ok: false,
      grund: "Interpret und Titel fehlen.",
    });
    expect(schrittFertig({ ...e, artist: "Falco" }, 1)).toEqual({
      ok: false,
      grund: "Titel fehlt.",
    });
    expect(schrittFertig(voll(), 1)).toEqual({ ok: true });
  });

  it("verlangt eine Quelle in Schritt 2", () => {
    expect(schrittFertig({ ...voll(), quelle: null }, 2)).toEqual({
      ok: false,
      grund: "Keine Quelle gewaehlt.",
    });
    expect(schrittFertig(voll(), 2)).toEqual({ ok: true });
  });

  it("sperrt Schritt 3 bei leerem Text", () => {
    expect(schrittFertig({ ...voll(), rohtext: "   " }, 3)).toEqual({
      ok: false,
      grund: "Kein Liedtext eingefuegt.",
    });
  });

  it("sperrt Schritt 3, solange eine Frage offen ist", () => {
    const e = { ...voll(), rohtext: "Zeile A\nZeile B 2x" };
    expect(schrittFertig(e, 3)).toEqual({
      ok: false,
      grund: "Noch 1 offene Rueckfrage zum Text.",
    });
    expect(
      schrittFertig(
        {
          ...e,
          antworten: [
            { kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" },
          ],
        },
        3,
      ),
    ).toEqual({ ok: true });
  });

  it("verlangt eine Bildentscheidung in Schritt 4", () => {
    expect(schrittFertig({ ...voll(), coverWahl: null }, 4)).toEqual({
      ok: false,
      grund: "Noch keine Bildentscheidung.",
    });
  });
});

describe("zuJob", () => {
  it("baut einen Job mit aufgeloesten Zeilen", () => {
    const job = zuJob({
      ...voll(),
      rohtext: "Zeile A\nZeile B 2x",
      antworten: [{ kind: "repeat_scope", zeilenIndex: 1, wahl: "block" }],
      syncedText: "[00:01.00]Zeile A",
      coverWahl: { pfad: "C:/tmp/caa.jpg" },
      genre: "Pop",
      year: "1985",
      bpm: "",
    });
    expect(job.id).toBe("abc-123");
    expect(job.lyricsText).toBe("Zeile A\nZeile B\nZeile A\nZeile B");
    expect(job.syncedLyricsText).toBe("[00:01.00]Zeile A");
    expect(job.coverWahl).toEqual({ pfad: "C:/tmp/caa.jpg" });
    expect(job.genre).toBe("Pop");
    expect(job.year).toBe(1985);
    expect(job.bpm).toBeUndefined();
  });

  it("schickt die Thumbnail-URL nicht in den Job", () => {
    const job = zuJob({
      ...voll(),
      thumbnailUrl: "https://example.invalid/t.jpg",
    });
    expect(JSON.stringify(job)).not.toContain("example.invalid");
  });

  it("wirft bei unfertigem Entwurf", () => {
    expect(() => zuJob({ ...voll(), quelle: null })).toThrow(/Quelle/);
  });
});

describe("istDuplikat", () => {
  const bibliothek = [
    { artist: "Falco", title: "Rock me Amadeus" },
  ] as DownloadedEntry[];

  it("erkennt den Song unabhaengig von Gross- und Kleinschreibung", () => {
    expect(istDuplikat(voll(), bibliothek)).toBe(true);
  });

  it("meldet nichts bei anderem Titel", () => {
    expect(istDuplikat({ ...voll(), title: "Der Kommissar" }, bibliothek)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `bun test src/desktop/renderer/views/createDraft.test.ts`
Expected: FAIL — `Cannot find module './createDraft.ts'`.

- [ ] **Step 3: `createDraft.ts` schreiben**

```ts
// src/desktop/renderer/views/createDraft.ts
// The wizard's rules, deliberately without React and without the DOM: this is
// the part worth testing, and the project has no component test setup. The
// five step components only display and report changes.
import type { CreateJob } from "../../../core/create/job.ts";
import {
  type Antwort,
  normalizeLyrics,
  resolveLyrics,
} from "../../../core/create/lyrics.ts";
import type { DownloadedEntry, MediaQuelle } from "../../shared/ipcContract.ts";

export type Schritt = 1 | 2 | 3 | 4 | 5;

export type Entwurf = {
  /** Created in step 1 already: step 4 keys its image cache by it. */
  id: string;
  artist: string;
  title: string;
  language: string;
  /** Free text while drafting; parsed only in zuJob(). */
  genre: string;
  year: string;
  bpm: string;
  quelle: MediaQuelle | null;
  durationSec: number | null;
  /** From the search hit - step 4 needs it, the job does not. */
  thumbnailUrl: string | null;
  rohtext: string;
  antworten: Antwort[];
  /** LRCLIB's hit, as long as the user kept it unchanged. */
  syncedText: string | null;
  coverWahl: { pfad: string } | "keins" | null;
};

export const leererEntwurf = (id: string): Entwurf => ({
  id,
  artist: "",
  title: "",
  language: "Deutsch",
  genre: "",
  year: "",
  bpm: "",
  quelle: null,
  durationSec: null,
  thumbnailUrl: null,
  rohtext: "",
  antworten: [],
  syncedText: null,
  coverWahl: null,
});

export type Pruefung = { ok: true } | { ok: false; grund: string };

export const offeneFragenZahl = (e: Entwurf): number => {
  const fragen = normalizeLyrics(e.rohtext).offeneFragen;
  const beantwortet = new Set(e.antworten.map((a) => a.zeilenIndex));
  return fragen.filter((f) => !beantwortet.has(f.zeilenIndex)).length;
};

export const schrittFertig = (e: Entwurf, s: Schritt): Pruefung => {
  if (s === 1) {
    const fehltInterpret = e.artist.trim().length === 0;
    const fehltTitel = e.title.trim().length === 0;
    if (fehltInterpret && fehltTitel) {
      return { ok: false, grund: "Interpret und Titel fehlen." };
    }
    if (fehltInterpret) return { ok: false, grund: "Interpret fehlt." };
    if (fehltTitel) return { ok: false, grund: "Titel fehlt." };
    if (e.language.trim().length === 0) {
      return { ok: false, grund: "Sprache fehlt." };
    }
    return { ok: true };
  }
  if (s === 2) {
    if (e.quelle === null) {
      return { ok: false, grund: "Keine Quelle gewaehlt." };
    }
    return { ok: true };
  }
  if (s === 3) {
    if (e.rohtext.trim().length === 0) {
      return { ok: false, grund: "Kein Liedtext eingefuegt." };
    }
    const offen = offeneFragenZahl(e);
    if (offen > 0) {
      return {
        ok: false,
        grund: `Noch ${offen} offene Rueckfrage${
          offen === 1 ? "" : "n"
        } zum Text.`,
      };
    }
    if (resolveLyrics(e.rohtext, e.antworten).length === 0) {
      return {
        ok: false,
        grund: "Nach dem Aufbereiten bleibt keine Zeile uebrig.",
      };
    }
    return { ok: true };
  }
  if (s === 4) {
    if (e.coverWahl === null) {
      return { ok: false, grund: "Noch keine Bildentscheidung." };
    }
    return { ok: true };
  }
  return { ok: true };
};

const zahlOderUndefined = (roh: string): number | undefined => {
  const wert = Number.parseInt(roh.trim(), 10);
  return Number.isFinite(wert) && wert > 0 ? wert : undefined;
};

/** Throws rather than shipping half a job: the view gates on schrittFertig. */
export const zuJob = (e: Entwurf): CreateJob => {
  for (const s of [1, 2, 3, 4] as const) {
    const p = schrittFertig(e, s);
    if (!p.ok) throw new Error(p.grund);
  }
  if (e.quelle === null) throw new Error("Keine Quelle gewaehlt.");
  const job: CreateJob = {
    id: e.id,
    quelle: e.quelle,
    language: e.language.trim(),
    artist: e.artist.trim(),
    title: e.title.trim(),
    lyricsText: resolveLyrics(e.rohtext, e.antworten).join("\n"),
  };
  if (e.syncedText) job.syncedLyricsText = e.syncedText;
  if (e.coverWahl !== null) job.coverWahl = e.coverWahl;
  const genre = e.genre.trim();
  if (genre.length > 0) job.genre = genre;
  const jahr = zahlOderUndefined(e.year);
  if (jahr !== undefined) job.year = jahr;
  const bpm = zahlOderUndefined(e.bpm);
  if (bpm !== undefined) job.bpm = bpm;
  return job;
};

const schluessel = (artist: string, title: string): string =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

/**
 * A warning, not a veto: freierZielpfad deliberately puts "Titel (2)" next to
 * the existing folder, and the user is allowed to want exactly that.
 */
export const istDuplikat = (
  e: Entwurf,
  downloaded: DownloadedEntry[],
): boolean => {
  const gesucht = schluessel(e.artist, e.title);
  return downloaded.some((d) => schluessel(d.artist, d.title) === gesucht);
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `bun test src/desktop/renderer/views/createDraft.test.ts`
Expected: PASS (12 Tests). Heißen die Felder in `DownloadedEntry` (siehe `src/core/storage/downloaded.ts`) anders als `artist`/`title`, werden Test **und** Implementierung auf die echten Namen gezogen — nicht mit `as` überdeckt.

- [ ] **Step 5: Prüfen und committen**

```bash
bunx biome check src/desktop/renderer/views/createDraft.ts src/desktop/renderer/views/createDraft.test.ts
bunx tsc --noEmit
git add src/desktop/renderer/views/createDraft.ts src/desktop/renderer/views/createDraft.test.ts
git commit -m "feat(desktop): the wizard's rules live in a DOM-free module

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `CreateView`, Sidebar-Punkt, Entwurf in `App`

Ab hier ist der Assistent sichtbar — mit Schritt 1 und Platzhaltern für 2–5, die die nächsten Tasks ersetzen. Das ist Absicht: nach dieser Task lässt sich die App starten und der Weg begehen.

**Files:**
- Create: `src/desktop/renderer/views/CreateView.tsx`
- Create: `src/desktop/renderer/components/create/StepSong.tsx`
- Modify: `src/desktop/renderer/components/Sidebar.tsx:14-22,24-29,47`
- Modify: `src/desktop/renderer/App.tsx:37-85`

**Interfaces:**
- Consumes: `Entwurf`, `leererEntwurf`, `schrittFertig` (Task 10); `environmentStatus`, `environmentInstall`.
- Produces: `CreateView`-Props `{ entwurf: Entwurf; setEntwurf: (e: Entwurf) => void }`; `ViewId` bekommt `"create"`; `Sidebar` bekommt `creationCount: number`.

**Entscheidung vom 2026-08-03:** `downloaded` wird **nicht** vorab durchgereicht — die Prop entsteht erst in Task 14, wo sie benutzt wird. Ein ungenutzter Parameter ist ein Defekt, auch wenn er später gebraucht wird; dafür wird `App.tsx` zweimal angefasst.

- [ ] **Step 1: `StepSong.tsx` schreiben**

Vorher in `SearchView.tsx` nachsehen, welche Klasse die Eingabefelder tragen, und **diese** verwenden — unten steht `className="input"` als Platzhalter für die tatsächlich im Bestand benutzte Klasse.

```tsx
import type { FC } from "react";
import type { Entwurf } from "../../views/createDraft.ts";

/** Step 1: the header data. Artist and title also drive the folder name. */
export const StepSong: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => (
  <div>
    <div className="row" style={{ marginBottom: 8 }}>
      <input
        className="input"
        placeholder="Interpret…"
        value={entwurf.artist}
        onChange={(ev) => onChange({ artist: ev.target.value })}
      />
      <input
        className="input"
        placeholder="Titel…"
        value={entwurf.title}
        onChange={(ev) => onChange({ title: ev.target.value })}
      />
    </div>
    <div className="row" style={{ marginBottom: 8 }}>
      <input
        className="input"
        placeholder="Sprache"
        value={entwurf.language}
        onChange={(ev) => onChange({ language: ev.target.value })}
      />
      <input
        className="input"
        placeholder="Genre (optional)"
        value={entwurf.genre}
        onChange={(ev) => onChange({ genre: ev.target.value })}
      />
      <input
        className="input"
        placeholder="Jahr (optional)"
        value={entwurf.year}
        onChange={(ev) => onChange({ year: ev.target.value })}
      />
      <input
        className="input"
        placeholder="BPM (optional)"
        value={entwurf.bpm}
        onChange={(ev) => onChange({ bpm: ev.target.value })}
      />
    </div>
    <p className="muted">
      Interpret und Titel bestimmen auch den Ordnernamen. BPM leer lassen, wenn
      unbekannt — die Pipeline ermittelt das Tempo dann selbst.
    </p>
  </div>
);

export default StepSong;
```

- [ ] **Step 2: `CreateView.tsx` schreiben**

```tsx
import { Wand2 } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { EnvironmentStatus } from "../../shared/ipcContract.ts";
import StepSong from "../components/create/StepSong.tsx";
import {
  type Entwurf,
  type Schritt,
  leererEntwurf,
  schrittFertig,
} from "./createDraft.ts";

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
      {schritt > 1 && <p className="muted">Schritt {TITEL[schritt]} folgt.</p>}

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
```

Die Platzhalterzeile „Schritt … folgt." ist ein **bewusster Zwischenstand**: nach dieser Task lässt sich die App starten und der Weg begehen. Tasks 12–14 ersetzen sie Schritt für Schritt; nach Task 14 ist keine Platzhalterzeile mehr übrig.

- [ ] **Step 3: Sidebar und App verdrahten**

`Sidebar.tsx`: `Wand2` importieren, `ViewId` um `"create"` erweitern, im `ITEMS`-Array nach `search`:

```ts
  { id: "create", label: "Erstellen", icon: Wand2 },
```
Props um `creationCount: number` erweitern und die Badge-Zeile auf `queueCount + creationCount` umstellen (Badge bleibt am Queue-Punkt — dort liegt seit Task 15 beides).

`App.tsx` im `Shell`:

```tsx
  const creations = useIpcEvent("event:creations", []);
  const [entwurf, setEntwurf] = useState<Entwurf>(() =>
    leererEntwurf(crypto.randomUUID()),
  );
```
Sidebar-Aufruf um
```tsx
        creationCount={creations.filter((c) => c.status === "queued").length}
```
ergänzen und die View einhängen:
```tsx
        {view === "create" && (
          <CreateView entwurf={entwurf} setEntwurf={setEntwurf} />
        )}
```

- [ ] **Step 4: Von Hand ansehen**

Run: `bun run desktop:dev`
Expected: Die Sidebar zeigt „Erstellen"; die Ansicht zeigt Schritt 1; „Weiter" ist gesperrt und nennt „Interpret und Titel fehlen."; nach dem Ausfüllen erscheint Schritt 2 mit dem Platzhalter. Ohne KI-Umgebung steht das Banner oben, und „Jetzt einrichten" startet die Installation.

- [ ] **Step 5: Prüfen und committen**

```bash
bunx tsc --noEmit
bunx biome check src/desktop/renderer/views/CreateView.tsx src/desktop/renderer/components/create/StepSong.tsx src/desktop/renderer/components/Sidebar.tsx src/desktop/renderer/App.tsx
git add src/desktop/renderer/
git commit -m "feat(desktop): the creation wizard gets its view and its first step

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Schritt 2 — Quelle

**Files:**
- Create: `src/desktop/renderer/components/create/StepSource.tsx`
- Modify: `src/desktop/renderer/views/CreateView.tsx`

**Interfaces:**
- Consumes: `createYoutubeSearch`, `createSourceInfo`, `createChooseFile` (Task 9); `Entwurf` (Task 10).
- Produces: `StepSource`-Props `{ entwurf: Entwurf; onChange: (patch: Partial<Entwurf>) => void }`; setzt `quelle`, `durationSec`, `thumbnailUrl`.

- [ ] **Step 1: `StepSource.tsx` schreiben**

```tsx
import type { FC } from "react";
import { useState } from "react";
import type { YoutubeVideo } from "../../../shared/ipcContract.ts";
import type { Entwurf } from "../../views/createDraft.ts";

const mmss = (sek: number): string => {
  const m = Math.floor(sek / 60);
  const s = Math.round(sek % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Step 2. The search hit is the normal way - it brings the duration along,
 * which step 3 needs for LRCLIB. The two side entrances have to probe for it.
 */
export const StepSource: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const [treffer, setTreffer] = useState<YoutubeVideo[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const [link, setLink] = useState("");
  const [meldung, setMeldung] = useState<string | null>(null);

  const istGewaehlt = (url: string): boolean =>
    entwurf.quelle?.kind === "youtube" && entwurf.quelle.url === url;

  const suche = async (): Promise<void> => {
    setSucht(true);
    setMeldung(null);
    try {
      const gefunden = await window.ultrastar.createYoutubeSearch(
        `${entwurf.artist} ${entwurf.title}`,
      );
      setTreffer(gefunden);
      if (gefunden.length === 0) {
        setMeldung(
          "Keine Treffer. Prüfe Interpret und Titel — oder füge einen Link ein.",
        );
      }
    } finally {
      setSucht(false);
    }
  };

  const uebernehmeLink = async (): Promise<void> => {
    const url = link.trim();
    if (url.length === 0) return;
    setMeldung(null);
    const info = await window.ultrastar.createSourceInfo({
      kind: "youtube",
      url,
    });
    onChange({
      quelle: { kind: "youtube", url },
      durationSec: info?.durationSec ?? null,
      thumbnailUrl: null,
    });
    if (info === null) {
      setMeldung(
        "Die Spieldauer war nicht zu ermitteln — Schritt 3 macht dann keinen Textvorschlag.",
      );
    }
  };

  const waehleDatei = async (): Promise<void> => {
    const pfad = await window.ultrastar.createChooseFile("audio");
    if (pfad === null) return;
    setMeldung(null);
    const info = await window.ultrastar.createSourceInfo({
      kind: "datei",
      pfad,
    });
    onChange({
      quelle: { kind: "datei", pfad },
      durationSec: info?.durationSec ?? null,
      thumbnailUrl: null,
    });
    if (info === null) {
      setMeldung(
        "Die Datei war nicht lesbar oder ohne erkennbare Dauer. Bitte prüfen.",
      );
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          className="btn"
          type="button"
          disabled={sucht}
          onClick={() => void suche()}
        >
          {sucht ? "Sucht…" : "Bei YouTube suchen"}
        </button>
        <button className="btn" type="button" onClick={() => void waehleDatei()}>
          Lokale Audiodatei…
        </button>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="…oder YouTube-Link einfügen"
          value={link}
          onChange={(ev) => setLink(ev.target.value)}
        />
        <button
          className="btn"
          type="button"
          onClick={() => void uebernehmeLink()}
        >
          Übernehmen
        </button>
      </div>

      {meldung && <p className="muted">{meldung}</p>}

      {treffer && treffer.length > 0 && (
        <table className="song-table">
          <tbody>
            {treffer.map((v) => (
              <tr key={v.id}>
                <td style={{ width: 120 }}>
                  {v.thumbnails[0]?.url && (
                    <img
                      src={v.thumbnails[0].url}
                      alt=""
                      style={{ width: 110, borderRadius: 4 }}
                    />
                  )}
                </td>
                <td>
                  {v.title}
                  <br />
                  <span className="muted">
                    {v.channel} · {mmss(v.duration)}
                  </span>
                </td>
                <td style={{ width: 110 }}>
                  <button
                    className={istGewaehlt(v.url) ? "btn small primary" : "btn small"}
                    type="button"
                    onClick={() =>
                      onChange({
                        quelle: { kind: "youtube", url: v.url },
                        durationSec: v.duration,
                        thumbnailUrl: v.thumbnails[0]?.url ?? null,
                      })
                    }
                  >
                    {istGewaehlt(v.url) ? "Gewählt" : "Wählen"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entwurf.quelle && (
        <p className="muted" style={{ marginTop: 12 }}>
          Gewählt:{" "}
          {entwurf.quelle.kind === "youtube"
            ? entwurf.quelle.url
            : entwurf.quelle.pfad}
          {entwurf.durationSec !== null && ` · ${mmss(entwurf.durationSec)}`}
        </p>
      )}
    </div>
  );
};

export default StepSource;
```

- [ ] **Step 2: In `CreateView` einhängen**

`import StepSource from "../components/create/StepSource.tsx";` und den Platzhalter ersetzen:

```tsx
      {schritt === 2 && <StepSource entwurf={entwurf} onChange={patch} />}
      {schritt > 2 && <p className="muted">Schritt {TITEL[schritt]} folgt.</p>}
```

- [ ] **Step 3: Typen prüfen und von Hand durchgehen**

```bash
bunx tsc --noEmit
bunx biome check src/desktop/renderer/components/create/StepSource.tsx src/desktop/renderer/views/CreateView.tsx
```
Handprobe (`bun run desktop:dev`): Die Suche liefert fünf Treffer mit Kanal und Dauer; „Wählen" markiert den Treffer; Link und Datei setzen die Quelle samt Dauer. Ohne yt-dlp erscheint die Meldung statt einer leeren Tabelle.

- [ ] **Step 4: Committen**

```bash
git add src/desktop/renderer/
git commit -m "feat(desktop): step 2 finds the source and its playing time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Schritt 3 — Liedtext samt Rückfragen

**Files:**
- Create: `src/desktop/renderer/components/create/StepLyrics.tsx`
- Modify: `src/desktop/renderer/views/CreateView.tsx`

**Interfaces:**
- Consumes: `createLyricsSearch` (Task 9); `normalizeLyrics`, `Antwort` (Task 1); `Entwurf` (Task 10).
- Produces: `StepLyrics`-Props `{ entwurf: Entwurf; onChange: (patch: Partial<Entwurf>) => void }`; setzt `rohtext`, `syncedText`, `antworten`.

- [ ] **Step 1: `StepLyrics.tsx` schreiben**

```tsx
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
      setMeldung(
        "Synchronisierte Lyrics gefunden — sie verbessern das Timing.",
      );
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
              ev.target.value === entwurf.syncedText ? entwurf.syncedText : null,
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
```

- [ ] **Step 2: In `CreateView` einhängen**

```tsx
      {schritt === 3 && <StepLyrics entwurf={entwurf} onChange={patch} />}
      {schritt > 3 && <p className="muted">Schritt {TITEL[schritt]} folgt.</p>}
```

- [ ] **Step 3: Typen prüfen und von Hand durchgehen**

```bash
bunx tsc --noEmit
bunx biome check src/desktop/renderer/components/create/StepLyrics.tsx src/desktop/renderer/views/CreateView.tsx
```
Handprobe: Einen Song mit LRCLIB-Eintrag wählen (z. B. „Nena – 99 Luftballons") → der Text erscheint von selbst, daneben „Synchronisierte Lyrics liegen vor ✓". Eine Zeile auf `2x` enden lassen → Kärtchen erscheint, „Weiter" bleibt gesperrt mit „Noch 1 offene Rueckfrage zum Text."; nach der Antwort geht es weiter.

- [ ] **Step 4: Committen**

```bash
git add src/desktop/renderer/
git commit -m "feat(desktop): step 3 fetches lyrics and settles the open questions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Schritt 4 (Bild) und Schritt 5 (Prüfen)

**Files:**
- Create: `src/desktop/renderer/components/create/StepCover.tsx`
- Create: `src/desktop/renderer/components/create/StepReview.tsx`
- Modify: `src/desktop/renderer/views/CreateView.tsx`
- Modify: `src/desktop/renderer/App.tsx`

**Interfaces:**
- Consumes: `createCoverCandidates`, `createChooseFile` (Task 9); `istDuplikat`, `zuJob`, `leererEntwurf` (Task 10); `createQueueAdd`.
- Produces: `StepCover`-Props `{ entwurf, onChange }`; `StepReview`-Props `{ entwurf, downloaded, onAbgeschickt: () => void }`; `CreateView` bekommt jetzt `downloaded: DownloadedEntry[]` dazu.

**Hier** entsteht die `downloaded`-Prop (Entscheidung vom 2026-08-03, siehe Task 11): `CreateView` bekommt sie in dieser Task, weil `StepReview` sie für die Duplikat-Warnung braucht — und `App.tsx` gibt sie durch. Vorher gab es sie nicht.

- [ ] **Step 1: `StepCover.tsx` schreiben**

```tsx
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { CoverKandidat } from "../../../shared/ipcContract.ts";
import type { Entwurf } from "../../views/createDraft.ts";

const KACHEL = {
  width: 130,
  height: 130,
  borderRadius: 4,
  objectFit: "cover" as const,
};

/**
 * Step 4. Candidates land in a cache keyed by the draft id, so the job only
 * carries a path: no base64 in the persisted queue, and the choice survives a
 * restart.
 */
export const StepCover: FC<{
  entwurf: Entwurf;
  onChange: (patch: Partial<Entwurf>) => void;
}> = ({ entwurf, onChange }) => {
  const [kandidaten, setKandidaten] = useState<CoverKandidat[] | null>(null);
  const [eigenes, setEigenes] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    void window.ultrastar
      .createCoverCandidates({
        jobId: entwurf.id,
        artist: entwurf.artist,
        title: entwurf.title,
        thumbnailUrl: entwurf.thumbnailUrl ?? undefined,
      })
      .then((k) => {
        if (!aktiv) return;
        setKandidaten(k);
        // Preselect the album cover: it is square and unlettered, a video
        // thumbnail is neither.
        const beste = k[0];
        if (beste && entwurf.coverWahl === null) {
          onChange({ coverWahl: { pfad: beste.pfad } });
        }
      });
    return () => {
      aktiv = false;
    };
  }, [entwurf.id]);

  const gewaehlt = (pfad: string): boolean =>
    typeof entwurf.coverWahl === "object" && entwurf.coverWahl.pfad === pfad;

  const waehleEigenes = async (): Promise<void> => {
    const pfad = await window.ultrastar.createChooseFile("bild");
    if (pfad === null) return;
    setEigenes(pfad);
    onChange({ coverWahl: { pfad } });
  };

  if (kandidaten === null) return <p className="muted">Suche Bilder…</p>;

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        {kandidaten.map((k) => (
          <button
            key={k.pfad}
            type="button"
            className={gewaehlt(k.pfad) ? "btn primary" : "btn"}
            style={{ flexDirection: "column", height: "auto", padding: 8 }}
            onClick={() => onChange({ coverWahl: { pfad: k.pfad } })}
          >
            <img src={k.dataUrl} alt="" style={KACHEL} />
            <span>{k.kind === "caa" ? "Album-Cover" : "YouTube-Bild"}</span>
          </button>
        ))}
        <button
          type="button"
          className={
            eigenes !== null && gewaehlt(eigenes) ? "btn primary" : "btn"
          }
          style={{ flexDirection: "column", height: "auto", padding: 8 }}
          onClick={() => void waehleEigenes()}
        >
          <span style={{ ...KACHEL, display: "block", border: "1px dashed" }} />
          <span>Eigene Datei…</span>
        </button>
        <button
          type="button"
          className={entwurf.coverWahl === "keins" ? "btn primary" : "btn"}
          style={{ flexDirection: "column", height: "auto", padding: 8 }}
          onClick={() => onChange({ coverWahl: "keins" })}
        >
          <span style={{ ...KACHEL, display: "block", border: "1px dashed" }} />
          <span>Kein Bild</span>
        </button>
      </div>
      {kandidaten.length === 0 && (
        <p className="muted">
          Kein Album-Cover gefunden und kein YouTube-Bild vorhanden — eigene
          Datei wählen oder ohne Bild fortfahren.
        </p>
      )}
    </div>
  );
};

export default StepCover;
```

- [ ] **Step 2: `StepReview.tsx` schreiben**

```tsx
import type { FC } from "react";
import { useState } from "react";
import { resolveLyrics } from "../../../../core/create/lyrics.ts";
import type { DownloadedEntry } from "../../../shared/ipcContract.ts";
import { type Entwurf, istDuplikat, zuJob } from "../../views/createDraft.ts";

/** Step 5: what will be built, before ten minutes of GPU time are spent. */
export const StepReview: FC<{
  entwurf: Entwurf;
  downloaded: DownloadedEntry[];
  onAbgeschickt: () => void;
}> = ({ entwurf, downloaded, onAbgeschickt }) => {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const zeilen = resolveLyrics(entwurf.rohtext, entwurf.antworten);
  const doppelt = istDuplikat(entwurf, downloaded);

  const abschicken = async (): Promise<void> => {
    setLaeuft(true);
    setFehler(null);
    try {
      await window.ultrastar.createQueueAdd([zuJob(entwurf)]);
      onAbgeschickt();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div>
      <table className="song-table">
        <tbody>
          <tr>
            <td>Song</td>
            <td>
              {entwurf.artist} – {entwurf.title}
            </td>
          </tr>
          <tr>
            <td>Sprache</td>
            <td>{entwurf.language}</td>
          </tr>
          <tr>
            <td>Quelle</td>
            <td>
              {entwurf.quelle?.kind === "youtube"
                ? entwurf.quelle.url
                : (entwurf.quelle?.pfad ?? "—")}
            </td>
          </tr>
          <tr>
            <td>Textzeilen</td>
            <td>{zeilen.length}</td>
          </tr>
          <tr>
            <td>Synchronisierte Lyrics</td>
            <td>{entwurf.syncedText ? "liegen vor" : "keine"}</td>
          </tr>
          <tr>
            <td>Bild</td>
            <td>{entwurf.coverWahl === "keins" ? "keines" : "gewählt"}</td>
          </tr>
        </tbody>
      </table>

      {doppelt && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          „{entwurf.artist} – {entwurf.title}" liegt schon in der Bibliothek.
          Der neue Ordner wird danebengelegt, der alte bleibt unberührt.
        </div>
      )}
      {fehler && (
        <div className="error-banner" style={{ marginTop: 12 }}>
          {fehler}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          type="button"
          disabled={laeuft}
          onClick={() => void abschicken()}
        >
          {laeuft ? "Wird eingereiht…" : "Zur Queue"}
        </button>
        <span className="muted">
          Gestartet wird in der Queue — dort läuft immer nur ein Song, weil es
          nur eine GPU gibt.
        </span>
      </div>
    </div>
  );
};

export default StepReview;
```

- [ ] **Step 3: `downloaded` einführen, Schritte einhängen, Entwurf zurücksetzen**

Zuerst die Prop anlegen — `CreateView` bekommt sie jetzt zum ersten Mal:

```tsx
import type { DownloadedEntry } from "../../shared/ipcContract.ts";

export const CreateView: FC<{
  entwurf: Entwurf;
  setEntwurf: (e: Entwurf) => void;
  downloaded: DownloadedEntry[];
}> = ({ entwurf, setEntwurf, downloaded }) => {
```
und in `App.tsx` durchgeben:
```tsx
        {view === "create" && (
          <CreateView
            entwurf={entwurf}
            setEntwurf={setEntwurf}
            downloaded={downloaded}
          />
        )}
```

Dann die Platzhalter-Zeile vollständig ersetzen — nach dieser Task bleibt keine übrig:

```tsx
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
```

- [ ] **Step 4: Typen prüfen und von Hand durchgehen**

```bash
bunx tsc --noEmit
bunx biome check src/desktop/renderer/components/create/StepCover.tsx src/desktop/renderer/components/create/StepReview.tsx src/desktop/renderer/views/CreateView.tsx
```
Handprobe: Schritt 4 zeigt Album-Cover und YouTube-Bild, das Album-Cover ist vorgewählt, „Kein Bild" ist wählbar. Schritt 5 zeigt die Zusammenfassung, bei vorhandenem Song die Duplikat-Warnung, und „Zur Queue" setzt den Assistenten auf Schritt 1 zurück. Prüfen, dass unter `%APPDATA%/<App>/create-cover/<jobId>/` die Bilddateien liegen.

- [ ] **Step 5: Committen**

```bash
git add src/desktop/renderer/
git commit -m "feat(desktop): steps 4 and 5 pick the image and hand the job to the queue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Die Queue zeigt Erstellungen und ihren Abschluss

**Files:**
- Create: `src/desktop/renderer/components/CreationRow.tsx`
- Modify: `src/desktop/renderer/views/QueueView.tsx:14,34-157`
- Modify: `src/desktop/renderer/App.tsx:72`

**Interfaces:**
- Consumes: `event:creations`, `createStart`, `createCancel`, `createQueueRemove`, `createQueueClear`, `coverGetLocal`, `openFolder`; `CreationEntry` mit `songDir`/`dirName`/`lowConfidence` (Task 6).
- Produces: `QueueView`-Props `{ queue: Song[]; creations: CreationEntry[] }`; `CreationRow`-Props `{ eintrag: CreationEntry }`.

- [ ] **Step 1: `CreationRow.tsx` schreiben**

```tsx
import { ChevronDown, ChevronRight, FolderOpen, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { CreationEntry } from "../../shared/ipcContract.ts";

/**
 * Stage labels. `stage` has two sources: creations.ts already sets German
 * ("beschaffen", "paket"), the sidecar reports English. The English names are
 * taken from python-sidecar/ultrastar_pipeline/, not guessed. An unknown stage
 * is shown verbatim - a new pipeline step must not blank the display.
 */
const STUFE: Record<string, string> = {
  beschaffen: "beschaffen",
  separate: "trennen",
  transcribe: "erkennen",
  align: "ausrichten",
  pitch: "Tonhöhe",
  tempo: "Tempo",
  notes: "Noten",
  paket: "Paket bauen",
};

const stufenText = (stage?: string): string => {
  if (!stage) return "";
  if (stage.startsWith("preload:")) return "Modelle laden";
  return STUFE[stage] ?? stage;
};

const STATUS: Record<CreationEntry["status"], string> = {
  queued: "wartet",
  running: "läuft",
  completed: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
};

export const CreationRow: FC<{ eintrag: CreationEntry }> = ({ eintrag }) => {
  const [offen, setOffen] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const fertig = eintrag.status === "completed";

  useEffect(() => {
    if (!offen || eintrag.songDir === undefined) return;
    void window.ultrastar.coverGetLocal(eintrag.songDir).then(setCover);
  }, [offen, eintrag.songDir]);

  return (
    <>
      <tr>
        <td style={{ width: 40 }}>
          {fertig && (
            <button
              className="btn small"
              type="button"
              aria-label="Details"
              onClick={() => setOffen((v) => !v)}
            >
              {offen ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </button>
          )}
        </td>
        <td style={{ color: "var(--yellow)" }}>{eintrag.artist}</td>
        <td>{eintrag.title}</td>
        <td className="muted">
          {STATUS[eintrag.status]}
          {eintrag.status === "running" && eintrag.stage
            ? ` · ${stufenText(eintrag.stage)}`
            : ""}
          {eintrag.error ? ` · ${eintrag.error}` : ""}
        </td>
        <td style={{ width: 140 }}>
          {eintrag.status === "running" && (
            <progress value={eintrag.progress ?? 0} max={1} />
          )}
        </td>
        <td style={{ width: 60 }}>
          {eintrag.status === "queued" && (
            <button
              className="btn small"
              type="button"
              aria-label="Entfernen"
              title="Entfernen"
              onClick={() =>
                void window.ultrastar.createQueueRemove(eintrag.id)
              }
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </td>
      </tr>
      {offen && fertig && (
        <tr>
          <td />
          <td colSpan={5}>
            <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              {cover && (
                <img
                  src={cover}
                  alt=""
                  style={{ width: 90, height: 90, borderRadius: 4 }}
                />
              )}
              <div>
                <div>{eintrag.dirName}</div>
                {eintrag.lowConfidence && (
                  <div style={{ color: "var(--yellow)" }}>
                    Der Sync ist unsicher — die Erkennung war an mehreren
                    Stellen unschlüssig. Der Korrektur-Editor zieht das später
                    gerade.
                  </div>
                )}
                <button
                  className="btn small"
                  type="button"
                  onClick={() =>
                    void window.ultrastar.openFolder(eintrag.songDir ?? "")
                  }
                >
                  <FolderOpen size={14} aria-hidden />
                  Ordner öffnen
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default CreationRow;
```

- [ ] **Step 2: `QueueView` erweitern**

Props auf `{ queue: Song[]; creations: CreationEntry[] }` erweitern, `CreationRow` und `CreationEntry` importieren, oben in der Komponente:

```tsx
  const wartend = creations.filter((c) => c.status === "queued").length;
  const laeuftErstellung = creations.some((c) => c.status === "running");
```

und **unter** dem bestehenden Fehlgeschlagen-Block einen zweiten Abschnitt anhängen:

```tsx
      <div style={{ marginTop: 32 }}>
        <h3>Erstellungen</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn primary"
            type="button"
            disabled={wartend === 0 || laeuftErstellung}
            onClick={() => void window.ultrastar.createStart()}
          >
            <Play size={14} aria-hidden />
            {wartend} Songs erstellen
          </button>
          {laeuftErstellung && (
            <button
              className="btn"
              type="button"
              onClick={() => void window.ultrastar.createCancel()}
            >
              Laufenden Song abbrechen
            </button>
          )}
          <button
            className="btn danger"
            type="button"
            disabled={wartend === 0}
            onClick={() => void window.ultrastar.createQueueClear()}
          >
            Wartende entfernen
          </button>
        </div>
        {creations.length === 0 ? (
          <p className="muted">
            Noch keine Erstellungen. Der Assistent liegt unter „Erstellen".
          </p>
        ) : (
          <table className="song-table">
            <tbody>
              {creations.map((c) => (
                <CreationRow key={c.id} eintrag={c} />
              ))}
            </tbody>
          </table>
        )}
      </div>
```

- [ ] **Step 3: `App.tsx` nachziehen**

`{view === "queue" && <QueueView queue={queue} creations={creations} />}` — `creations` liegt seit Task 11 im `Shell`-Zustand.

- [ ] **Step 4: Typen prüfen und von Hand durchgehen**

```bash
bunx tsc --noEmit
bunx biome check src/desktop/renderer/components/CreationRow.tsx src/desktop/renderer/views/QueueView.tsx src/desktop/renderer/App.tsx
```
Handprobe: Einen Song einreihen → er steht unter „Erstellungen" als „wartet", der Sidebar-Zähler steigt. Starten → Stufe und Balken laufen. Nach dem Abschluss aufklappen → Cover, Ordnername, „Ordner öffnen"; bei unsicherem Sync der Hinweis. App schließen und neu öffnen → der wartende Job ist wieder da und es startet nichts von selbst.

- [ ] **Step 5: Committen**

```bash
git add src/desktop/renderer/
git commit -m "feat(desktop): the queue view shows creations and their finished folder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: E2E-Gang und Gesamtabnahme

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: die fertige UI.
- Produces: keinen Code für andere Tasks.

- [ ] **Step 1: Den E2E-Test anhängen**

Im Stil des bestehenden Tests, ohne Netz und ohne GPU:

```ts
test("the creation wizard reaches step 2", async () => {
  const app = await electron.launch({ args: ["out/main/index.js"] });
  const window = await app.firstWindow();

  await window.getByRole("button", { name: "Erstellen", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: /Song erstellen/ }),
  ).toBeVisible();

  // Step 1 gates on artist and title.
  const weiter = window.getByRole("button", { name: "Weiter" });
  await expect(weiter).toBeDisabled();

  await window.getByPlaceholder("Interpret…").fill("Falco");
  await window.getByPlaceholder("Titel…").fill("Rock Me Amadeus");
  await expect(weiter).toBeEnabled();
  await weiter.click();

  // Step 2 is source selection - nothing is searched on its own.
  await expect(
    window.getByRole("button", { name: "Bei YouTube suchen" }),
  ).toBeVisible();

  await app.close();
});
```

**Achtung:** Der bestehende Test nutzt `getByPlaceholder("Interpret…")` in der Suche. Beide Ansichten haben dieses Feld, aber nie gleichzeitig im DOM — der neue Test klickt vorher auf „Erstellen". Klagt Playwright dennoch über zwei Treffer, werden die Platzhalter im Assistenten auf „Interpret" und „Titel" (ohne Auslassungspunkte) geändert und der Test angeglichen.

- [ ] **Step 2: E2E laufen lassen**

Run: `bun run test:e2e`
Expected: beide Tests PASS.

- [ ] **Step 3: Gesamtabnahme**

```bash
bun test src
bunx tsc --noEmit
bunx biome check src e2e
```
Expected: alle Tests grün, keine Typfehler, keine Biome-Befunde in den berührten Dateien.

- [ ] **Step 4: Die Spec gegen das Ergebnis halten**

Die acht Zeilen der Fehlerfall-Tabelle in `docs/superpowers/specs/2026-08-03-erstellen-ui-design.md` einzeln in der laufenden App auslösen — oder begründet als nicht auslösbar notieren. Was nicht stimmt, wird jetzt behoben oder als Nachtrag in die Spec geschrieben, nicht stillschweigend gelassen. Am einfachsten auslösbar: yt-dlp aus dem PATH nehmen, einen Song ohne LRCLIB-Eintrag wählen, eine gewählte Bilddatei vor dem Start löschen, Text leeren.

- [ ] **Step 5: Committen**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): the creation wizard reaches step 2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Selbstkontrolle des Plans

**Spec-Deckung** — jeder Abschnitt der Spec hat eine Task:

| Spec-Abschnitt | Task |
|---|---|
| Schritt 1 Song | 11 |
| Schritt 2 Quelle, Dauer-Probe | 2, 12 |
| Schritt 3 Liedtext, Rückfragen, `.lrc` als zweite Evidenz | 1, 3, 13 |
| Schritt 4 Bild, Cover-Cache, Waisen | 8, 14 |
| Schritt 5 Prüfen, Duplikat-Warnung | 10, 14 |
| Umgebungs-Gate | 11 |
| `CreateJob`, Vertragsänderungen | 4, 6 |
| Fünf neue Kanäle | 9 |
| `coverWahl` im Paketbau | 5 |
| Queue-Sicht, Abschluss, Stufennamen | 15 |
| Persistenz, „running → queued", kein Autostart | 4, 7 |
| Tests | in jeder Task; E2E und Abnahme in 16 |

**Zwei bewusste Abweichungen von der Spec**, beide zugunsten der Schichtung:

1. Die Spec nennt `createDraft.ts` als Zustandsmodul; der Plan gibt ihm zusätzlich `zuJob` und `istDuplikat`, damit auch die Duplikat-Regel und der Job-Bau testbar sind statt in `StepReview` zu stecken.
2. Die Spec beschreibt `CreateJobRequest` im IPC-Vertrag; der Plan verschiebt den Typ nach `core/create/job.ts` und lässt den Vertrag ihn re-exportieren, weil `core/storage/createQueue.ts` ihn sonst nicht kennen dürfte, ohne die Schichtregel zu brechen. Der Wire-Typ bleibt identisch.

**Namensabgleich geprüft:** `resolveLyrics`/`Antwort` (1) → 10, 13, 14; `dauerAusYtDlp`/`dauerAusFfmpeg`/`dauerSekunden` (2) → 9; `fetchSyncedLyrics` (3) → 9; `CreateJob`/`loadCreateQueue`/`saveCreateQueue` (4) → 6, 7, 10; `coverWahl` (5) → 6, 10, 14; `schreibeJobDateien` (6) → 6; `initialisiere`/`wartendeIds`/`ladeQueue`/`speichereQueue` (7) → 8; `CoverKandidat`/`holeCoverKandidaten`/`raeumeCoverJob`/`raeumeCoverWaisen` (8) → 9, 14; die fünf `create*`-API-Methoden (9) → 12, 13, 14; `Entwurf`/`leererEntwurf`/`schrittFertig`/`zuJob`/`istDuplikat` (10) → 11–14; `CreationEntry.songDir`/`dirName`/`lowConfidence` (6) → 15.
