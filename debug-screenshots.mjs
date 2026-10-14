// Erstellt Screenshots der App-Views für README/Tutorial (read-only).
// Wartet den initialen Bibliotheks-Scan ab (28k Ordner auf HDD = Minuten).
import { mkdir } from "node:fs/promises";
import { _electron as electron } from "playwright";

const OUT = "docs/screenshots";
await mkdir(OUT, { recursive: true });

const app = await electron.launch({ args: ["out/main/index.js"] });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1280, height: 800 });

const shot = async (name) => {
  await win.waitForTimeout(600);
  await win.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png`);
};

await win.waitForSelector(".app-shell", { timeout: 30000 });

// Auf Abschluss des Bestands-Scans warten: Bibliothek öffnen und auf >0 Einträge pollen
await win.getByRole("button", { name: "Heruntergeladen", exact: true }).click();
console.log("Warte auf Bibliotheks-Scan…");
await win.waitForFunction(
  () => {
    const h = document.querySelector("h2");
    return h && /\((\d{1,3}\.)*\d+\)/.test(h.textContent || "") && !h.textContent.includes("(0)");
  },
  { timeout: 420000, polling: 2000 },
);
console.log("Scan fertig.");
await win.waitForTimeout(4000); // lokale Cover laden
await shot("library");

// Suche mit echten Ergebnissen (jetzt mit ✓-Markern für Vorhandenes)
await win.getByRole("button", { name: "Suche", exact: true }).click();
await win.getByPlaceholder("Interpret…").fill("abba");
await win.getByRole("button", { name: "Suchen" }).click();
await win.waitForSelector(".song-table", { timeout: 30000 });
await win.waitForTimeout(2500);
await shot("search");

await win.getByRole("button", { name: /^Filter/ }).click();
await shot("search-filters");

await win.getByRole("button", { name: /^Queue( \d+)?$/ }).click();
await shot("queue");

await win.getByRole("button", { name: "Reparatur", exact: true }).click();
await shot("repair");

await win.getByRole("button", { name: "Einstellungen", exact: true }).click();
await win.waitForTimeout(1500);
await shot("settings");

await app.close();
console.log("Fertig.");
