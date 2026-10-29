import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import envPaths from "env-paths";

/** 8-bit mono PCM: either silence or a steady sine tone. */
const wav = (sekunden: number, hz?: number): Buffer => {
  const rate = 16000;
  const daten = rate * sekunden;
  const b = Buffer.alloc(44 + daten);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + daten, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(daten, 40);
  for (let i = 0; i < daten; i += 1) {
    const wert = hz === undefined ? 0 : Math.sin((2 * Math.PI * hz * i) / rate) * 90;
    b.writeUInt8(Math.round(128 + wert), 44 + i);
  }
  return b;
};

const SONG = [
  "#TITLE:Testlied",
  "#ARTIST:Testband",
  "#MP3:audio.wav",
  "#VIDEO:video.mp4",
  "#BPM:300",
  "#GAP:100",
  ": 0 4 5 Hal",
  ": 4 4 7 lo",
  "- 10",
  ": 12 6 9  Welt",
  "E",
  "",
].join("\n");

const UNSICHER = SONG.replace("#TITLE:Testlied", "#TITLE:Unsicher");

const DUETT = [
  "#TITLE:Duett",
  "#ARTIST:Duo",
  "#MP3:audio.wav",
  "#BPM:300",
  "#GAP:100",
  "#P1:Anna",
  "#P2:Ben",
  "P1",
  ": 0 4 5 Hal",
  ": 4 4 7 lo",
  "P2",
  ": 8 4 1 du",
  "E",
  "",
].join("\n");

// GAP 2000 leaves room for the lead-in before the first note.
const EINSINGEN = [
  "#TITLE:Einsingen",
  "#ARTIST:Testband",
  "#MP3:audio.wav",
  "#BPM:300",
  "#GAP:2000",
  ": 0 8 5 La",
  ": 8 8 7 le",
  ": 16 8 9 lu",
  "E",
  "",
].join("\n");

// An app name of its own: the test never touches the real library or config.
const APP_NAME = `ultrastar-e2e-editor-${process.pid}`;
const datenDir = () => envPaths(APP_NAME, { suffix: "" }).cache;
let bibliothek: string;
let mikroWav: string;
const ordner = (titel: string) => join(bibliothek, `Testband - ${titel}`);

const songAnlegen = async (titel: string, txt: string) => {
  const dir = ordner(titel);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "song.txt"), txt, "utf8");
  await writeFile(join(dir, "audio.wav"), wav(6));
  await writeFile(join(dir, "video.mp4"), "kein echtes Video");
  return {
    apiId: -titel.length,
    artist: "Testband",
    title: titel,
    dirName: `Testband - ${titel}`,
    songDir: dir,
    downloadedAt: "2026-10-29T10:00:00.000Z",
  };
};

test.beforeAll(async () => {
  bibliothek = await mkdtemp(join(tmpdir(), "us-e2e-lib-"));
  const eintraege = [
    await songAnlegen("Testlied", SONG),
    await songAnlegen("Unsicher", UNSICHER),
    await songAnlegen("Duett", DUETT),
    await songAnlegen("Einsingen", EINSINGEN),
  ];
  await writeFile(
    join(ordner("Unsicher"), "sync-hints.json"),
    JSON.stringify({ version: 1, hints: [{ fromBeat: 4, toBeat: 18, kind: "interpolated" }] }),
  );
  // The fake microphone: a steady D4 (MIDI 62, UltraStar pitch 2).
  mikroWav = join(bibliothek, "mikro.wav");
  await writeFile(mikroWav, wav(20, 293.66));

  await mkdir(datenDir(), { recursive: true });
  await writeFile(
    join(datenDir(), "config.json"),
    JSON.stringify({ downloadDir: bibliothek, browser: "none", uiLanguage: "de" }),
  );
  await writeFile(join(datenDir(), "downloaded.json"), JSON.stringify(eintraege));
});

test.afterAll(async () => {
  await rm(bibliothek, { recursive: true, force: true });
  // The app folder itself, not just its Cache child - otherwise every run
  // leaves an empty "ultrastar-e2e-editor-<pid>" behind in LOCALAPPDATA.
  await rm(dirname(datenDir()), { recursive: true, force: true });
});

const starte = (): Promise<ElectronApplication> =>
  electron.launch({
    args: [
      "out/main/index.js",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${mikroWav}`,
    ],
    env: { ...process.env, ULTRASTAR_APP_NAME: APP_NAME },
  });

const oeffne = async (app: ElectronApplication, titel: string): Promise<Page> => {
  const window = await app.firstWindow();
  await window.getByRole("button", { name: "Heruntergeladen", exact: true }).click();
  await window
    .getByRole("row", { name: new RegExp(titel) })
    .getByRole("button", { name: "Bearbeiten" })
    .click();
  await expect(window.getByText(`Testband – ${titel}`)).toBeVisible();
  return window;
};

test("the correction editor edits and saves a song", async () => {
  const app = await starte();
  const window = await oeffne(app, "Testlied");
  const songDir = ordner("Testlied");

  await expect(window.getByText("3 Noten")).toBeVisible();
  // The audio is there, so no "no audio" hint.
  await expect(window.getByText(/Keine Audiodatei/)).toHaveCount(0);

  // Select the first note, raise it a semitone, rename the second syllable.
  await window.keyboard.press("ArrowRight");
  await expect(window.getByRole("button", { name: "Hal", exact: true })).toBeVisible();
  await window.keyboard.press("ArrowUp");
  await window.keyboard.press("ArrowRight");
  await window.keyboard.press("e");
  await window.keyboard.type("la");
  await window.keyboard.press("Enter");
  await expect(window.getByText("Ungespeicherte Änderungen")).toBeVisible();

  // Drag "Welt" four beats to the right. Start view: 10 px per beat, the
  // left edge 8 beats before the first note; pitch rows span 2..12.
  const box = await window.locator(".piano-roll canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const rowH = (box.height - 24) / 11;
  const x = box.x + (12 + 8) * 10 + 20;
  const y = box.y + (12 - 9) * rowH + rowH / 2;
  await window.mouse.move(x, y);
  await window.mouse.down();
  await window.mouse.move(x + 20, y, { steps: 3 });
  await window.mouse.move(x + 40, y, { steps: 3 });
  await window.mouse.up();
  await expect(window.locator(".editor-field input").nth(1)).toHaveValue("16");

  await window.screenshot({ path: "test-results/editor.png" });

  await window.keyboard.press("Control+s");
  await expect(window.getByText("Gespeichert", { exact: true })).toBeVisible();

  const gespeichert = await readFile(join(songDir, "song.txt"), "utf8");
  expect(gespeichert).toContain(": 0 4 6 Hal");
  expect(gespeichert).toContain(": 4 4 7 la");
  expect(gespeichert).toContain(": 16 6 9  Welt");
  expect(gespeichert).toContain("#GAP:100");
  expect(await readFile(join(songDir, "song.txt.bak"), "utf8")).toBe(SONG);

  // Playback runs through the songmedia:// protocol and moves the clock.
  await window.keyboard.press("Space");
  await expect(window.locator(".editor-time")).not.toHaveText("0.00 s");
  await window.keyboard.press("Space");

  // Undo after saving makes it unsaved again; closing then asks first.
  await window.keyboard.press("Control+z");
  await window.getByRole("button", { name: "Schließen" }).click();
  await window.getByRole("button", { name: "Verwerfen und schließen" }).click();
  await expect(window.getByText("3 Noten")).toHaveCount(0);
  expect(existsSync(join(songDir, "song.txt.tmp"))).toBe(false);

  await app.close();
});

test("uncertain spots are marked, found and checked off", async () => {
  const app = await starte();
  const window = await oeffne(app, "Unsicher");
  const songDir = ordner("Unsicher");

  const knopf = window.getByRole("button", { name: "1 unsichere Stelle" });
  await expect(knopf).toBeVisible();
  await knopf.click();
  await expect(window.getByText(/Timing dieser Stelle hat die Erkennung nur geschätzt/)).toBeVisible();
  await window.screenshot({ path: "test-results/editor-unsicher.png" });

  await window.keyboard.press("k");
  await expect(knopf).toHaveCount(0);
  await window.keyboard.press("Control+s");
  await expect(window.getByText("Gespeichert", { exact: true })).toBeVisible();
  expect(existsSync(join(songDir, "sync-hints.json"))).toBe(false);
  // Checking off changes no note.
  expect(await readFile(join(songDir, "song.txt"), "utf8")).toBe(UNSICHER);

  await app.close();
});

test("duets show both voices and edit one at a time", async () => {
  const app = await starte();
  const window = await oeffne(app, "Duett");
  const songDir = ordner("Duett");

  await expect(window.getByRole("tab", { name: "Anna" })).toHaveAttribute("aria-selected", "true");
  await window.getByRole("tab", { name: "Ben" }).click();
  await window.keyboard.press("ArrowRight");
  await expect(window.locator(".editor-field input").first()).toHaveValue("du");
  await window.keyboard.press("ArrowUp");
  await window.keyboard.press("Control+s");
  await expect(window.getByText("Gespeichert", { exact: true })).toBeVisible();

  expect(await readFile(join(songDir, "song.txt"), "utf8")).toBe(
    DUETT.replace(": 8 4 1 du", ": 8 4 2 du"),
  );

  // Tab switches voice from the notes; on a focused button it stays focus navigation.
  await window.locator(".piano-roll canvas").click({ position: { x: 5, y: 5 } });
  await window.keyboard.press("Tab");
  await expect(window.getByRole("tab", { name: "Anna" })).toHaveAttribute("aria-selected", "true");

  await app.close();
});

test("singing a line in corrects its pitches", async () => {
  const app = await starte();
  const window = await oeffne(app, "Einsingen");
  const songDir = ordner("Einsingen");

  await window.keyboard.press("ArrowRight");
  await window.keyboard.press("i");
  await expect(window.getByText("Sing die Zeile mit …")).toBeVisible();
  // The fake microphone holds D4 throughout: every note should become 2.
  await expect(window.getByText(/3 von 3 erkannten Noten/)).toBeVisible({ timeout: 15_000 });
  await window.screenshot({ path: "test-results/editor-einsingen.png" });

  await window.keyboard.press("Enter");
  await window.keyboard.press("Control+s");
  await expect(window.getByText("Gespeichert", { exact: true })).toBeVisible();
  const txt = await readFile(join(songDir, "song.txt"), "utf8");
  expect(txt).toContain(": 0 8 2 La\n: 8 8 2 le\n: 16 8 2 lu\n");

  await app.close();
});
