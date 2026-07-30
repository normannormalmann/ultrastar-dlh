# TS-Orchestrierung mit persistentem Sidecar-Worker (Teilprojekt 3)

Teilprojekt 3 von 6 des Song-Erstellungs-Vorhabens
([Master-Spec](2026-07-26-song-creation-pipeline-core-design.md)). Vorbilder im
Bestand: `src/desktop/main/downloads.ts` (Queue-Orchestrierung, nie werfende
Job-Wrapper), `src/desktop/main/environment.ts` (TP2). Externes Vorbild:
UltraStarKaraokeMaker (MIT, © walterfr) — persistenter Worker über
stdin-JSON-Zeilen, warme Modelle. Die Master-Spec hatte den Dauer-Worker
bewusst zurückgestellt („später möglich, ohne den Vertrag zu brechen") —
genau dieser Schritt ist jetzt dran, per Roadmap-Entscheidung vom 2026-07-30.

## Entschieden im Brainstorming (2026-07-30)

- **Persistenter Worker** (warme Modelle: ab dem zweiten Song entfallen
  30–60 s Ladezeit; USKMakers gemessener Queue-Vorteil) plus unser
  Stufencache.
- **Idle-Timeout ~5 Minuten:** nach dem letzten Job bleibt der Worker warm,
  dann fährt er herunter und gibt den GPU-Speicher (~4–6 GB VRAM) frei.
- **In-Memory-Queue:** Jobdefinitionen sind vor TP4/TP5 noch im Fluss;
  Persistenz wird nachgerüstet, wenn sie final sind.
- **Ein Job gleichzeitig** — eine GPU, sequenzielle Verarbeitung.
- **Abbruch = Prozessbaum killen + Worker neu starten.** Mitten in Demucs
  gibt es nichts Feineres; der Preis ist ein Kaltstart beim nächsten Job.

## Architektur

| Einheit | Verantwortung |
|---|---|
| `python-sidecar/ultrastar_pipeline/worker.py` *(neu)* | Worker-Schleife: liest je stdin-Zeile einen Job (JSON, Felder wie die CLI-Argumente: `id`, `audio`, `lyricsFile`, `language`, `out`, optional `bpm`, `device`, `workDir`, `syncedLyrics`), führt den geteilten Verarbeitungskern aus, meldet `@@JOB {"id": ..., "ok": true\|false}` je Jobende. `@@READY` nach dem Start. EOF auf stdin beendet den Worker sauber. |
| `python-sidecar/ultrastar_pipeline/__main__.py` | `--worker`-Flag; der Kern von `main()` wird in eine geteilte Funktion gehoben (`verarbeite_auftrag`), die CLI und Worker identisch nutzen — gleiche Fehlerleitung, gleiche `@@PROGRESS`/`@@ERROR`-Ausgaben, gleicher Vertrag (song_data.json an `out`). |
| Modell-Caches in `transcribe.py`/`align.py`/`separate.py`/`pitch.py` | Modul-Level-Caches für Modell-Handles (Schlüssel: Modell/Device bzw. Sprache/Device), damit Modelle im Worker-Prozess wirklich warm bleiben — heute lädt jede Stufe ihr Modell je Aufruf (im Ein-Job-CLI egal, im Worker der ganze Witz). USKMaker-Muster `_get_whisper_model`/`_get_align_model`. |
| `src/core/create/worker.ts` *(neu)* | `SidecarWorker`: Prozess starten (über `resolvePythonBin` inkl. `managedEnvDir`), Zeilen-Demux (`@@PROGRESS` → Fortschritt des laufenden Jobs, `@@ERROR` → dessen Fehler, `@@JOB` → Promise-Abschluss), `submitJob`, `cancelCurrentJob` (Prozessbaum killen, Muster aus `pipeline.ts`), Idle-Timer (5 min → Shutdown), `shutdown` (stdin schließen, Kill-Fallback), Crash-Erkennung (Exit während eines Jobs → Job failed). Prozess-/Timer-Zugriffe injizierbar (testbar ohne Python, Muster `fakeSidecar`/Runner aus TP2). |
| `src/desktop/main/creations.ts` *(neu)* | Orchestrierung nach dem `downloads.ts`-Muster: In-Memory-Queue, ein aktiver Job, nie werfender Job-Wrapper, Status-Broadcasts, Umgebungs-Gate (Status nicht `ready` → Fehler-Event mit Verweis auf die Einstellungen), Crash-Zähler (drei Worker-Crashs in Folge → Queue pausiert mit Fehler-Event). |
| `src/desktop/shared/ipcContract.ts` | `CreateJobRequest { id, audioPath, lyricsPath, language, outPath, bpm?, syncedLyricsPath? }`; `CreationEntry { id, artist?, title?, status: "queued"\|"running"\|"completed"\|"failed", stage?, progress?, error? }`; Invoke-Kanäle `create:queueAdd`, `create:queueRemove`, `create:queueClear`, `create:start`, `create:cancel`; Event `event:creations` (`CreationEntry[]`). |
| `src/core/create/pipeline.ts` | `FEHLER_ABBILDUNG` und `baueDetail` werden exportiert — der Worker-Client mappt `@@ERROR` auf dieselben typisierten `PipelineError`-Arten. |

## Verhalten im Detail

- **Warm/Kalt:** Erster Job startet den Worker (Kaltstart inkl. Modell-Laden,
  Fortschritt sichtbar über die normalen Stufen-Events). Folgejobs innerhalb
  des Idle-Fensters nutzen die warmen Modelle. Idle-Timeout fährt herunter;
  der nächste Job startet transparent neu.
- **Abbruch:** `create:cancel` bricht den LAUFENDEN Job ab (Kill + Worker tot
  markieren; Queue läuft mit dem nächsten Job weiter, sofern nicht geleert).
  Wartende Jobs entfernt `create:queueRemove` nur aus der Liste.
- **Worker-Crash:** Exit während eines Jobs → Job `failed` mit den letzten
  stderr-Zeilen, Worker-Neustart beim nächsten Job. Drei Crashs in Folge →
  Queue pausiert, Fehler-Event (kein Endlos-Restart-Loop).
- **Umgebungs-Gate:** Vor Queue-Start `environmentStatusForApp()`; `missing`
  und `broken` blockieren mit Verweis auf die Einstellungen, `outdated`
  läuft mit Warnung weiter (Spec TP2: outdated blockiert nicht).
- **Fehlerarten:** `@@ERROR`-Zeilen laufen durch die exportierte
  `FEHLER_ABBILDUNG` — die UI bekommt dieselben typisierten Arten wie bei
  `runPipeline` (EnvMissing, LanguageUnsupported, AlignmentFailed, …).
- **App-Exit:** `will-quit` killt einen laufenden Worker-Prozessbaum
  (USKMaker-Lektion: kein Python-Waise, der GBs VRAM hält).

## Teststrategie

- **Python (`tests/test_worker.py`):** Worker-Schleife mit gestubbtem
  Verarbeitungskern — Job-Zeile rein → `@@JOB ok` raus; Fehler-Job →
  `@@JOB ok:false` nach `@@ERROR`; mehrere Jobs sequenziell; defekte
  JSON-Zeile → `@@ERROR` + weiterlaufen; EOF → sauberes Ende, Exit 0.
- **TS (`worker.test.ts`):** Fake-Sidecar-Skript, das stdin-Zeilen liest und
  geskriptete Antworten schreibt (Erweiterung des `fakeSidecar`-Musters):
  Demux, submitJob-Promise, Cancel killt und markiert tot, Idle-Shutdown mit
  injiziertem Timer, Crash während Job → Rejection mit stderr-Ende.
- **TS (Queue):** Queue-Logik mit injiziertem Fake-Worker (Reihenfolge,
  ein-aktiver-Job, Cancel-Semantik, Crash-Zähler-Pause, Umgebungs-Gate);
  IPC-Vertragstests erweitern sich über die bestehenden Kanal-Schleifen.
- **Durchstich (`slow`/Controller):** zwei Songs nacheinander über den
  echten Worker — der zweite muss messbar schneller starten (warme Modelle);
  Ergebnisqualität identisch zum Einzel-CLI-Lauf (Stufencache unberührt).

## Risiken

- **VRAM-Fragmentierung/Leaks über viele Jobs:** der Idle-Timeout und der
  Kill-basierte Abbruch begrenzen die Lebensdauer; der Durchstich misst
  mindestens zwei aufeinanderfolgende Jobs.
- **Vermischte stdout-Zeilen** (torch/Demucs-Rauschen zwischen unseren
  Markern): der Demux ignoriert Nicht-Marker-Zeilen — dasselbe bewährte
  Verhalten wie `runPipeline`.
- **Cache-Verzeichnis-Kollisionen** bei schnell aufeinanderfolgenden Jobs
  desselben Songs: unverändert durch den Stufencache abgedeckt (atomare
  Writes, Content-Keys).

## Bewusst nicht enthalten

Erstellen-UI (TP5), Paketbau/Metadaten (TP4), Queue-Persistenz, parallele
Jobs, TUI-Anbindung, Duette, Lyrics-Beschaffung (LRCLIB-Suche: siehe
TO-DO im TP2-Plan, kommt mit TP5).
