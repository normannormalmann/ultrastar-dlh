# Sidecar-Umgebung automatisch einrichten (Teilprojekt 2)

Teilprojekt 2 von 6 des Song-Erstellungs-Vorhabens
([Master-Spec](2026-07-26-song-creation-pipeline-core-design.md)). Vorbild im
Bestand: `src/desktop/main/binaries.ts` (yt-dlp/ffmpeg-Beschaffung). Externes
Vorbild: `scripts/setup-sidecar.ps1` aus
[UltraStarKaraokeMaker](https://github.com/walterfr/UltraStarKaraokeMaker)
(MIT, © walterfr) — dort produktionserprobt.

## Ausgangslage

Der Pipeline-Kern (Teilprojekt 1) ist fertig und gemessen, aber nur nutzbar,
wenn jemand von Hand eine Python-3.12-venv mit Torch/CUDA, WhisperX, Demucs
und SwiftF0 aufsetzt. Die Master-Spec nennt das „ein UX-Problem erster
Klasse" und hat entschieden: **bedarfsweise Installation statt Mitliefern**,
und die Umgebungsverwaltung **muss eine passende Python-Version selbst
beschaffen** — WhisperX ist auf aktuellen Python-Versionen nicht
installierbar (gemessen: ctranslate2-Pin ohne Wheel jenseits von 3.12/3.13).

Entschieden im Brainstorming (2026-07-30):

- **Anbindung:** Desktop-SettingsView (Button, wie die Binaries-Installation)
  plus Dev-Skript. Die TUI folgt erst mit Teilprojekt 5.
- **Modelle werden beim Setup vorgeladen** (~3–4 GB): das Setup meldet
  „fertig & getestet" statt den Riesen-Download in den ersten Song zu
  verstecken.
- **Werkzeug ist uv** (Astral, MIT/Apache): ein statisches Binary, das
  Python 3.12 selbst herunterlädt, venvs anlegt und Pakete installiert.
  Verworfen: System-Python voraussetzen (verletzt die Vorentscheidung),
  Embedded-Python-Zip (mehr Eigenbau, fragiler als uv).

## Architektur

| Einheit | Verantwortung |
|---|---|
| `src/core/create/environment.ts` *(neu)* | UI-freie Logik: Status ermitteln, Installation in benannten Schritten ausführen. Alle Prozess-/Netzzugriffe über injizierbare Runner (testbar ohne uv/Netz/GPU, Muster wie `fetchFn` in `lrclib.ts`). |
| `src/desktop/main/environment.ts` *(neu)* | IPC-Anbindung nach dem Muster von `binaries.ts`: Install-Lock, Fortschritts-Broadcast, Statusmeldung. |
| `src/desktop/shared/ipc-contract.ts` | Neue Kanäle `environment:status`, `environment:install` (Parameter `force`); Event `event:environmentProgress`. |
| SettingsView (`src/desktop/renderer/views/`) | Abschnitt „KI-Umgebung": Status, Fortschritt je Schritt, Button „Einrichten"/„Neu installieren". |
| `scripts/setup-environment.ts` *(neu)* | Dev-Einstieg: gleiche Core-Funktion per Kommandozeile; ersetzt die manuelle venv-Anleitung. Gibt am Ende den Interpreterpfad (`PIPELINE_PYTHON`) aus. |
| `src/core/create/pipeline.ts` | `resolvePythonBin()`: explizite Angabe > verwaltete Umgebung > `python` aus PATH. Die `EnvMissing`-Diagnose verweist auf die Einrichtung (Settings) statt auf „Teilprojekt 2". |
| `python-sidecar/ultrastar_pipeline/__main__.py` | Neuer Modus `--preload`: lädt alle Modelle einmal (Demucs, Whisper, Alignment für `--language`, SwiftF0), meldet `@@PROGRESS` je Modell und schreibt das Ergebnis (`{"device": ..., "modelle": ...}`) nach `--out`. |
| electron-builder-Konfiguration | `python-sidecar/` (ohne venv, Caches, Tests) als extraResource im Desktop-Build; im Dev-Modus wird der Repo-Pfad genutzt. |

## Ablauf der Installation (sechs benannte Schritte)

1. **uv beschaffen:** `uv.exe` aus dem offiziellen Release-Zip
   (`uv-x86_64-pc-windows-msvc.zip`) nach `userData/bin`, mit
   Fortschritts-Broadcast und Temp-Datei-Umbenennung wie in `binaries.ts`.
   Ein vorhandenes uv (managed oder PATH) wird wiederverwendet.
2. **venv anlegen:** `uv venv --python 3.12 <envDir>` — uv lädt Python 3.12
   selbst herunter, kein System-Python nötig. Zielordner:
   `userData/python-env` (Desktop) bzw. `python-sidecar/.venv-managed`
   (Dev-Skript, per `--dir` übersteuerbar).
3. **GPU erkennen:** `nvidia-smi` vorhanden und erfolgreich → CUDA-Variante,
   sonst CPU-Variante mit sichtbarer Warnung. Kein stilles Raten.
4. **Torch gepinnt installieren:** `uv pip install torch==2.8.0+cu128
   torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128`
   bzw. die CPU-Pendants vom CPU-Index. Der Pin ist Pflicht — Lektion aus
   USKMaker und aus Teilprojekt 1: ohne Pin degradiert die Installation
   still auf CPU. Die Variante (`cu128`/`cpu`) wandert ins Manifest.
5. **Sidecar installieren:** `uv pip install "<sidecarPfad>[models]"` —
   im Dev der Repo-Ordner, im Build der extraResource-Pfad.
6. **Modelle vorladen + Probelauf:** `<envPython> -m ultrastar_pipeline
   --preload --language de --out <envDir>/preload.json`. Erst wenn dieser
   Schritt durchläuft, gilt die Umgebung als `ready`. Weitere Sprachen
   laden ihre Alignment-Modelle beim ersten Song nach (bedarfsweise, wie
   von der Master-Spec vorgesehen).

Jeder Schritt meldet Fortschritt als `{ schritt, prozent | null, detail? }`.
Ein Install-Lock verhindert parallele Läufe (wie `installRunning` in
`binaries.ts`). `force=true` löscht die venv und installiert neu;
das verwaltete uv wird dabei aktualisiert, ein System-uv nie angefasst.

## Statusmodell

Grundlage ist ein Manifest `env.json` im env-Ordner — kein pip-Aufruf beim
App-Start:

```json
{
  "schemaVersion": 1,
  "sidecarVersion": "0.1.0",
  "pythonVersion": "3.12.x",
  "torchVariante": "cu128",
  "preload": { "ok": true, "device": "cuda", "datum": "2026-07-30" }
}
```

| Status | Bedingung |
|---|---|
| `missing` | kein Manifest oder kein `python.exe` in der venv |
| `broken` | letzter Install-/Preload-Schritt fehlgeschlagen (im Manifest festgehalten: welcher Schritt, stderr-Ende) |
| `outdated` | `sidecarVersion` im Manifest ≠ Version des gebündelten Sidecars (aus dessen `pyproject.toml`) |
| `ready` | alles andere |

`outdated` blockiert nicht: die Pipeline läuft mit der alten Umgebung, die
UI bietet die Aktualisierung an (Neuinstallation der Pakete, venv bleibt).

## Fehlerbehandlung

- **Nicht-Windows:** klare Fehlermeldung wie in `binaries.ts` („manuell
  einrichten"), keine halben Pfade.
- **Schritt schlägt fehl:** Status `broken` mit Schrittname und den letzten
  Zeilen stderr; Button wird zu „Erneut versuchen". Kein automatischer
  Retry-Loop.
- **Kein `nvidia-smi`:** CPU-Installation plus Warnung im Ergebnis und im
  Manifest — dieselbe Haltung wie `--device auto` im Sidecar.
- **Abbruch durch Nutzer:** laufender uv-/Preload-Prozessbaum wird gekillt
  (Muster aus `pipeline.ts`), Status `broken` mit Hinweis „abgebrochen".
- **Preload-OOM:** die bestehende Sidecar-Fehlerleitung (`device_error`)
  greift; die UI zeigt den CPU-Hinweis.

## Teststrategie

- **Core (`environment.test.ts`):** Statusmaschine über tmp-Verzeichnisse
  und synthetische Manifeste; Installationsablauf mit injizierten
  Fake-Runnern (Aufrufreihenfolge, Index-Wahl nach GPU-Erkennung,
  force-Semantik, Lock). Kein echtes uv, kein Netz, keine GPU.
- **Sidecar (`test_cli.py`):** `--preload` mit whisperx/demucs/swift-f0
  als Platzhalter-Module via `monkeypatch.setitem(sys.modules, ...)` —
  laedt alle Modellarten, schreibt das Ergebnis-JSON, meldet Fortschritt.
- **IPC:** bestehender Vertragstest um die neuen Kanäle erweitert.
- **Durchstich:** ein `slow`-markierter Test bzw. der Dev-Skript-Lauf auf
  dem Entwicklungsrechner (echtes uv, echte Modelle) — nicht in CI.

## Risiken

- **uv-Verfügbarkeit/Release-Layout:** URL zeigt auf das `latest`-Release;
  bricht Astral das Namensschema, schlägt Schritt 1 sichtbar fehl (kein
  stiller Defekt). Pinnen auf eine feste uv-Version ist bewusst nicht
  vorgesehen — uv ist rückwärtskompatibel und selbstständig.
- **Plattenplatz:** venv + Torch + Modelle ≈ 8–10 GB. Vor Schritt 2 wird
  der freie Platz geprüft und unter 12 GB gewarnt (nicht blockiert).
- **Modell-Downloads Dritter** (HuggingFace) können scheitern oder
  drosseln; der Preload-Schritt zeigt dann den echten Fehler statt eines
  Timeouts beim ersten Song.

## Bewusst nicht enthalten

Auto-Update der Python-Pakete, Deinstallation, Modell-Mitliefern im
Installer, TUI-Anbindung (Teilprojekt 5), persistenter Modell-Worker
(Teilprojekt 3), Linux/macOS-Setup (Fehlermeldung statt Halbgarem).
