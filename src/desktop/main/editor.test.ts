// src/desktop/main/editor.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insideLibrary, loadForEditor, realSongDir, saveFromEditor } from "./editor.ts";

let wurzel: string;
let bibliothek: string;
let draussen: string;

beforeAll(async () => {
  wurzel = await mkdtemp(join(tmpdir(), "editor-ipc-"));
  bibliothek = join(wurzel, "lib");
  draussen = join(wurzel, "draussen");
  await mkdir(join(bibliothek, "Song"), { recursive: true });
  await mkdir(draussen, { recursive: true });
  await writeFile(join(bibliothek, "Song", "song.txt"), "#BPM:300\n: 0 4 5 a\nE\n");
  await writeFile(join(draussen, "song.txt"), "#BPM:300\n: 0 4 5 geheim\nE\n");
  // A junction needs no admin rights on Windows, unlike a symlink.
  await symlink(draussen, join(bibliothek, "Abzweig"), "junction");
});

afterAll(async () => {
  await rm(wurzel, { recursive: true, force: true });
});

describe("insideLibrary", () => {
  it("laesst nur Unterordner der Bibliothek zu", () => {
    expect(insideLibrary(bibliothek, join(bibliothek, "Song"))).toBe(true);
    expect(insideLibrary(bibliothek, bibliothek)).toBe(false);
    expect(insideLibrary(bibliothek, join(bibliothek, "..", "draussen"))).toBe(false);
    expect(insideLibrary(bibliothek, draussen)).toBe(false);
    expect(insideLibrary(bibliothek, 42)).toBe(false);
    expect(insideLibrary("", join(bibliothek, "Song"))).toBe(false);
  });
});

describe("realSongDir", () => {
  it("folgt keiner Verzweigung aus der Bibliothek hinaus", async () => {
    expect(await realSongDir(bibliothek, join(bibliothek, "Abzweig"))).toBeNull();
    expect(await realSongDir(bibliothek, join(bibliothek, "Song"))).not.toBeNull();
    expect(await realSongDir(bibliothek, join(bibliothek, "fehlt"))).toBeNull();
  });
});

describe("loadForEditor / saveFromEditor", () => {
  it("laedt einen Song aus der Bibliothek", async () => {
    const r = await loadForEditor(bibliothek, join(bibliothek, "Song"));
    expect(r.ok).toBe(true);
  });

  it("verweigert Ordner hinter einer Verzweigung", async () => {
    const r = await loadForEditor(bibliothek, join(bibliothek, "Abzweig"));
    expect(r).toEqual({ ok: false, error: { code: "outsideLibrary" } });
  });

  it("verweigert unsinnige Speicher-Anfragen ohne Ausnahme", async () => {
    const r = await saveFromEditor(bibliothek, {
      songDir: join(bibliothek, "Song"),
      song: { headers: "x", notes: null, eol: "\n" } as never,
      revision: "egal",
    });
    expect(r.ok).toBe(false);
    const ohne = await saveFromEditor(bibliothek, undefined as never);
    expect(ohne).toEqual({ ok: false, error: { code: "outsideLibrary" } });
  });
});
