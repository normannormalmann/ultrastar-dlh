import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("isolated desktop: audio library, original voice, tempo, validation and preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "ultrastar-review-e2e-"));
  const profile = join(root, "review-test");
  const library = join(root, "songs");
  const dir = join(library, "A", "Testband - Testlied");
  await mkdir(dir, { recursive: true });
  await mkdir(profile, { recursive: true });
  const text =
    "#ARTIST:Testband\n#TITLE:Testlied\n#BPM:1920\n#MP3:audio.wav\n: 0 64 12 Hallo\nF 64 64 0 Welt\nE\n";
  await writeFile(join(dir, "song.txt"), text);
  await writeFile(
    join(dir, "sync-hints.json"),
    JSON.stringify({
      version: 1,
      hints: [{ fromBeat: 64, toBeat: 128, kind: "pitch" }],
    }),
  );
  const wav = Buffer.alloc(44 + 16_000 * 5, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(join(dir, "audio.wav"), wav);
  await writeFile(join(dir, "vocals.wav"), wav);
  await writeFile(
    join(dir, "originalPitch.json"),
    JSON.stringify({
      midiOffset: 48,
      points: [
        { ms: 0, pitch: 12 },
        { ms: 50, pitch: 12.1 },
        { ms: 100, pitch: 12 },
      ],
    }),
  );
  await writeFile(
    join(profile, "config.json"),
    JSON.stringify({ downloadDir: library, browser: "edge", uiLanguage: "de" }),
  );
  await writeFile(
    join(profile, "downloaded.json"),
    JSON.stringify([
      {
        apiId: 42,
        artist: "Testband",
        title: "Testlied",
        songDir: dir,
        dirName: "Testband - Testlied",
        downloadedAt: new Date().toISOString(),
      },
    ]),
  );
  const isolatedApp = join(root, "app");
  await mkdir(isolatedApp);
  await cp("out", join(isolatedApp, "out"), { recursive: true });
  await writeFile(
    join(isolatedApp, "package.json"),
    JSON.stringify({
      name: "ultrastar-smoke",
      version: "1.0.0",
      type: "module",
      main: "out/main/index.js",
    }),
  );
  const app = await electron.launch({
    args: [isolatedApp],
    env: {
      ...process.env,
      ULTRASTAR_DATA_ROOT: root,
      ULTRASTAR_APP_NAME: "review-test",
      ULTRASTAR_OFFLINE: "1",
    },
  });
  try {
    const window = await app.firstWindow();
    await window
      .getByRole("button", { name: "Heruntergeladen", exact: true })
      .click();
    await expect(window.getByRole("row", { name: /Testlied/ })).toBeVisible();
    await window
      .getByRole("button", { name: "Gültigkeit & Duplikate prüfen" })
      .click();
    await expect(
      window.getByText(/1 Songs geprüft · 0 Hinweise/),
    ).toBeVisible();
    await app.evaluate(({ ipcMain }, songDir) => {
      ipcMain.removeHandler("library:usdbCheck");
      ipcMain.handle("library:usdbCheck", () => ({
        songDir,
        artist: "Testband",
        title: "Testlied",
        status: "unknown",
        proposedText: "USDB-Fassung",
        localText: "Lokale Fassung",
        localRevision: "a".repeat(64),
        remoteRevision: "b".repeat(64),
      }));
      ipcMain.removeHandler("library:usdbApply");
      ipcMain.handle("library:usdbApply", (_event, request) => {
        if (request.keepLocal !== true)
          throw new Error("Keep-local decision was lost");
      });
    }, dir);
    await window
      .getByRole("button", { name: "USDB-Updates prüfen (1)" })
      .click();
    await window.getByText(/Unterschied zur aktuellen USDB-Fassung/).click();
    await window
      .getByRole("button", {
        name: "Lokale Fassung behalten und USDB ab jetzt beobachten",
      })
      .click();
    await expect(
      window.getByText(/Unterschied zur aktuellen USDB-Fassung/),
    ).toHaveCount(0);
    await window
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click();
    await expect(
      window.getByLabel("Originalgesang (türkise Linie)"),
    ).toBeChecked();
    await window.getByLabel("Abspieltempo").selectOption("0.5");
    await window.getByLabel("Nur Gesang", { exact: true }).check();
    await window
      .getByRole("button", { name: "Abspielen (Leertaste)", exact: true })
      .click();
    await expect(window.locator(".editor-time")).not.toHaveText("0.00 s");
    await window
      .getByRole("button", { name: "Anhalten (Leertaste)", exact: true })
      .click();
    await window.screenshot({ path: "test-results/review-editor.png" });
    const loaded = await window.evaluate(
      (songDir) => globalThis.window.ultrastar.editorLoad(songDir),
      dir,
    );
    await app.evaluate(({ ipcMain }, result) => {
      ipcMain.removeHandler("editor:analyze");
      ipcMain.handle("editor:analyze", () => result);
    }, loaded);
    await window.locator(".editor-overlay").focus();
    await window.keyboard.press("ArrowRight");
    await expect(
      window.getByRole("button", { name: "Hallo", exact: true }),
    ).toBeVisible();
    await window.keyboard.press("ArrowUp");
    await expect(window.getByText("Ungespeicherte Änderungen")).toBeVisible();
    await window
      .getByRole("button", { name: "Gesangsanalyse aktualisieren" })
      .click();
    await expect(
      window.getByRole("button", { name: "Gesangsanalyse aktualisieren" }),
    ).toBeEnabled();
    await expect(window.locator(".editor-field input").nth(3)).toHaveValue(
      "13",
    );
    await expect(window.getByText("Ungespeicherte Änderungen")).toBeVisible();
    await window.getByRole("button", { name: "1 unsichere Stelle" }).click();
    await expect(
      window.getByText(
        /Tonhöhe nicht gemessen\. Freestyle wird nicht bewertet/,
      ),
    ).toBeVisible();
    await expect(window.locator(".editor-panel select")).toHaveValue("F");
    await window.screenshot({ path: "test-results/review-missing-pitch.png" });
    await window
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await window
      .getByRole("button", { name: "Verwerfen und schließen" })
      .click();

    // Network-facing adapters are replaced only inside this test process.
    const audio = await window.evaluate(async (songDir) => {
      const result = await globalThis.window.ultrastar.editorLoad(songDir);
      return result.ok ? result.mediaUrl : null;
    }, dir);
    await app.evaluate(({ ipcMain }, mediaUrl) => {
      ipcMain.removeHandler("usdb:search");
      ipcMain.handle("usdb:search", () => ({
        totalPages: 1,
        songs: [
          {
            apiId: 42,
            artist: "Vorschau",
            title: "Beispiel",
            languages: ["German"],
          },
        ],
      }));
      ipcMain.removeHandler("search:preview");
      ipcMain.handle("search:preview", () => mediaUrl);
    }, audio);
    await window
      .locator(".sidebar")
      .getByRole("button", { name: "Suche", exact: true })
      .click();
    await window.getByRole("button", { name: "Suchen", exact: true }).click();
    await window.getByRole("button", { name: "Anhören", exact: true }).click();
    await expect(window.locator(".search-preview audio")).toBeVisible();
    await window.getByRole("button", { name: "Vorschau schließen" }).click();
    expect(await readFile(join(dir, "song.txt"), "utf8")).toBe(text);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
