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
