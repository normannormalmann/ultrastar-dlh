// src/core/create/pipeline.ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parseSongData, type SongData } from "./songData.ts";
import { resolvePythonBin } from "./environment.ts";
import { killProcessTree } from "./processTree.ts";

export type PipelineErrorKind =
  | "EnvMissing"
  | "LanguageUnsupported"
  | "AlignmentFailed"
  | "DeviceError"
  | "Cancelled"
  | "ContractMismatch"
  | "PipelineFailed";

export type PipelineError = { kind: PipelineErrorKind; detail?: string };

export type PipelineInput = {
  audioPath: string;
  lyricsPath: string;
  language: string;
  outPath: string;
  bpm?: number;
  device?: "auto" | "cuda" | "cpu";
  workDir?: string;
  /** Interpreter bzw. Skript. Tests setzen hier einen Ersatz-Sidecar ein. */
  pythonBin?: string;
  /** Managed environment directory; resolvePythonBin falls back to it. */
  managedEnvDir?: string;
  /** Pfad zu einer synchronisierten .lrc (LRCLIB) als zweite Evidenzquelle. */
  syncedLyricsPath?: string;
  onProgress?: (stage: string, percent: number) => void;
  signal?: AbortSignal;
};

const PROGRESS_PREFIX = "@@PROGRESS ";
const ERROR_PREFIX = "@@ERROR ";

/**
 * Python-Fehlerart -> unsere typisierte Art. Exportiert, weil der
 * Worker-Client (worker.ts) @@ERROR-Zeilen identisch abbilden muss - die
 * UI soll bei Queue-Jobs dieselben Fehlerarten sehen wie bei runPipeline.
 */
export const FEHLER_ABBILDUNG: Record<string, PipelineErrorKind> = {
  language_unsupported: "LanguageUnsupported",
  alignment_failed: "AlignmentFailed",
  device_error: "DeviceError",
  env_missing: "EnvMissing",
  audio_unreadable: "PipelineFailed",
  lyrics_unreadable: "PipelineFailed",
  lyrics_empty: "PipelineFailed",
  lyrics_unresolved: "PipelineFailed",
  pipeline_failed: "PipelineFailed",
};

/** Strukturierter Fehler des Sidecars, wie er ueber @@ERROR ankommt. */
type SidecarFehler = { kind: string; detail?: string } & Record<string, unknown>;

/**
 * Baut aus dem Fehlerobjekt eine lesbare Meldung. Nicht jede Fehlerart
 * liefert `detail` — language_unsupported liefert `language`,
 * lyrics_unresolved liefert `markers`, env_missing liefert `module`. Ohne
 * diese Zusammensetzung wuerde der Aufrufer nur die blanke Fehlerart sehen
 * und genau die Angabe verlieren, die den Fehler erst erklaert.
 */
export const baueDetail = (fehler: SidecarFehler): string => {
  if (typeof fehler.detail === "string") return fehler.detail;
  const zusatz = Object.entries(fehler)
    .filter(([schluessel]) => schluessel !== "kind")
    .map(([schluessel, wert]) => `${schluessel}=${Array.isArray(wert) ? wert.join(",") : String(wert)}`);
  return zusatz.length > 0 ? `${fehler.kind}: ${zusatz.join(" ")}` : fehler.kind;
};

const baueArgumente = (input: PipelineInput): string[] => {
  const args = [
    "--audio", input.audioPath,
    "--lyrics-file", input.lyricsPath,
    "--language", input.language,
    "--out", input.outPath,
  ];
  if (input.bpm !== undefined) args.push("--bpm", String(input.bpm));
  if (input.device) args.push("--device", input.device);
  if (input.workDir) args.push("--work-dir", input.workDir);
  if (input.syncedLyricsPath) args.push("--synced-lyrics", input.syncedLyricsPath);
  return args;
};

/**
 * Startet den Sidecar, liest Fortschritt und liefert validierte Daten.
 * Zeilen ohne Marker sind Log — torch und Demucs schreiben reichlich.
 */
export const runPipeline = (
  input: PipelineInput,
): Effect.Effect<SongData, PipelineError> =>
  Effect.tryPromise({
    try: async (): Promise<SongData> => {
      // Ein Signal, das schon vor dem Aufruf abgebrochen wurde, darf den
      // Sidecar nicht erst noch starten — sonst reagiert nur das spaetere
      // "abort"-Event, das hier nie mehr kommt.
      if (input.signal?.aborted) throw { kind: "Cancelled" } satisfies PipelineError;

      const bin = resolvePythonBin(input.pythonBin, input.managedEnvDir);
      // Ein .ts-Ersatz-Sidecar laeuft ueber bun, echtes Python als Modul.
      const [befehl, vorArgs] = bin.endsWith(".ts")
        ? (["bun", [bin]] as const)
        : ([bin, ["-m", "ultrastar_pipeline"]] as const);

      const kind = spawn(befehl, [...vorArgs, ...baueArgumente(input)], {
        stdio: ["ignore", "pipe", "pipe"],
        // Nur auf POSIX: macht das Kind zum Gruppenfuehrer, damit
        // process.kill(-pid) den ganzen Baum trifft. Auf Windows hat
        // detached eine andere Bedeutung, dort erledigt taskkill /t das.
        detached: process.platform !== "win32",
      });

      // Objekt-Wrapper statt einer einfachen Variable: eine Closure, die
      // eine reine let-Variable neu zuweist, wird von TS' Kontrollfluss-
      // Analyse beim spaeteren Lesen nicht verfolgt und narrowt faelschlich
      // auf `never`. Eine Objekteigenschaft entgeht diesem Fallstrick.
      const zustand: { fehler: SidecarFehler | null } = { fehler: null };
      let rest = "";

      const verarbeite = (stueck: string): void => {
        rest += stueck;
        const zeilen = rest.split("\n");
        rest = zeilen.pop() ?? "";
        for (const zeile of zeilen) {
          if (zeile.startsWith(PROGRESS_PREFIX)) {
            try {
              const p = JSON.parse(zeile.slice(PROGRESS_PREFIX.length));
              input.onProgress?.(String(p.stage), Number(p.percent));
            } catch {
              // Eine defekte Fortschrittszeile ist kein Grund abzubrechen.
            }
          } else if (zeile.startsWith(ERROR_PREFIX)) {
            try {
              zustand.fehler = JSON.parse(zeile.slice(ERROR_PREFIX.length));
            } catch {
              zustand.fehler = { kind: "pipeline_failed" };
            }
          }
        }
      };

      kind.stdout?.setEncoding("utf8");
      kind.stdout?.on("data", verarbeite);
      let logs = "";
      kind.stderr?.setEncoding("utf8");
      kind.stderr?.on("data", (s: string) => {
        logs += s;
      });

      // Abbruch killt den ganzen Prozessbaum: Demucs startet Kindprozesse.
      // Die Kill-Logik selbst lebt in processTree.ts, damit der langlebige
      // Worker-Client (worker.ts) exakt dasselbe Verhalten teilt.
      let abgebrochen = false;
      const abbrechen = (): void => {
        abgebrochen = true;
        killProcessTree(kind);
      };
      input.signal?.addEventListener("abort", abbrechen, { once: true });

      const code = await new Promise<number>((resolve, reject) => {
        kind.on("error", reject);
        kind.on("close", (c) => resolve(c ?? 1));
      });
      input.signal?.removeEventListener("abort", abbrechen);
      if (rest.length > 0) verarbeite("\n");

      if (abgebrochen) throw { kind: "Cancelled" } satisfies PipelineError;

      if (code !== 0) {
        if (zustand.fehler !== null) {
          const fehler = zustand.fehler;
          throw {
            kind: FEHLER_ABBILDUNG[fehler.kind] ?? "PipelineFailed",
            detail: baueDetail(fehler),
          } satisfies PipelineError;
        }
        throw {
          kind: "PipelineFailed",
          detail: `Exit ${code}. ${logs.slice(-500)}`,
        } satisfies PipelineError;
      }

      try {
        return parseSongData(JSON.parse(await readFile(input.outPath, "utf8")));
      } catch (fehler) {
        throw {
          kind: "ContractMismatch",
          detail: fehler instanceof Error ? fehler.message : String(fehler),
        } satisfies PipelineError;
      }
    },
    catch: (fehler): PipelineError => {
      if (
        typeof fehler === "object" &&
        fehler !== null &&
        "kind" in fehler &&
        typeof (fehler as { kind: unknown }).kind === "string"
      ) {
        return fehler as PipelineError;
      }
      const meldung = fehler instanceof Error ? fehler.message : String(fehler);
      // Spawn errors that indicate Python interpreter problems.
      if (meldung.includes("ENOENT") || meldung.includes("UNKNOWN") || meldung.includes("EACCES") || meldung.includes("EFTYPE")) {
        return {
          kind: "EnvMissing",
          detail: "Python-Interpreter nicht gefunden. KI-Umgebung in den Einstellungen einrichten.",
        };
      }
      return { kind: "PipelineFailed", detail: meldung };
    },
  });
