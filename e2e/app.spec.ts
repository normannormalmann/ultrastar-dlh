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
