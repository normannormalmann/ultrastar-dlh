// Prueft BEATS_PER_BPM_UNIT gegen echte, von Menschen gesyncte .txt-Dateien.
// Aufruf: bun run scripts/measure-beat-convention.ts <songs-verzeichnis>
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BEATS_PER_BPM_UNIT, beatToMs } from "../src/core/create/format.ts";

type Befund = { datei: string; verhaeltnis: number };

/** #BPM lesen; deutsche Dateien nutzen Komma als Dezimaltrenner. */
const leseBpm = (txt: string): number | null => {
  const m = /^#BPM:(.*)$/m.exec(txt);
  if (!m?.[1]) return null;
  const wert = Number.parseFloat(m[1].trim().replace(",", "."));
  return Number.isNaN(wert) ? null : wert;
};

const leseGap = (txt: string): number => {
  const m = /^#GAP:(.*)$/m.exec(txt);
  const wert = Number.parseFloat((m?.[1] ?? "0").trim().replace(",", "."));
  return Number.isNaN(wert) ? 0 : wert;
};

/** Groesster Beat plus Laenge aus allen Notenzeilen. */
const letzterBeat = (txt: string): number | null => {
  let max: number | null = null;
  for (const zeile of txt.split("\n")) {
    const m = /^[:*FR]\s+(-?\d+)\s+(\d+)\s+(-?\d+)/.exec(zeile.trim());
    if (!m?.[1] || !m[2]) continue;
    const ende = Number.parseInt(m[1], 10) + Number.parseInt(m[2], 10);
    if (max === null || ende > max) max = ende;
  }
  return max;
};

/** Mediendatei aus dem #MP3-Header; die Bibliothek nutzt oft video.mp4. */
const leseMedium = (txt: string): string | null => {
  const m = /^#MP3:(.*)$/m.exec(txt);
  const name = m?.[1]?.trim();
  return name && name.length > 0 ? name : null;
};

/** Laufzeit der Mediendatei in Sekunden, ueber ffprobe. */
const audioDauer = (pfad: string): number | null => {
  const p = Bun.spawnSync([
    "ffprobe", "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0", pfad,
  ]);
  if (p.exitCode !== 0) return null;
  const wert = Number.parseFloat(new TextDecoder().decode(p.stdout).trim());
  return Number.isNaN(wert) || wert <= 0 ? null : wert;
};

// Fenster fuer das Verhaeltnis Songende/Audiodauer. Zweiseitig, und das ist
// entscheidend: eine reine Obergrenze laesst auch Faktor 8 durch, bei dem
// der Song nach der halben Datei enden wuerde.
const MIN_VERHAELTNIS = 0.6;
const MAX_VERHAELTNIS = 1.05;

const main = async (): Promise<void> => {
  const wurzel = process.argv[2];
  const grenze = Number.parseInt(process.argv[3] ?? "40", 10);
  if (!wurzel) {
    console.error(
      "Aufruf: bun run scripts/measure-beat-convention.ts <songs-verzeichnis> [anzahl]",
    );
    process.exit(2);
  }

  const befunde: Befund[] = [];
  for (const eintrag of await readdir(wurzel, { withFileTypes: true })) {
    if (befunde.length >= grenze) break;
    if (!eintrag.isDirectory()) continue;
    const txtPfad = join(wurzel, eintrag.name, "song.txt");
    try {
      if (!(await stat(txtPfad)).isFile()) continue;
    } catch {
      continue;
    }
    const txt = await readFile(txtPfad, "utf8");
    const bpm = leseBpm(txt);
    const beat = letzterBeat(txt);
    const medium = leseMedium(txt);
    if (bpm === null || beat === null || medium === null) continue;

    const dauer = audioDauer(join(wurzel, eintrag.name, medium));
    if (dauer === null) continue;

    const endeSek = beatToMs(beat, bpm, leseGap(txt)) / 1000;
    befunde.push({ datei: eintrag.name, verhaeltnis: endeSek / dauer });
  }

  if (befunde.length === 0) {
    console.error("Keine auswertbaren Songs mit Mediendatei gefunden.");
    process.exit(1);
  }

  const werte = befunde.map((b) => b.verhaeltnis).sort((a, b) => a - b);
  const median = werte[Math.floor(werte.length / 2)] ?? 0;
  const imFenster = werte.filter(
    (v) => v >= MIN_VERHAELTNIS && v <= MAX_VERHAELTNIS,
  ).length;

  console.log(`Songs mit Audiodauer:  ${befunde.length}`);
  console.log(`BEATS_PER_BPM_UNIT:    ${BEATS_PER_BPM_UNIT}`);
  console.log(`Median Songende/Audio: ${median.toFixed(3)}`);
  console.log(
    `Im Fenster ${MIN_VERHAELTNIS}-${MAX_VERHAELTNIS}:  ${imFenster}/${befunde.length}`,
  );
  console.log("");
  console.log(
    imFenster / befunde.length >= 0.9
      ? "OK: Faktor ist konsistent mit dem Referenzkorpus."
      : "FEHLER: Faktor passt nicht. Mit 1, 2, 8 gegenpruefen.",
  );
};

await main();
