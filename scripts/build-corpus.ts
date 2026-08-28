// scripts/build-corpus.ts
// Baut ein Referenzkorpus-Manifest aus einer vorhandenen Song-Bibliothek.
// Aufruf: bun run scripts/build-corpus.ts D:/Ultrastar --language de --count 30
//         [--out scripts/reference-corpus.json]
//
// Von Hand ist so ein Manifest unbrauchbar: welcher der 28000 Ordner eine
// taugliche Referenz ist, sieht man ihm nicht an. Dieses Skript prueft jeden
// Kandidaten strukturell und schreibt nur durch, was der Harness auch
// verarbeiten kann. Ausgewaehlt wird deterministisch ueber einen Namenshash
// statt alphabetisch — sonst besteht der halbe Korpus aus einem Interpreten.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReferenceTxt } from "../src/core/create/evaluate.ts";
import { findeAudio } from "./evaluate-pipeline.ts";

/** Weniger Silben heisst: als Referenz zu duenn, die Metriken waeren Rauschen. */
const MIN_SILBEN = 40;
/** Obergrenze fuer gelesene song.txt, damit der Scan nicht ewig laeuft. */
const MAX_GELESEN = 4000;

type Kandidat = {
  artist: string;
  title: string;
  songDir: string;
  silben: number;
};

const header = (txt: string, name: string): string | null => {
  const m = new RegExp(`^#${name}:(.*)$`, "m").exec(txt);
  return m?.[1]?.trim() || null;
};

/** Stabile, aber nicht alphabetische Reihenfolge. */
const streuwert = (name: string): string =>
  createHash("sha256").update(name).digest("hex");

const pruefe = async (
  wurzel: string,
  ordner: string,
  sprache: string,
): Promise<Kandidat | { grund: string } | null> => {
  const songDir = join(wurzel, ordner);
  let txt: string;
  try {
    txt = await readFile(join(songDir, "song.txt"), "utf8");
  } catch {
    return null; // kein Songordner, kein Befund
  }
  const lang = header(txt, "LANGUAGE");
  // Ohne Sprachangabe kann der Lauf die falsche Sprache erwischen, und der
  // Vergleich misst dann die Sprachwahl statt das Modell.
  if (!lang) return { grund: "kein #LANGUAGE" };
  if (lang.toLowerCase() !== sprache.toLowerCase()) return null;

  const artist = header(txt, "ARTIST");
  const title = header(txt, "TITLE");
  if (!artist || !title) return { grund: "kein #ARTIST/#TITLE" };
  if (!header(txt, "BPM")) return { grund: "kein #BPM" };

  const referenz = parseReferenceTxt(txt);
  if (referenz.syllables.length < MIN_SILBEN) {
    return { grund: `nur ${referenz.syllables.length} Silben` };
  }
  if (!(await findeAudio(songDir, txt))) return { grund: "kein Audio" };

  return { artist, title, songDir, silben: referenz.syllables.length };
};

const arg = (name: string, standard?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : standard;
};

const main = async (): Promise<void> => {
  const wurzel = process.argv[2];
  if (!wurzel) {
    console.error(
      "Aufruf: bun run scripts/build-corpus.ts <songsDir> [--language de] [--count 30] [--out datei.json]",
    );
    process.exit(2);
  }
  const sprache = arg("language", "German") ?? "German";
  const anzahl = Number.parseInt(arg("count", "30") ?? "30", 10);
  const ziel =
    arg("out", "scripts/reference-corpus.json") ??
    "scripts/reference-corpus.json";

  const eintraege = await readdir(wurzel, { withFileTypes: true });
  const ordner = eintraege
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => streuwert(a).localeCompare(streuwert(b)));

  const treffer: Kandidat[] = [];
  const verworfen = new Map<string, number>();
  let gelesen = 0;

  for (const name of ordner) {
    if (treffer.length >= anzahl * 3 || gelesen >= MAX_GELESEN) break;
    const ergebnis = await pruefe(wurzel, name, sprache);
    gelesen += 1;
    if (ergebnis === null) continue;
    if ("grund" in ergebnis) {
      verworfen.set(ergebnis.grund, (verworfen.get(ergebnis.grund) ?? 0) + 1);
      continue;
    }
    treffer.push(ergebnis);
    if (treffer.length % 10 === 0) {
      process.stderr.write(
        `\r${treffer.length} Kandidaten aus ${gelesen} Ordnern   `,
      );
    }
  }
  process.stderr.write("\n");

  if (treffer.length === 0) {
    console.error(`Kein Song mit #LANGUAGE:${sprache} gefunden.`);
    process.exit(1);
  }

  // Bewusst KEINE Sortierung nach Laenge: die laengsten Songs sind nicht die
  // typischen, und ein Korpus aus Ausreissern misst etwas anderes als die
  // Bibliothek. Die Hash-Reihenfolge von oben ist die Stichprobe.
  const auswahl = treffer.slice(0, anzahl);

  await writeFile(
    ziel,
    `${JSON.stringify(
      {
        hinweis:
          "Erzeugt von scripts/build-corpus.ts. Gehoert nicht ins Repo (Urheberrecht).",
        language: sprache === "German" ? "de" : sprache,
        songs: auswahl.map((k) => ({
          artist: k.artist,
          title: k.title,
          songDir: k.songDir.replaceAll("\\", "/"),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`${auswahl.length} Songs geschrieben nach ${ziel}`);
  const silben = auswahl.map((k) => k.silben).sort((a, b) => a - b);
  console.log(
    `Silben je Song: ${silben[0]}–${silben.at(-1)} (Median ${
      silben[Math.floor(silben.length / 2)]
    })`,
  );
  if (verworfen.size > 0) {
    console.log("Verworfen:");
    for (const [grund, n] of [...verworfen].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}× ${grund}`);
    }
  }
};

if (import.meta.main) {
  await main();
}
