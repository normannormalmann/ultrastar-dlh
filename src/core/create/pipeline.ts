// src/core/create/pipeline.ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parseSongData, type SongData } from "./songData.ts";

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
  onProgress?: (stage: string, percent: number) => void;
  signal?: AbortSignal;
};

const PROGRESS_PREFIX = "@@PROGRESS ";
const ERROR_PREFIX = "@@ERROR ";

/** Python-Fehlerart -> unsere typisierte Art. */
const FEHLER_ABBILDUNG: Record<string, PipelineErrorKind> = {
  language_unsupported: "LanguageUnsupported",
  alignment_failed: "AlignmentFailed",
  device_error: "DeviceError",
  audio_unreadable: "PipelineFailed",
  lyrics_unreadable: "PipelineFailed",
  lyrics_empty: "PipelineFailed",
  lyrics_unresolved: "PipelineFailed",
  pipeline_failed: "PipelineFailed",
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
      const bin = input.pythonBin ?? "python";
      // Ein .ts-Ersatz-Sidecar laeuft ueber bun, echtes Python als Modul.
      const [befehl, vorArgs] = bin.endsWith(".ts")
        ? (["bun", [bin]] as const)
        : ([bin, ["-m", "ultrastar_pipeline"]] as const);

      const kind = spawn(befehl, [...vorArgs, ...baueArgumente(input)], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Objekt-Wrapper statt einer einfachen Variable: eine Closure, die
      // eine reine let-Variable neu zuweist, wird von TS' Kontrollfluss-
      // Analyse beim spaeteren Lesen nicht verfolgt und narrowt faelschlich
      // auf `never`. Eine Objekteigenschaft entgeht diesem Fallstrick.
      const zustand: { fehler: { kind: string; detail?: string } | null } = { fehler: null };
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
      let abgebrochen = false;
      const abbrechen = (): void => {
        abgebrochen = true;
        if (kind.pid === undefined) return;
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(kind.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          try {
            process.kill(-kind.pid, "SIGKILL");
          } catch {
            kind.kill("SIGKILL");
          }
        }
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
            detail: fehler.detail ?? fehler.kind,
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
      // ENOENT beim Spawn heisst: Interpreter nicht gefunden.
      if (meldung.includes("ENOENT")) {
        return {
          kind: "EnvMissing",
          detail: "Python-Interpreter nicht gefunden. Umgebung einrichten (Teilprojekt 2).",
        };
      }
      return { kind: "PipelineFailed", detail: meldung };
    },
  });
