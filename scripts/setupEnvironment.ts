// Developer entry for the managed sidecar environment - replaces the manual
// venv how-to from the subproject-1 plan. Usage:
//   bun run scripts/setupEnvironment.ts [--dir <envDir>] [--force] [--language de]
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  defaultRunner,
  environmentStatus,
  envPythonBin,
  installEnvironment,
  sidecarFingerprint,
} from "../src/core/create/environment.ts";

const argWert = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async (): Promise<void> => {
  const sidecar = resolve("python-sidecar");
  const envDir = resolve(argWert("--dir") ?? join(sidecar, ".venv-managed"));
  const fingerprint = await sidecarFingerprint(sidecar);

  const ergebnis = await Effect.runPromise(
    Effect.either(
      installEnvironment({
        envDir,
        binDir: join(sidecar, ".uv-bin"),
        sidecarDir: sidecar,
        bundledFingerprint: fingerprint,
        force: process.argv.includes("--force"),
        language: argWert("--language") ?? "de",
        runner: defaultRunner(),
        onProgress: (p) =>
          process.stderr.write(
            `\r${p.schritt}${p.detail ? ` ${p.detail}` : ""}${
              p.prozent !== null ? ` ${Math.round(p.prozent * 100)}%` : ""
            }    `,
          ),
      }),
    ),
  );
  process.stderr.write("\n");

  if (ergebnis._tag === "Left") {
    console.error(`FEHLER in Schritt ${ergebnis.left.schritt}: ${ergebnis.left.detail}`);
    process.exit(1);
  }
  const status = await Effect.runPromise(environmentStatus(envDir, fingerprint));
  console.log(`Status: ${status.state} (${status.torchVariante ?? "?"})`);
  console.log(`PIPELINE_PYTHON=${envPythonBin(envDir)}`);
};

if (import.meta.main) {
  await main();
}
