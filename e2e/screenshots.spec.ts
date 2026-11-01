import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { de } from "../src/desktop/renderer/i18n/de.ts";
import { en } from "../src/desktop/renderer/i18n/en.ts";
import { es } from "../src/desktop/renderer/i18n/es.ts";

/**
 * The screenshots in docs/screenshots/<lang>/, one set per UI language.
 * Not a test: it runs only on request (`bun run docs:screenshots`).
 *
 * Everything shown is made up. The library is a demo folder, and every call
 * that would reach a server (USDB search, covers, YouTube, LRCLIB, the AI
 * environment) is answered from the data below, swapped in on the main
 * process' IPC handlers. No real song, lyric or library path ends up in the
 * public repo, and no run registers a USDB account: the profile carries
 * placeholder credentials, the failed login is then painted over.
 */
test.skip(
  process.env.DOCS_SCREENSHOTS !== "1",
  "only via bun run docs:screenshots",
);
test.describe.configure({ mode: "serial" });

const KATALOGE = { de, en, es } as const;
type Sprache = keyof typeof KATALOGE;

/** 8-bit mono PCM: silence, or a steady sine tone for the fake microphone. */
const wav = (sekunden: number, hz?: number): Buffer => {
  const rate = 16000;
  const daten = rate * sekunden;
  const b = Buffer.alloc(44 + daten);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + daten, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(daten, 40);
  for (let i = 0; i < daten; i += 1) {
    const wert =
      hz === undefined ? 0 : Math.sin((2 * Math.PI * hz * i) / rate) * 90;
    b.writeUInt8(Math.round(128 + wert), 44 + i);
  }
  return b;
};

// --- Demo data -------------------------------------------------------------

type Demo = {
  apiId: number;
  artist: string;
  title: string;
  language: string;
  genre: string;
  year: number;
  farben: [string, string];
};

const BIBLIOTHEK: Demo[] = [
  {
    apiId: 9001,
    artist: "Nova Lights",
    title: "Sternenlicht",
    language: "German",
    genre: "Pop",
    year: 2021,
    farben: ["#7c3aed", "#ec4899"],
  },
  {
    apiId: 9002,
    artist: "Kasimir & die Kometen",
    title: "Papierflieger",
    language: "German",
    genre: "Schlager",
    year: 1987,
    farben: ["#f59e0b", "#ef4444"],
  },
  {
    apiId: 9003,
    artist: "The Paper Moons",
    title: "Midnight Ferry",
    language: "English",
    genre: "Rock",
    year: 1979,
    farben: ["#0ea5e9", "#1e3a8a"],
  },
  {
    apiId: 9004,
    artist: "Luna Verde",
    title: "Bailando en la lluvia",
    language: "Spanish",
    genre: "Latin",
    year: 2016,
    farben: ["#10b981", "#065f46"],
  },
  {
    apiId: 9005,
    artist: "Echo Garden",
    title: "Glass Houses",
    language: "English",
    genre: "Indie",
    year: 2012,
    farben: ["#a3e635", "#166534"],
  },
  {
    apiId: 9006,
    artist: "Frida Falk",
    title: "Nordwind",
    language: "German",
    genre: "Pop",
    year: 2004,
    farben: ["#94a3b8", "#334155"],
  },
  {
    apiId: 9007,
    artist: "Los Faroles",
    title: "Corazón de neón",
    language: "Spanish",
    genre: "Pop",
    year: 1995,
    farben: ["#f472b6", "#7e22ce"],
  },
  {
    apiId: 9008,
    artist: "Silver Static",
    title: "Radio Heartbeat",
    language: "English",
    genre: "Electronic",
    year: 1984,
    farben: ["#22d3ee", "#7c3aed"],
  },
  {
    apiId: 9009,
    artist: "Die Demo-Band",
    title: "Ganz oben",
    language: "German",
    genre: "Rock",
    year: 1999,
    farben: ["#fb923c", "#9a3412"],
  },
  {
    apiId: 9010,
    artist: "Marlow Bay",
    title: "Salt & Honey",
    language: "English",
    genre: "Folk",
    year: 2019,
    farben: ["#fcd34d", "#b45309"],
  },
  {
    apiId: 9011,
    artist: "Tiny Satellites",
    title: "Orbit",
    language: "English",
    genre: "Pop",
    year: 2023,
    farben: ["#60a5fa", "#312e81"],
  },
  {
    apiId: 9012,
    artist: "Kasimir & die Kometen",
    title: "Sommer am See",
    language: "German",
    genre: "Schlager",
    year: 1991,
    farben: ["#facc15", "#0891b2"],
  },
];

const TREFFER = [
  {
    apiId: 9101,
    artist: "Aurora Kite",
    title: "Paper Skies",
    languages: ["English"],
    rating: 4.5,
    views: 12840,
  },
  {
    apiId: 9001,
    artist: "Nova Lights",
    title: "Sternenlicht",
    languages: ["German"],
    rating: 4,
    views: 9310,
  },
  {
    apiId: 9102,
    artist: "Nova Lights",
    title: "Funkenflug",
    languages: ["German"],
    rating: 3.5,
    views: 4120,
  },
  {
    apiId: 9103,
    artist: "Los Faroles",
    title: "Noche de verano",
    languages: ["Spanish"],
    rating: 5,
    views: 22015,
  },
  {
    apiId: 9003,
    artist: "The Paper Moons",
    title: "Midnight Ferry",
    languages: ["English"],
    rating: 4.5,
    views: 17602,
  },
  {
    apiId: 9104,
    artist: "Velvet Harbour",
    title: "Lighthouse",
    languages: ["English"],
    rating: 3,
    views: 2210,
  },
  {
    apiId: 9105,
    artist: "Kasimir & die Kometen",
    title: "Raketenherz",
    languages: ["German"],
    rating: 4,
    views: 6540,
  },
  {
    apiId: 9106,
    artist: "Mira Sol",
    title: "Dos corazones",
    languages: ["Spanish", "English"],
    rating: 4,
    views: 8034,
  },
  {
    apiId: 9008,
    artist: "Silver Static",
    title: "Radio Heartbeat",
    languages: ["English"],
    rating: 3.5,
    views: 5021,
  },
  {
    apiId: 9107,
    artist: "Echo Garden",
    title: "Little Fires",
    languages: ["English"],
    rating: 4.5,
    views: 11220,
  },
  {
    apiId: 9108,
    artist: "Frida Falk",
    title: "Leuchtturm",
    languages: ["German"],
    rating: 3,
    views: 1877,
  },
  {
    apiId: 9109,
    artist: "Tiny Satellites",
    title: "Gravity",
    languages: ["English"],
    rating: 4,
    views: 7395,
  },
];

const TREFFER_FARBEN: [string, string][] = [
  ["#38bdf8", "#6d28d9"],
  ["#7c3aed", "#ec4899"],
  ["#f97316", "#7c2d12"],
  ["#e11d48", "#fde047"],
  ["#0ea5e9", "#1e3a8a"],
  ["#14b8a6", "#1e293b"],
  ["#facc15", "#dc2626"],
  ["#f472b6", "#fb923c"],
  ["#22d3ee", "#7c3aed"],
  ["#a3e635", "#166534"],
  ["#cbd5e1", "#475569"],
  ["#60a5fa", "#312e81"],
];

/** UltraStar notes from lines of [syllable, pitch, length]; a 2-beat gap after each note. */
const noten = (zeilen: [string, number, number][][]): string[] => {
  const raus: string[] = [];
  let beat = 0;
  zeilen.forEach((zeile, z) => {
    for (const [silbe, ton, laenge] of zeile) {
      raus.push(`: ${beat} ${laenge} ${ton} ${silbe}`);
      beat += laenge + 1;
    }
    if (z < zeilen.length - 1) {
      beat += 4;
      raus.push(`- ${beat - 2}`);
    }
  });
  return raus;
};

// Lyrics written for this demo - not from any real song.
const STERNENLICHT = noten([
  [
    ["Wir ", 5, 3],
    ["tan", 7, 3],
    ["zen ", 9, 3],
    ["durch ", 9, 4],
    ["die ", 7, 3],
    ["Nacht", 5, 8],
  ],
  [
    ["bis ", 4, 3],
    ["der ", 5, 3],
    ["Mor", 7, 4],
    ["gen ", 9, 3],
    ["er", 10, 3],
    ["wacht", 9, 8],
  ],
  [
    ["Ster", 12, 4],
    ["nen", 10, 3],
    ["licht ", 9, 5],
    ["in ", 7, 3],
    ["dei", 9, 3],
    ["nen ", 7, 3],
    ["Au", 5, 4],
    ["gen", 4, 8],
  ],
]);

const songTxt = (d: Demo, zeilen: string[]): string =>
  [
    `#TITLE:${d.title}`,
    `#ARTIST:${d.artist}`,
    `#LANGUAGE:${d.language}`,
    `#GENRE:${d.genre}`,
    `#YEAR:${d.year}`,
    "#MP3:audio.wav",
    "#COVER:cover.jpg",
    "#VIDEO:video.mp4",
    "#BPM:300",
    "#GAP:2000",
    ...zeilen,
    "E",
    "",
  ].join("\n");

const KURZ = noten([
  [
    ["La ", 5, 4],
    ["la ", 7, 4],
    ["la", 9, 6],
  ],
]);

/** The song made in the wizard: not in the demo library, so no duplicate warning. */
const NEU = "Polarlicht";

const LRC = [
  "[00:12.40] Wir tanzen durch die Nacht",
  "[00:16.10] bis der Morgen erwacht",
  "[00:20.30] Sternenlicht in deinen Augen",
  "[00:25.00] und die Stadt hält den Atem an",
  "",
  "[00:31.20] Wir tanzen durch die Nacht",
  "[00:34.90] bis der Morgen erwacht",
].join("\n");

// --- Plumbing --------------------------------------------------------------

const APP_NAME = `ultrastar-docs-shots-${process.pid}`;
const datenDir = () => envPaths(APP_NAME, { suffix: "" }).cache;
const AUSGABE = join(import.meta.dirname, "..", "docs", "screenshots");
let bibliothek: string;
let mikroWav: string;
const ordner = (d: Demo) => join(bibliothek, `${d.artist} - ${d.title}`);
const finde = (titel: string) =>
  BIBLIOTHEK.find((d) => d.title === titel) as Demo;

/** Square covers and 16:9 thumbnails, drawn in the app's own renderer. */
const bilder = (
  page: Page,
  specs: { a: string; b: string; text: string; w: number; h: number }[],
) =>
  page.evaluate(
    (liste) =>
      liste.map(({ a, b, text, w, h }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d") as CanvasRenderingContext2D;
        const verlauf = g.createLinearGradient(0, 0, w, h);
        verlauf.addColorStop(0, a);
        verlauf.addColorStop(1, b);
        g.fillStyle = verlauf;
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 0.22;
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc(w * 0.72, h * 0.3, Math.min(w, h) * 0.32, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.font = `bold ${Math.round(h * 0.13)}px "Segoe UI", sans-serif`;
        g.fillText(text, w * 0.08, h * 0.86);
        return c.toDataURL("image/png");
      }),
    specs,
  );

const zuBuffer = (dataUrl: string) =>
  Buffer.from(dataUrl.split(",")[1] as string, "base64");

const starte = (): Promise<ElectronApplication> =>
  electron.launch({
    args: [
      "out/main/index.js",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${mikroWav}`,
    ],
    env: { ...process.env, ULTRASTAR_APP_NAME: APP_NAME },
  });

type Attrappen = {
  anzeigeOrdner: string;
  status: {
    loggedIn: boolean;
    ytDlpAvailable: boolean;
    ffmpegAvailable: boolean;
  };
  page: unknown;
  suchCover: Record<number, string>;
  youtube: unknown[];
  lrc: string;
  coverKandidaten: unknown[];
  queue: unknown[];
  creations: unknown[];
  failed: unknown[];
};

/**
 * Swaps the network-facing IPC handlers for demo answers. ipcMain keeps its
 * handlers in _invokeHandlers; replacing entries there sidesteps the
 * "second handler" guard of ipcMain.handle. Docs tooling only.
 */
const attrappen = (app: ElectronApplication, daten: Attrappen) =>
  app.evaluate(({ ipcMain }, d) => {
    // biome-ignore lint/suspicious/noExplicitAny: Electron internal
    const h = (ipcMain as any)._invokeHandlers as Map<
      string,
      (...a: unknown[]) => unknown
    >;
    const initial = h.get("app:getInitialState");
    if (!initial)
      throw new Error(
        "ipcMain internals changed: no app:getInitialState handler",
      );
    h.set("app:getInitialState", async (...a: unknown[]) => {
      const echt = (await initial(...a)) as { config: object | null };
      // The settings page shows the library path; the real one is a temp
      // folder under the user's profile.
      return {
        ...echt,
        config: { ...echt.config, downloadDir: d.anzeigeOrdner },
        status: d.status,
        queue: d.queue,
        creations: d.creations,
      };
    });
    h.set("usdb:search", async () => d.page);
    h.set(
      "covers:get",
      async (_e: unknown, apiId: unknown) =>
        d.suchCover[apiId as number] ?? null,
    );
    h.set("environment:status", async () => ({
      state: "ready",
      pythonVersion: "3.12.10",
      torchVariante: "cu128",
    }));
    h.set("create:youtubeSearch", async () => d.youtube);
    h.set("create:lyricsSearch", async () => d.lrc);
    h.set("create:coverCandidates", async () => d.coverKandidaten);
    h.set("downloads:failedList", async () => d.failed);
    h.set("binaries:status", async () => ({
      ytDlp: "system",
      ffmpeg: "system",
    }));
  }, daten);

const sende = (app: ElectronApplication, kanal: string, payload: unknown) =>
  app.evaluate(
    ({ BrowserWindow }, [k, p]) => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send(k as string, p);
    },
    [kanal, payload] as const,
  );

const foto = async (page: Page, sprache: Sprache, name: string) => {
  // Let covers decode and transitions settle before the shot.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(AUSGABE, sprache, `${name}.png`) });
};

// --- Setup -----------------------------------------------------------------

test.beforeAll(async () => {
  bibliothek = await mkdtemp(join(tmpdir(), "us-docs-lib-"));
  mikroWav = join(bibliothek, "mikro.wav");
  // A steady D4 for the sing-in shot.
  await writeFile(mikroWav, wav(30, 293.66));
  const eintraege = [];
  for (const [i, d] of BIBLIOTHEK.entries()) {
    const dir = ordner(d);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "song.txt"),
      songTxt(d, d.title === "Sternenlicht" ? STERNENLICHT : KURZ),
      "utf8",
    );
    await writeFile(join(dir, "audio.wav"), wav(12));
    await writeFile(join(dir, "video.mp4"), "demo");
    eintraege.push({
      apiId: d.apiId,
      artist: d.artist,
      title: d.title,
      dirName: `${d.artist} - ${d.title}`,
      songDir: dir,
      downloadedAt: new Date(Date.UTC(2026, 9, 31 - i, 18, 0)).toISOString(),
      language: d.language,
      genre: d.genre,
      year: d.year,
    });
  }
  // The uncertain-spots band on the second line of the demo song.
  await writeFile(
    join(ordner(finde("Sternenlicht")), "sync-hints.json"),
    JSON.stringify({
      version: 1,
      hints: [{ fromBeat: 32, toBeat: 60, kind: "interpolated" }],
    }),
  );
  await mkdir(datenDir(), { recursive: true });
  await writeFile(
    join(datenDir(), "downloaded.json"),
    JSON.stringify(eintraege),
  );
  // Placeholder credentials: without any, the app would register an account.
  await writeFile(
    join(datenDir(), "credentials.json"),
    JSON.stringify({ user: "docs-demo", pass: "docs-demo-only" }),
  );
});

test.afterAll(async () => {
  await rm(bibliothek, { recursive: true, force: true });
  await rm(dirname(datenDir()), { recursive: true, force: true });
});

// --- The shots ---------------------------------------------------------------

for (const sprache of Object.keys(KATALOGE) as Sprache[]) {
  test(`screenshots ${sprache}`, async () => {
    test.setTimeout(240_000);
    const t = KATALOGE[sprache];
    await mkdir(join(AUSGABE, sprache), { recursive: true });
    await writeFile(
      join(datenDir(), "config.json"),
      JSON.stringify({
        downloadDir: bibliothek,
        browser: "firefox",
        uiLanguage: sprache,
        genreProvider: "deezer",
        folderLayout: "flat",
        downloadConcurrency: 3,
        videoQuality: "1080",
      }),
    );

    const app = await starte();
    const page = await app.firstWindow();
    // Not by label yet: the first render can come up in the system language,
    // the reload below brings the configured one.
    await expect(page.locator("nav.sidebar")).toBeVisible();
    // The real start-up (failed placeholder login, tool check) has to be
    // over before the demo state is painted on, or it paints over it.
    await page.waitForTimeout(6000);

    // Covers for the library on disk, the rest as data URLs for the mocks.
    const coverDaten = await bilder(
      page,
      BIBLIOTHEK.map((d) => ({
        a: d.farben[0],
        b: d.farben[1],
        text: d.artist.split(" ")[0] as string,
        w: 300,
        h: 300,
      })),
    );
    for (const [i, d] of BIBLIOTHEK.entries())
      await writeFile(
        join(ordner(d), "cover.jpg"),
        zuBuffer(coverDaten[i] as string),
      );
    const trefferCover = await bilder(
      page,
      TREFFER.map((s, i) => ({
        a: (TREFFER_FARBEN[i] as [string, string])[0],
        b: (TREFFER_FARBEN[i] as [string, string])[1],
        text: s.artist.split(" ")[0] as string,
        w: 300,
        h: 300,
      })),
    );
    const thumbs = await bilder(page, [
      { a: "#7c3aed", b: "#ec4899", text: "", w: 480, h: 270 },
      { a: "#1e293b", b: "#7c3aed", text: "", w: 480, h: 270 },
      { a: "#0f172a", b: "#db2777", text: "", w: 480, h: 270 },
    ]);
    const album = await bilder(page, [
      { a: "#4c1d95", b: "#f472b6", text: "Nova", w: 300, h: 300 },
    ]);

    // Library entries carry USDB ids, so their covers come via covers:get too.
    const suchCover: Record<number, string> = {};
    BIBLIOTHEK.forEach((d, i) => {
      suchCover[d.apiId] = coverDaten[i] as string;
    });
    TREFFER.forEach((s, i) => {
      suchCover[s.apiId] = trefferCover[i] as string;
    });
    const sterne = finde("Sternenlicht");
    await attrappen(app, {
      anzeigeOrdner: String.raw`D:\UltraStar\Songs`,
      status: { loggedIn: true, ytDlpAvailable: true, ffmpegAvailable: true },
      page: { totalPages: 7, songs: TREFFER },
      suchCover,
      youtube: [
        [`Nova Lights - ${NEU} (Official Video)`, "Nova Lights", 214, 0],
        [`Nova Lights - ${NEU} (Live)`, "Nova Lights Fans", 251, 1],
        [`${NEU} - Nova Lights (Lyrics)`, "Lyric Lounge", 213, 2],
      ].map(([titel, kanal, dauer, bild], i) => ({
        id: `demo${i}`,
        url: `https://www.youtube.com/watch?v=demo${i}`,
        title: titel,
        description: null,
        duration: dauer,
        channel_id: `c${i}`,
        channel: kanal,
        channel_url: "",
        thumbnails: [{ url: thumbs[bild as number] }],
        view_count: 1000,
        channel_is_verified: false,
      })),
      lrc: LRC,
      coverKandidaten: [
        { kind: "caa", pfad: "demo-caa.jpg", dataUrl: album[0] },
        { kind: "thumbnail", pfad: "demo-thumb.jpg", dataUrl: thumbs[0] },
      ],
      queue: TREFFER.filter((s) => ![9001, 9003, 9008].includes(s.apiId)).slice(
        0,
        7,
      ),
      creations: [
        {
          id: "c1",
          artist: "Nova Lights",
          title: "Funkenflug",
          status: "running",
          stage: "align",
          progress: 0.58,
        },
        {
          id: "c2",
          artist: "Marlow Bay",
          title: "Lantern Song",
          status: "queued",
        },
        {
          id: "c3",
          artist: "Nova Lights",
          title: "Sternenlicht",
          status: "completed",
          songDir: ordner(sterne),
          dirName: `${sterne.artist} - ${sterne.title}`,
          lowConfidence: true,
        },
      ],
      failed: [
        {
          apiId: 9201,
          artist: "Velvet Harbour",
          title: "Undertow",
          error: "Video unavailable",
          usdbUrl: "",
          timestamp: "2026-10-31T17:02:00.000Z",
        },
        {
          apiId: 9202,
          artist: "Aurora Kite",
          title: "Northbound",
          error: "YouTube bot protection blocked the download",
          usdbUrl: "",
          timestamp: "2026-10-31T17:04:00.000Z",
        },
      ],
    });
    // Wider than the default window: the library toolbar needs the room.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        w.setContentSize(1440, 900);
    });
    await page.reload();
    await expect(
      page
        .locator("nav.sidebar")
        .getByRole("button", { name: t.nav.search, exact: true }),
    ).toBeVisible();
    // The support card would sit on top of every shot. Hidden, not snoozed:
    // snoozing writes to the shared Electron profile and depends on it.
    await page.addStyleTag({
      content: ".support-card { display: none !important; }",
    });

    // 1. Search with results.
    await page.getByPlaceholder(t.search.artistPlaceholder).fill("");
    await page
      .locator("main")
      .getByRole("button", { name: t.search.searchButton, exact: true })
      .click();
    await expect(page.getByText("Paper Skies")).toBeVisible();
    await foto(page, sprache, "search");

    // 2. The filter panel.
    await page
      .getByRole("button", { name: new RegExp(`^${t.search.filters}`) })
      .click();
    await foto(page, sprache, "search-filters");

    // 3. Queue: downloads, creations, failures.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: new RegExp(`^${t.nav.queue}`) })
      .click();
    await page.getByText(t.queue.failed(2)).click();
    await foto(page, sprache, "queue");
    await page
      .getByRole("heading", { name: t.queue.creations })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: t.creation.details }).last().click();
    await page
      .getByRole("heading", { name: t.queue.creations })
      .scrollIntoViewIfNeeded();
    await foto(page, sprache, "queue-creations");

    // 4. Library.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: t.nav.downloaded, exact: true })
      .click();
    await expect(page.getByText("Midnight Ferry")).toBeVisible();
    await foto(page, sprache, "library");

    // 5. Repair, with a finished run.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: t.nav.repair, exact: true })
      .click();
    await sende(app, "event:repair", {
      running: false,
      progress: null,
      result: {
        total: 46,
        fixed: 41,
        rebuilt: 3,
        failed: ["Velvet Harbour - Undertow", "Aurora Kite - Northbound"],
        errors: [
          [
            "Velvet Harbour - Undertow",
            { type: "video_unavailable", message: "Video unavailable" },
          ],
          [
            "Aurora Kite - Northbound",
            {
              type: "bot_protection",
              message: "Sign in to confirm you're not a bot",
            },
          ],
        ],
      },
    });
    await foto(page, sprache, "repair");

    // 6. Settings.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: t.nav.settings, exact: true })
      .click();
    await foto(page, sprache, "settings");

    // 7. The creation wizard, steps 2 to 5.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: t.nav.create, exact: true })
      .click();
    await page
      .getByPlaceholder(t.create.song.artistPlaceholder)
      .fill("Nova Lights");
    await page.getByPlaceholder(t.create.song.titlePlaceholder).fill(NEU);
    await foto(page, sprache, "create-song");
    await page.getByRole("button", { name: t.create.next }).click();
    await page
      .getByRole("button", { name: t.create.source.searchYoutube })
      .click();
    await page
      .getByRole("button", { name: t.create.source.choose })
      .first()
      .click();
    await foto(page, sprache, "create-source");
    await page.getByRole("button", { name: t.create.next }).click();
    await page.getByRole("button", { name: t.create.lyrics.lookUp }).click();
    await expect(page.getByText(t.create.lyrics.found)).toBeVisible();
    await foto(page, sprache, "create-lyrics");
    await page.getByRole("button", { name: t.create.next }).click();
    await page.getByText(t.create.cover.albumCover).first().click();
    await foto(page, sprache, "create-cover");
    await page.getByRole("button", { name: t.create.next }).click();
    await foto(page, sprache, "create-review");

    // 8. The editor: a note selected, the uncertain spot, singing in.
    await page
      .locator("nav.sidebar")
      .getByRole("button", { name: t.nav.downloaded, exact: true })
      .click();
    await page
      .getByRole("row", { name: /Sternenlicht/ })
      .getByRole("button", { name: t.editor.open })
      .click();
    await expect(page.getByText(t.editor.noteCount("20"))).toBeVisible();
    // "licht" on the third line, outside the uncertain band.
    for (let i = 0; i < 15; i += 1) await page.keyboard.press("ArrowRight");
    await foto(page, sprache, "editor");

    await page.getByRole("button", { name: t.editor.unsureCount(1) }).click();
    await foto(page, sprache, "editor-uncertain");

    // Back to the first line: its lead-in lies inside the GAP.
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("i");
    await expect(page.getByText(t.editor.singRecording)).toBeVisible();
    await expect(page.getByText(t.editor.singRecording)).toHaveCount(0, {
      timeout: 20_000,
    });
    await foto(page, sprache, "editor-singin");
    await page.keyboard.press("Escape");

    // 9. The conflict bar: the file changes under the editor.
    await page.keyboard.press("ArrowUp");
    const songFile = join(ordner(sterne), "song.txt");
    await writeFile(
      songFile,
      songTxt(sterne, STERNENLICHT).replace("#GAP:2000", "#GAP:2050"),
      "utf8",
    );
    await page.keyboard.press("Control+s");
    await expect(
      page.getByRole("button", { name: t.editor.conflictReload }),
    ).toBeVisible();
    await foto(page, sprache, "editor-conflict");
    await page.getByRole("button", { name: t.editor.conflictReload }).click();
    // Back to the demo file for the next language.
    await writeFile(songFile, songTxt(sterne, STERNENLICHT), "utf8");

    await app.close();
  });
}
