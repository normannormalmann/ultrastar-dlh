// scripts/compare-runs.ts
// Gepaarter Vergleich zweier Messlaeufe von evaluate-pipeline.ts
// (Basis gegen Arm), mit vorab festgelegter Entscheidungsregel.
//
// Die Regel steht hier im Code und nicht im Kopf, damit sie nach dem Lauf
// nicht mehr verschoben werden kann: Ausschlussliste, Primaermetrik,
// Schwelle, Bootstrap-Seed und die Gueltigkeitswaechter sind Eingaben,
// die Entscheidung ist Ausgabe.
import type { Metrics } from "../src/core/create/evaluate.ts";

/** Eine Zeile aus der --out-Datei von evaluate-pipeline.ts. */
export type Zeile = {
  name: string;
  songDir: string;
  lrc: boolean;
  sekunden: number;
  m: Metrics;
  interpolationsAnteil: number;
};

/** Die --out-Datei eines Blocks. Mehrere Bloecke werden zu einem Lauf verkettet. */
export type Lauf = {
  modelle: Record<string, string>;
  songs: Zeile[];
  fehlschlaege: { name: string; songDir: string; fehler: string }[];
};

/** Metriken, die der Arm nicht veraendern darf. Weicht eine ab, ist ein
 * anderer Faktor als der untersuchte mitgewandert und der Lauf ungueltig. */
export const WAECHTER = [
  "anteilUnter50ms",
  "anteilUnter100ms",
  "anteilGepaart",
  "notenzahlDifferenz",
] as const satisfies readonly (keyof Metrics)[];

export type Optionen = {
  ausschluss: string[];
  primaer: keyof Metrics;
  schwellePunkte: number;
  seed: number;
  ziehungen: number;
};

export type Differenz = { name: string; basis: number; arm: number; punkte: number };

export type WaechterVerletzung = {
  name: string;
  /** Eine der Zeitmetriken aus WAECHTER oder "lrc": ob fuer den Song ein
   * LRC als Anker vorlag (0/1). Weicht das ab, hat LRCLIB in einem der
   * Laeufe nicht geantwortet, und das Alignment ist ein anderes. */
  metrik: (typeof WAECHTER)[number] | "lrc";
  basis: number;
  arm: number;
};

export type Vergleich = {
  songs: number;
  differenzen: Differenz[];
  mittelPunkte: number;
  /** 95-%-Bootstrap-Konfidenzintervall des Mittels, in Punkten. */
  ki: [number, number];
  ausgeschlossen: string[];
  ungepaart: { basis: string[]; arm: string[] };
  waechterVerletzungen: WaechterVerletzung[];
  sekundaer: {
    sekundenJeSong: { basis: number; arm: number };
    pitchOffsetStreuung: { basis: number; arm: number };
  };
  /** Gepaarte Songs mit |medianVersatzMs| ueber der Editionsgrenze, die
   * nicht auf der Ausschlussliste stehen: wahrscheinlich eine andere
   * Edition als die Referenz, siehe ultrastar-basislinie. */
  editionsHinweise: { name: string; medianVersatzMs: number }[];
  entscheidung: "uebernehmen" | "verworfen" | "ungueltig";
};

/** Ab diesem Versatz zwischen Referenz und Audio gilt ein Song als andere Edition. */
export const EDITIONS_GRENZE_MS = 2000;

/** Anteil (0..1) in Prozentpunkte. */
const punkte = (anteil: number): number => anteil * 100;

const mittel = (werte: number[]): number =>
  werte.length === 0 ? 0 : werte.reduce((s, x) => s + x, 0) / werte.length;

/** Stichproben-Standardabweichung (n − 1). */
const streuung = (werte: number[]): number => {
  if (werte.length < 2) return 0;
  const m = mittel(werte);
  return Math.sqrt(werte.reduce((s, x) => s + (x - m) ** 2, 0) / (werte.length - 1));
};

/** mulberry32: klein, deterministisch, reicht fuer ein Bootstrap. Ein
 * fester Seed macht das KI reproduzierbar — die Entscheidung darf nicht
 * davon abhaengen, wie oft man das Skript laufen laesst. */
const zufall = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Perzentil-Bootstrap des Mittels: Ziehen mit Zuruecklegen, 2,5 % und 97,5 %. */
export const bootstrapKi = (
  werte: number[],
  seed: number,
  ziehungen: number,
): [number, number] => {
  if (werte.length === 0) return [0, 0];
  const naechste = zufall(seed);
  const mittelwerte: number[] = [];
  for (let z = 0; z < ziehungen; z++) {
    let summe = 0;
    for (let i = 0; i < werte.length; i++) {
      summe += werte[Math.floor(naechste() * werte.length)] as number;
    }
    mittelwerte.push(summe / werte.length);
  }
  mittelwerte.sort((a, b) => a - b);
  const bei = (q: number): number =>
    mittelwerte[Math.min(mittelwerte.length - 1, Math.floor(q * mittelwerte.length))] as number;
  return [bei(0.025), bei(0.975)];
};

export const vergleicheLaeufe = (basis: Lauf, arm: Lauf, optionen: Optionen): Vergleich => {
  const raus = new Set(optionen.ausschluss);
  const basisZeilen = new Map(basis.songs.filter((z) => !raus.has(z.name)).map((z) => [z.name, z]));
  const armZeilen = new Map(arm.songs.filter((z) => !raus.has(z.name)).map((z) => [z.name, z]));
  const ausgeschlossen = [...basis.songs, ...arm.songs]
    .map((z) => z.name)
    .filter((name, i, alle) => raus.has(name) && alle.indexOf(name) === i);

  // Paarung ueber den Namen, in der Reihenfolge der Basis: ein Block kann
  // im Arm in anderer Reihenfolge gelaufen sein.
  const gepaart = [...basisZeilen.keys()].filter((name) => armZeilen.has(name));
  const ungepaart = {
    basis: [...basisZeilen.keys()].filter((name) => !armZeilen.has(name)),
    arm: [...armZeilen.keys()].filter((name) => !basisZeilen.has(name)),
  };

  const differenzen: Differenz[] = [];
  const waechterVerletzungen: WaechterVerletzung[] = [];
  for (const name of gepaart) {
    const b = basisZeilen.get(name) as Zeile;
    const a = armZeilen.get(name) as Zeile;
    const basisWert = b.m[optionen.primaer] as number;
    const armWert = a.m[optionen.primaer] as number;
    differenzen.push({
      name,
      basis: basisWert,
      arm: armWert,
      punkte: punkte(armWert) - punkte(basisWert),
    });
    if (b.lrc !== a.lrc) {
      waechterVerletzungen.push({ name, metrik: "lrc", basis: Number(b.lrc), arm: Number(a.lrc) });
    }
    for (const metrik of WAECHTER) {
      if (b.m[metrik] !== a.m[metrik]) {
        waechterVerletzungen.push({ name, metrik, basis: b.m[metrik], arm: a.m[metrik] });
      }
    }
  }

  const mittelPunkte = mittel(differenzen.map((d) => d.punkte));
  const ki = bootstrapKi(
    differenzen.map((d) => d.punkte),
    optionen.seed,
    optionen.ziehungen,
  );

  // Die Reihenfolge ist Teil der Regel: ein ungueltiger Lauf bekommt kein
  // "verworfen" — das klaenge, als haette der Arm fair verloren.
  let entscheidung: Vergleich["entscheidung"];
  if (waechterVerletzungen.length > 0) entscheidung = "ungueltig";
  else if (mittelPunkte >= optionen.schwellePunkte && ki[0] > 0) entscheidung = "uebernehmen";
  else entscheidung = "verworfen";

  const basisGepaart = gepaart.map((name) => basisZeilen.get(name) as Zeile);
  const armGepaart = gepaart.map((name) => armZeilen.get(name) as Zeile);
  const sekundaer: Vergleich["sekundaer"] = {
    sekundenJeSong: {
      basis: mittel(basisGepaart.map((z) => z.sekunden)),
      arm: mittel(armGepaart.map((z) => z.sekunden)),
    },
    pitchOffsetStreuung: {
      basis: streuung(basisGepaart.map((z) => z.m.medianPitchOffset)),
      arm: streuung(armGepaart.map((z) => z.m.medianPitchOffset)),
    },
  };

  const editionsHinweise = basisGepaart
    .filter((z) => Math.abs(z.m.medianVersatzMs) > EDITIONS_GRENZE_MS)
    .map((z) => ({ name: z.name, medianVersatzMs: z.m.medianVersatzMs }));

  return {
    songs: gepaart.length,
    differenzen,
    mittelPunkte,
    ki,
    ausgeschlossen,
    ungepaart,
    waechterVerletzungen,
    sekundaer,
    editionsHinweise,
    entscheidung,
  };
};

/** Bloecke (--offset/--limit-Laeufe) zu einem Lauf verketten. Doppelte
 * Songs oder abweichende Modelle sind Bedienfehler, keine Daten. */
export const verketteBloecke = (bloecke: Lauf[]): Lauf => {
  const erster = bloecke[0];
  if (!erster) throw new Error("kein Block angegeben");
  const gesehen = new Set<string>();
  const songs: Zeile[] = [];
  const fehlschlaege: Lauf["fehlschlaege"] = [];
  for (const block of bloecke) {
    for (const [stufe, modell] of Object.entries(block.modelle)) {
      if (erster.modelle[stufe] !== undefined && erster.modelle[stufe] !== modell) {
        throw new Error(
          `Bloecke mit verschiedenen Modellen: ${stufe} = ${erster.modelle[stufe]} und ${modell}`,
        );
      }
    }
    for (const z of block.songs) {
      if (gesehen.has(z.name)) throw new Error(`Song doppelt in den Bloecken: ${z.name}`);
      gesehen.add(z.name);
      songs.push(z);
    }
    fehlschlaege.push(...block.fehlschlaege);
  }
  return { modelle: { ...erster.modelle }, songs, fehlschlaege };
};

const vorzeichen = (x: number, stellen = 1): string =>
  `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(x).toFixed(stellen)}`;

const modelleAlsText = (modelle: Record<string, string>): string =>
  Object.entries(modelle)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ") || "(unbekannt)";

export const formatiereBericht = (
  v: Vergleich,
  basis: Lauf,
  arm: Lauf,
  optionen: Optionen,
): string => {
  const z: string[] = [];
  z.push(`Basis: ${modelleAlsText(basis.modelle)}`);
  z.push(`Arm:   ${modelleAlsText(arm.modelle)}`);
  z.push("");
  z.push(`Gepaarte Songs: ${v.songs}`);
  if (v.ausgeschlossen.length > 0) z.push(`Ausgeschlossen (${v.ausgeschlossen.length}): ${v.ausgeschlossen.join("; ")}`);
  if (v.ungepaart.basis.length > 0) z.push(`Nur in Basis: ${v.ungepaart.basis.join("; ")}`);
  if (v.ungepaart.arm.length > 0) z.push(`Nur im Arm:   ${v.ungepaart.arm.join("; ")}`);
  for (const lauf of [basis, arm]) {
    for (const f of lauf.fehlschlaege) z.push(`Fehlschlag (${lauf === basis ? "Basis" : "Arm"}): ${f.name}: ${f.fehler}`);
  }
  z.push("");
  z.push(`| Song | ${optionen.primaer} Basis | Arm | Differenz |`);
  z.push("|---|---|---|---|");
  for (const d of v.differenzen) {
    z.push(`| ${d.name} | ${punkte(d.basis).toFixed(0)}% | ${punkte(d.arm).toFixed(0)}% | ${vorzeichen(d.punkte)} |`);
  }
  z.push("");
  z.push(`Primaermetrik ${optionen.primaer}, gepaarte Differenz:`);
  z.push(`  Mittel ${vorzeichen(v.mittelPunkte)} Punkte, 95-%-KI [${vorzeichen(v.ki[0])}, ${vorzeichen(v.ki[1])}]`);
  z.push(`  (Bootstrap, ${optionen.ziehungen} Ziehungen, Seed ${optionen.seed}; Schwelle ${vorzeichen(optionen.schwellePunkte)})`);
  z.push("");
  z.push("Sekundaer:");
  z.push(`  Laufzeit je Song: Basis ${v.sekundaer.sekundenJeSong.basis.toFixed(0)} s, Arm ${v.sekundaer.sekundenJeSong.arm.toFixed(0)} s`);
  z.push(`  Streuung medianPitchOffset: Basis ${v.sekundaer.pitchOffsetStreuung.basis.toFixed(2)}, Arm ${v.sekundaer.pitchOffsetStreuung.arm.toFixed(2)} Halbtoene`);
  if (v.editionsHinweise.length > 0) {
    z.push("");
    z.push(`Hinweis: Versatz ueber ${EDITIONS_GRENZE_MS} ms, aber nicht ausgeschlossen (andere Edition?):`);
    for (const h of v.editionsHinweise) z.push(`  ${h.name}: ${h.medianVersatzMs.toFixed(0)} ms`);
  }
  if (v.waechterVerletzungen.length > 0) {
    z.push("");
    z.push("Waechter verletzt (diese Metriken duerfen sich nicht aendern):");
    for (const w of v.waechterVerletzungen) z.push(`  ${w.name}: ${w.metrik} ${w.basis} -> ${w.arm}`);
  }
  z.push("");
  z.push(`ENTSCHEIDUNG: ${v.entscheidung.toUpperCase()}`);
  return `${z.join("\n")}\n`;
};

const liesListe = (argv: string[], flag: string): string[] => {
  const i = argv.indexOf(flag);
  if (i < 0) return [];
  const werte: string[] = [];
  for (let k = i + 1; k < argv.length && !(argv[k] as string).startsWith("--"); k++) {
    werte.push(argv[k] as string);
  }
  return werte;
};

const liesWert = (argv: string[], flag: string): string | undefined => liesListe(argv, flag)[0];

const main = async (): Promise<void> => {
  const { readFile } = await import("node:fs/promises");
  const argv = process.argv.slice(2);
  const basisPfade = liesListe(argv, "--basis");
  const armPfade = liesListe(argv, "--arm");
  if (basisPfade.length === 0 || armPfade.length === 0) {
    console.error(
      "Aufruf: bun run scripts/compare-runs.ts --basis <block.json>... --arm <block.json>...\n" +
        "        [--ausschluss <liste.json>] [--primaer anteilPitchExakt] [--schwelle 5]\n" +
        "        [--seed 42] [--ziehungen 10000]\n" +
        "Die Ausschlussliste ist ein JSON-Array von Songnamen (\"Artist - Titel\").",
    );
    process.exit(2);
  }
  const lade = async (pfade: string[]): Promise<Lauf> =>
    verketteBloecke(
      await Promise.all(pfade.map(async (p) => JSON.parse(await readFile(p, "utf8")) as Lauf)),
    );
  const ausschlussPfad = liesWert(argv, "--ausschluss");
  const optionen: Optionen = {
    ausschluss: ausschlussPfad ? (JSON.parse(await readFile(ausschlussPfad, "utf8")) as string[]) : [],
    primaer: (liesWert(argv, "--primaer") ?? "anteilPitchExakt") as keyof Metrics,
    schwellePunkte: Number(liesWert(argv, "--schwelle") ?? 5),
    seed: Number(liesWert(argv, "--seed") ?? 42),
    ziehungen: Number(liesWert(argv, "--ziehungen") ?? 10000),
  };
  const [basis, arm] = await Promise.all([lade(basisPfade), lade(armPfade)]);
  const ergebnis = vergleicheLaeufe(basis, arm, optionen);
  process.stdout.write(formatiereBericht(ergebnis, basis, arm, optionen));
  process.exit(ergebnis.entscheidung === "ungueltig" ? 1 : 0);
};

if (import.meta.main) {
  main().catch((fehler) => {
    console.error(fehler instanceof Error ? fehler.message : String(fehler));
    process.exit(1);
  });
}
