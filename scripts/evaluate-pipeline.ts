// scripts/evaluate-pipeline.ts
// Qualitaetsnachweis: laesst die Pipeline gegen von Menschen gesyncte
// Referenzsongs laufen und meldet die Abweichung.
// Aufruf: bun run scripts/evaluate-pipeline.ts scripts/reference-corpus.json
//         [--out ergebnis.json]
// --out schreibt die Rohwerte je Song. Aus zwei Markdown-Tabellen laesst
// sich kein GEPAARTER Vergleich rechnen, und ungepaart verschenkt man bei
// dieser Streuung den Grossteil der Aussagekraft.
// Interpreter ueber PIPELINE_PYTHON steuern (z.B. die venv aus
// python-sidecar/.venv), sonst wird 'python' aus dem PATH genutzt.
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { Effect } from "effect";
import { compareToReference, type Metrics, parseReferenceTxt } from "../src/core/create/evaluate.ts";
import { runPipeline } from "../src/core/create/pipeline.ts";
import { renderSongTxt } from "../src/core/create/writeSongTxt.ts";
import { fetchSyncedLyrics } from "../src/core/create/lrclib.ts";

type Eintrag = { artist: string; title: string; songDir: string };

/** Ein Lauf, so wie er in die JSON-Ausgabe geht. */
type Zeile = {
  name: string;
  songDir: string;
  lrc: boolean;
  sekunden: number;
  m: Metrics;
  interpolationsAnteil: number;
};

/** Ein Song, der gar nicht erst ausgewertet werden konnte. */
type Fehlzeile = { name: string; songDir: string; fehler: string };

/**
 * Anteil der Noten, deren Zeiten interpoliert statt gemessen sind.
 * verarbeitung.py setzt confidence 0 fuer genau diese Abschnitte. Der
 * beste verfuegbare Mediator: hebt ein besserer Stem die Zeitmetriken,
 * dann fast sicher ueber mehr Anker und weniger Interpolation. Bewegt
 * sich dieser Wert nicht, waehrend die Zeiten sich bewegen, stimmt etwas
 * mit der Messung nicht.
 */
const interpolationsAnteil = (daten: {
  notes: unknown[];
  sections: { fromNoteIndex: number; toNoteIndex: number; confidence: number }[];
}): number => {
  if (daten.notes.length === 0) return 0;
  const interpoliert = daten.sections
    .filter((a) => a.confidence === 0)
    .reduce((summe, a) => summe + (a.toNoteIndex - a.fromNoteIndex), 0);
  return interpoliert / daten.notes.length;
};

// lrclib.ts liefert nur noch Text -- die Erstellen-UI hat zur Abfragezeit
// kein Songverzeichnis. Hier gibt es eines, und die Pipeline will einen
// Pfad, also cached dieses Skript selbst. Gleicher Dateiname wie vorher,
// damit .lrc aus frueheren Korpuslaeufen weiter zaehlen.
const LRC_DATEI = "synced-lyrics.lrc";

const gecachteLrc = async (songDir: string): Promise<string | null> => {
  const pfad = join(songDir, LRC_DATEI);
  try {
    await access(pfad);
    return pfad;
  } catch {
    return null;
  }
};

// Rueckfall, falls der #MP3-Header fehlt.
const AUDIO_KANDIDATEN = ["song.ogg", "song.mp3", "video.mp4", "audio.ogg", "audio.mp3"];

/**
 * Audio ueber den #MP3-Header des Referenz-.txt auflösen. Die Bibliothek
 * legt die Tonspur ueberwiegend als video.mp4 ab, nicht als song.ogg —
 * geratene Dateinamen finden dort nichts.
 */
export const findeAudio = async (dir: string, referenzTxt: string): Promise<string | null> => {
  const ausHeader = /^#MP3:(.*)$/m.exec(referenzTxt)?.[1]?.trim();
  if (ausHeader) {
    try {
      await access(join(dir, ausHeader));
      return join(dir, ausHeader);
    } catch {
      // Header zeigt ins Leere, Kandidaten versuchen
    }
  }
  for (const name of AUDIO_KANDIDATEN) {
    try {
      await access(join(dir, name));
      return join(dir, name);
    } catch {
      // weiter suchen
    }
  }
  return null;
};

/**
 * Baut aus dem Referenz-.txt die Lyrics-Zeilen zurueck: Silben eines
 * Abschnitts zusammensetzen, an "- " umbrechen. Damit stimmt die
 * Silbenfolge 1:1 mit der Referenz und der Vergleich ist wohldefiniert.
 */
export const lyricsAusReferenz = (referenzTxt: string): string[] => {
  const zeilen: string[] = [];
  let laufend = "";
  for (const roh of referenzTxt.split("\n")) {
    // Nur das Windows-Zeilenende kappen, nicht trimEnd(): die letzte Silbe
    // eines Worts traegt hier ihr Leerzeichen als Trennzeichen zum naechsten
    // Wort. trimEnd() wuerde genau dieses Leerzeichen verschlucken und alle
    // Woerter einer Zeile zu einer Silbe verschmelzen (gemessen: 1,09 statt
    // 4,49 Woerter/Zeile ueber 60 Referenzsongs).
    const z = roh.replace(/\r$/, "");
    const note = /^[:*FR]\s+-?\d+\s+\d+\s+-?\d+\s?(.*)$/.exec(z);
    if (note) {
      laufend += note[1] ?? "";
      continue;
    }
    if (z.startsWith("- ") && laufend.trim()) {
      zeilen.push(laufend.trim());
      laufend = "";
    }
  }
  if (laufend.trim()) zeilen.push(laufend.trim());
  return zeilen;
};

const execFileAsync = promisify(execFile);

/** Container, aus denen erst eine Tonspur geloest werden muss. */
const CONTAINER = [".mp4", ".webm", ".mkv", ".avi", ".mov"];
/** Neben der Referenz abgelegt, damit Wiederholungslaeufe sie finden. */
const AUDIO_DATEI = ".eval-audio.wav";

/**
 * Der Sidecar liest die Tonspur ueber libsndfile, und das kennt kein mp4.
 * Heruntergeladene Songs bestehen aber genau daraus: song.txt, cover.jpg,
 * video.mp4 - eine separate Audiodatei gibt es nicht. Ohne diesen Schritt
 * ist der Harness gegen eine echte Bibliothek nicht lauffaehig.
 *
 * ffmpeg kommt aus dem PATH; die App bringt es ohnehin mit. Das Ergebnis
 * liegt im Songordner, damit ein zweiter Lauf es wiederverwendet.
 */
const stelleAudioBereit = async (
  songDir: string,
  referenzTxt: string,
): Promise<string | null> => {
  const gefunden = await findeAudio(songDir, referenzTxt);
  if (!gefunden) return null;
  const istContainer = CONTAINER.some((e) => gefunden.toLowerCase().endsWith(e));
  if (!istContainer) return gefunden;

  const ziel = join(songDir, AUDIO_DATEI);
  try {
    await access(ziel);
    return ziel;
  } catch {
    // noch nicht extrahiert
  }
  try {
    // -vn: Bildspur weg. Mono/16 kHz waere verlockend, waere aber eine
    // stille Vorverarbeitung, die die Messung beeinflusst - der Sidecar
    // soll dasselbe Audio sehen wie im echten Lauf.
    await execFileAsync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", gefunden, "-vn", ziel],
      { maxBuffer: 1024 * 1024 },
    );
    return ziel;
  } catch (e) {
    console.error(
      `${songDir}: ffmpeg konnte keine Tonspur loesen: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
};

const main = async (): Promise<void> => {
  const manifestPfad = process.argv[2];
  if (!manifestPfad) {
    console.error("Aufruf: bun run scripts/evaluate-pipeline.ts <manifest.json>");
    process.exit(2);
  }

  const manifest = JSON.parse(await readFile(manifestPfad, "utf8")) as {
    language?: string;
    songs: Eintrag[];
  };
  const sprache = manifest.language ?? "de";
  // Nachtrag B: Modellpakete gehoeren in eine venv, nicht ins globale
  // Environment. Der Interpreter kommt daher aus der Umgebung, nicht aus
  // einer Konstante — so zeigt der Aufruf ohne Codeaenderung auf die venv.
  const pythonBin = process.env.PIPELINE_PYTHON ?? "python";
  const ergebnisse: Zeile[] = [];
  // Aus meta.stageVersions, damit die Datei selbst sagt, womit sie
  // gemessen wurde - sonst ist ein Vergleichslauf hinterher nicht mehr
  // zuzuordnen.
  let stufen: Record<string, string> = {};
  // Fehlschlaege wurden bisher nur nach stderr geschrieben und fallen
  // gelassen. Ein Arm, der drei Songs zum Absturz bringt, sieht dadurch
  // BESSER aus - genau die schweren Songs fehlen dann im Aggregat.
  const fehlschlaege: Fehlzeile[] = [];

  for (const song of manifest.songs) {
    const referenzTxt = await readFile(join(song.songDir, "song.txt"), "utf8");
    const referenz = parseReferenceTxt(referenzTxt);
    const audio = await stelleAudioBereit(song.songDir, referenzTxt);
    if (!audio) {
      console.error(`${song.artist} - ${song.title}: kein Audio gefunden, uebersprungen`);
      fehlschlaege.push({
        name: `${song.artist} - ${song.title}`,
        songDir: song.songDir,
        fehler: "kein Audio gefunden",
      });
      continue;
    }

    const lyricsPfad = join(song.songDir, ".eval-lyrics.txt");
    await writeFile(lyricsPfad, `${lyricsAusReferenz(referenzTxt).join("\n")}\n`, "utf8");

    const lauf = (syncedLyricsPath?: string) =>
      Effect.runPromise(
        Effect.either(
          runPipeline({
            audioPath: audio,
            lyricsPath: lyricsPfad,
            language: sprache,
            outPath: join(song.songDir, ".eval-song-data.json"),
            device: "auto",
            pythonBin,
            ...(syncedLyricsPath ? { syncedLyricsPath } : {}),
            onProgress: (stage, p) =>
              process.stderr.write(`\r${song.title}: ${stage} ${Math.round(p * 100)}%    `),
          }),
        ),
      );

    // Cache zuerst: bei wiederholten Bewertungslaeufen liegt die .lrc
    // schon im Songverzeichnis und es braucht nur einen Pipeline-Lauf.
    const begonnen = Date.now();
    let lrcPfad = await gecachteLrc(song.songDir);
    let ergebnis = await lauf(lrcPfad ?? undefined);
    process.stderr.write("\n");

    if (ergebnis._tag === "Right" && !lrcPfad) {
      // Die Dauer ist erst jetzt bekannt -- holen und bei Treffer neu
      // ausrichten (nur align rechnet neu, der Rest kommt aus dem Cache).
      const lrcText = await fetchSyncedLyrics({
        artist: song.artist,
        title: song.title,
        durationSec: ergebnis.right.meta.durationSec,
      });
      if (lrcText) {
        lrcPfad = join(song.songDir, LRC_DATEI);
        await writeFile(lrcPfad, lrcText, "utf8");
      }
      if (lrcPfad) {
        ergebnis = await lauf(lrcPfad);
        process.stderr.write("\n");
      }
    }

    if (ergebnis._tag === "Left") {
      const text = `${ergebnis.left.kind} ${ergebnis.left.detail ?? ""}`.trim();
      console.error(`${song.title}: FEHLER ${text}`);
      fehlschlaege.push({
        name: `${song.artist} - ${song.title}`,
        songDir: song.songDir,
        fehler: text,
      });
      continue;
    }

    const unser = parseReferenceTxt(
      renderSongTxt(ergebnis.right, {
        artist: song.artist,
        title: song.title,
        mp3: "x.ogg",
      }),
    );
    stufen = ergebnis.right.meta.stageVersions;
    ergebnisse.push({
      name: `${song.artist} - ${song.title}`,
      songDir: song.songDir,
      lrc: lrcPfad !== null,
      sekunden: Math.round((Date.now() - begonnen) / 1000),
      m: compareToReference(unser, referenz),
      interpolationsAnteil: interpolationsAnteil(ergebnis.right),
    });
  }

  if (ergebnisse.length === 0) {
    console.error("Kein Song ausgewertet.");
    process.exit(1);
  }

  console.log("");
  console.log(
    "| Song | LRC | Paare | Gepaart | Median ms | Versatz ms | p90 ms | <50ms | kal.<50 | kal.<100 | <100ms | Notendiff | Pitch-Offset | Pitch-Anteil |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { name, m, lrc } of ergebnisse) {
    console.log(
      `| ${name} | ${lrc ? "ja" : "nein"} | ${m.paare} | ${(m.anteilGepaart * 100).toFixed(0)}% | ` +
        `${m.medianAbweichungMs.toFixed(0)} | ${m.medianVersatzMs.toFixed(0)} | ` +
        `${m.p90AbweichungMs.toFixed(0)} | ${(m.anteilUnter50ms * 100).toFixed(0)}% | ` +
        `${(m.anteilUnter50msKalibriert * 100).toFixed(0)}% | ` +
        `${(m.anteilUnter100msKalibriert * 100).toFixed(0)}% | ` +
        `${(m.anteilUnter100ms * 100).toFixed(0)}% | ${m.notenzahlDifferenz} | ` +
        `${m.medianPitchOffset.toFixed(1)} | ${(m.anteilPitchExakt * 100).toFixed(0)}% |`,
    );
    // Driftprofil als eigene Zeile: die Tabellenzelle waere fuer zehn Werte
    // zu schmal, deshalb steht die Zahlenreihe direkt darunter.
    console.log(`  Driftprofil: ${m.driftProfil.map((w) => w.toFixed(0)).join(", ")}`);
    // |Versatz| > 2 s ist kein Alignment-Problem mehr, sondern ein Indiz,
    // dass die Referenz zu einer anderen Audio-Edition gehoert (im Pilot
    // hat genau dieser Fall einen ungueltigen Korpus-Song entlarvt).
    if (Math.abs(m.medianVersatzMs) > 2000) {
      console.log(
        "  Hinweis: |Versatz| > 2 s - Referenz passt vermutlich nicht zur Audio-Edition.",
      );
    }
  }

  const mittel = (f: (m: Metrics) => number): number =>
    ergebnisse.reduce((s, z) => s + f(z.m), 0) / ergebnisse.length;

  const mitLrc = ergebnisse.filter((z) => z.lrc).length;

  console.log("");
  console.log(`Songs:               ${ergebnisse.length}`);
  console.log(`Songs mit LRC:       ${mitLrc}/${ergebnisse.length}`);
  console.log(`Anteil gepaart:      ${(mittel((m) => m.anteilGepaart) * 100).toFixed(0)}%`);
  console.log(`Median-Abweichung:   ${mittel((m) => m.medianAbweichungMs).toFixed(0)} ms`);
  console.log(`Median-Versatz:      ${mittel((m) => m.medianVersatzMs).toFixed(0)} ms`);
  console.log(`p90-Abweichung:      ${mittel((m) => m.p90AbweichungMs).toFixed(0)} ms`);
  console.log(`Anteil <50 ms:       ${(mittel((m) => m.anteilUnter50ms) * 100).toFixed(0)}%`);
  console.log(`Anteil <50 ms (kal.): ${(mittel((m) => m.anteilUnter50msKalibriert) * 100).toFixed(0)}%`);
  console.log(`Anteil <100 ms (kal.): ${(mittel((m) => m.anteilUnter100msKalibriert) * 100).toFixed(0)}%`);
  console.log(`Anteil <100 ms:      ${(mittel((m) => m.anteilUnter100ms) * 100).toFixed(0)}%`);
  console.log(`Median-Pitch-Offset: ${mittel((m) => m.medianPitchOffset).toFixed(1)} Halbtoene`);
  console.log(`Anteil Pitch exakt:  ${(mittel((m) => m.anteilPitchExakt) * 100).toFixed(0)}%`);
  console.log(
    `Interpolationsanteil: ${(
      (ergebnisse.reduce((s2, z) => s2 + z.interpolationsAnteil, 0) /
        ergebnisse.length) *
      100
    ).toFixed(0)}%`,
  );

  // Fehlschlaege gehoeren ins Ergebnis, nicht nur nach stderr: sonst sieht
  // ein Lauf, der die schweren Songs verliert, besser aus als einer, der sie
  // durchbringt.
  if (fehlschlaege.length > 0) {
    console.log("");
    console.log(`Nicht ausgewertet:   ${fehlschlaege.length}`);
    for (const f of fehlschlaege) console.log(`  ${f.name}: ${f.fehler}`);
  }

  const outIndex = process.argv.indexOf("--out");
  const outPfad = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (outPfad) {
    await writeFile(
      outPfad,
      `${JSON.stringify(
        { modelle: stufen, songs: ergebnisse, fehlschlaege },
        null,
        2,
      )}
`,
      "utf8",
    );
    console.log("");
    console.log(`Rohwerte: ${outPfad}`);
  }
};

// Nur beim direkten Aufruf ausfuehren, nicht beim Import in Tests
// (lyricsAusReferenz ist fuer evaluate-pipeline.test.ts exportiert).
if (import.meta.main) {
  await main();
}
