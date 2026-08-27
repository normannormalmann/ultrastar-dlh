// src/desktop/renderer/views/createDraft.test.ts
import { describe, expect, it } from "bun:test";
import type { DownloadedEntry } from "../../shared/ipcContract.ts";
import {
  type Entwurf,
  istDuplikat,
  leererEntwurf,
  SPRACHEN,
  schrittFertig,
  spracheName,
  zuJob,
} from "./createDraft.ts";

const voll = (): Entwurf => ({
  ...leererEntwurf("abc-123"),
  artist: "Falco",
  title: "Rock Me Amadeus",
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
      grund: "artistAndTitleMissing",
    });
    expect(schrittFertig({ ...e, artist: "Falco" }, 1)).toEqual({
      ok: false,
      grund: "titleMissing",
    });
    expect(schrittFertig({ ...e, title: "Der Kommissar" }, 1)).toEqual({
      ok: false,
      grund: "artistMissing",
    });
    expect(schrittFertig(voll(), 1)).toEqual({ ok: true });
  });

  it("sperrt Schritt 1 bei einer Sprache ohne Modell", () => {
    // Der Anzeigename ist genau der Fall, der vorher erst in der Pipeline
    // aufgefallen ist - nach dem Laden der Modelle.
    expect(schrittFertig({ ...voll(), language: "Deutsch" }, 1)).toEqual({
      ok: false,
      grund: "languageModelMissing",
    });
    expect(schrittFertig({ ...voll(), language: "  " }, 1)).toEqual({
      ok: false,
      grund: "languageMissing",
    });
  });

  it("verlangt eine Quelle in Schritt 2", () => {
    expect(schrittFertig({ ...voll(), quelle: null }, 2)).toEqual({
      ok: false,
      grund: "noSource",
    });
    expect(schrittFertig(voll(), 2)).toEqual({ ok: true });
  });

  it("sperrt Schritt 3 bei leerem Text", () => {
    expect(schrittFertig({ ...voll(), rohtext: "   " }, 3)).toEqual({
      ok: false,
      grund: "noLyrics",
    });
  });

  it("sperrt Schritt 3, solange eine Frage offen ist", () => {
    const e = { ...voll(), rohtext: "Zeile A\nZeile B 2x" };
    expect(schrittFertig(e, 3)).toEqual({
      ok: false,
      grund: "openQuestions",
      anzahl: 1,
    });
    expect(
      schrittFertig(
        {
          ...e,
          antworten: [{ kind: "repeat_scope", zeilenIndex: 1, wahl: "zeile" }],
        },
        3,
      ),
    ).toEqual({ ok: true });
  });

  it("zaehlt mehrere offene Fragen in der Mehrzahl", () => {
    const e = { ...voll(), rohtext: "Zeile A 2x\nZeile B\nZeile C 2x" };
    expect(schrittFertig(e, 3)).toEqual({
      ok: false,
      grund: "openQuestions",
      anzahl: 2,
    });
  });

  it("sperrt Schritt 3, wenn nach dem Aufbereiten keine Zeile bleibt", () => {
    // Nur eine Kopfzeile: die wird verworfen, uebrig bleibt nichts.
    expect(schrittFertig({ ...voll(), rohtext: "[Strophe]" }, 3)).toEqual({
      ok: false,
      grund: "noLineLeft",
    });
  });

  it("verlangt eine Bildentscheidung in Schritt 4", () => {
    expect(schrittFertig({ ...voll(), coverWahl: null }, 4)).toEqual({
      ok: false,
      grund: "noCoverChoice",
    });
    expect(schrittFertig(voll(), 4)).toEqual({ ok: true });
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
    expect(() => zuJob({ ...voll(), quelle: null })).toThrow(/noSource/);
  });

  it("gibt die Sprache als ISO-Code weiter, nicht als Anzeigenamen", () => {
    // whisper kennt nur ISO-639-1. Ein "Deutsch" im Job kostet erst die
    // Modell-Ladezeit und endet dann in language_unsupported/transcribe.
    expect(zuJob(voll()).language).toBe("de");
  });
});

describe("SPRACHEN", () => {
  it("fuehrt nur zweistellige Codes und keine Dubletten", () => {
    for (const s of SPRACHEN) expect(s.code).toMatch(/^[a-z]{2}$/);
    expect(new Set(SPRACHEN.map((s) => s.code)).size).toBe(SPRACHEN.length);
  });

  it("uebersetzt Codes fuer die Anzeige und laesst Unbekanntes stehen", () => {
    expect(spracheName("de")).toBe("Deutsch");
    expect(spracheName("xx")).toBe("xx");
  });

  it("traegt fuer jeden Code einen englischen Namen fuer die Kopfzeile", () => {
    // Die #LANGUAGE-Zeile will den Namen, nicht den Code - siehe
    // writeSongTxt. Ohne tag stuende dort "de".
    for (const s of SPRACHEN) expect(s.tag.length).toBeGreaterThan(1);
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
