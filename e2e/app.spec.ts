import { _electron as electron, expect, test } from "@playwright/test";

test("app boots and shows the search view", async () => {
  const app = await electron.launch({ args: ["out/main/index.js"] });
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
