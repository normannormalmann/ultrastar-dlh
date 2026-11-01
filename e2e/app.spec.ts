import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";
import envPaths from "env-paths";

// An app name of its own: the test never touches the real config, and the
// UI language is pinned to German - the labels below are German, and a CI
// runner's locale is not.
const APP_NAME = `ultrastar-e2e-app-${process.pid}`;
const datenDir = () => envPaths(APP_NAME, { suffix: "" }).cache;
let bibliothek: string;

test.beforeAll(async () => {
  bibliothek = await mkdtemp(join(tmpdir(), "us-e2e-app-"));
  await mkdir(datenDir(), { recursive: true });
  await writeFile(
    join(datenDir(), "config.json"),
    JSON.stringify({
      downloadDir: bibliothek,
      browser: "none",
      uiLanguage: "de",
    }),
  );
});

test.afterAll(async () => {
  await rm(bibliothek, { recursive: true, force: true });
  await rm(dirname(datenDir()), { recursive: true, force: true });
});

const starte = (): Promise<ElectronApplication> =>
  electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, ULTRASTAR_APP_NAME: APP_NAME },
  });

test("app boots and shows the search view", async () => {
  const app = await starte();
  const window = await app.firstWindow();

  await expect(window).toHaveTitle("UltraStar - Dirty Little Helper");
  // Sidebar entries are present
  await expect(
    window.getByRole("button", { name: "Suche", exact: true }),
  ).toBeVisible();
  await expect(
    window.getByRole("button", { name: /^Queue( \d+)?$/ }),
  ).toBeVisible();
  await expect(
    window.getByRole("button", { name: "Einstellungen", exact: true }),
  ).toBeVisible();
  // Search view is the initial view
  await expect(window.getByPlaceholder("Interpret…")).toBeVisible();

  await app.close();
});

test("the configured UI language wins over the system language from the first render", async () => {
  // Spanish is neither the developer's system language nor the CI
  // runner's. A profile of its own, with placeholder credentials so the
  // start-up login does not register a USDB account; it fails, and it is
  // exactly that slow network round trip the config load used to wait on.
  const name = `ultrastar-e2e-lang-${process.pid}`;
  const dir = envPaths(name, { suffix: "" }).cache;
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      downloadDir: bibliothek,
      browser: "none",
      uiLanguage: "es",
    }),
  );
  await writeFile(
    join(dir, "credentials.json"),
    JSON.stringify({ user: "e2e-lang", pass: "e2e-lang-only" }),
  );
  const app = await electron.launch({
    args: ["out/main/index.js"],
    env: { ...process.env, ULTRASTAR_APP_NAME: name },
  });
  try {
    const window = await app.firstWindow();
    await expect(
      window
        .locator("nav.sidebar")
        .getByRole("button", { name: "Buscar", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});

test("the creation wizard reaches step 2", async () => {
  const app = await starte();
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
