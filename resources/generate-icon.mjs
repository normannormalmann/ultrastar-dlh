// Renders the icon SVGs via Playwright/Chromium into PNGs, packs them into
// a PNG-embedded ICO (Windows), and writes a single PNG (Linux).
// Usage: node resources/generate-icon.mjs
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const SMALL_SIZES = [16, 24, 32, 48]; // from icon-small.svg
const DETAIL_SIZES = [64, 128, 256]; // from icon.svg
const LINUX_ICON_SIZE = 512; // from icon.svg, for electron-builder (AppImage)

const renderPng = async (page, svg, size) => {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, type: "png" });
};

/** PNG-embedded ICO: ICONDIR + ICONDIRENTRYs + PNG blobs. */
const packIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o); // width (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height
    dir.writeUInt8(0, o + 2); // color palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
};

const smallSvg = await readFile(join(here, "icon-small.svg"), "utf8");
const detailSvg = await readFile(join(here, "icon.svg"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();

const entries = [];
for (const size of SMALL_SIZES) {
  entries.push({ size, png: await renderPng(page, smallSvg, size) });
}
for (const size of DETAIL_SIZES) {
  entries.push({ size, png: await renderPng(page, detailSvg, size) });
}
const linuxPng = await renderPng(page, detailSvg, LINUX_ICON_SIZE);
await browser.close();

entries.sort((a, b) => a.size - b.size);
const expected = [...SMALL_SIZES, ...DETAIL_SIZES].sort((a, b) => a - b);
const actual = entries.map((e) => e.size);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected sizes: ${actual.join(",")}`);
}

const ico = packIco(entries);
await writeFile(join(here, "icon.ico"), ico);
await writeFile(join(here, "icon.png"), linuxPng);
console.log(
  `icon.ico written: ${entries.length} entries (${actual.join(", ")} px), ${ico.length} bytes`,
);
console.log(
  `icon.png geschrieben: ${LINUX_ICON_SIZE}px, ${linuxPng.length} Bytes`,
);
