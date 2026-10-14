# Sicherheitsmigration der KI Pipeline

Stand: 14. Oktober 2026. Separater Folgeauftrag nach dem Fix der Bun-Security-Scans. Die Migration ist vorbereitet, noch nicht umgesetzt.

## Ausgangslage und Ziel

Der Python-Modell-Audit meldet 18 Advisory-Einträge in drei Paketen. Einige Transformers-Einträge enthalten dieselben Advisory-IDs mit unterschiedlichen Fixangaben; die Anzahl entspricht daher nicht 18 verschiedenen Schwachstellen. Die Basisinstallation des Sidecars hat keine gemeldeten Befunde.

| Paket | Aufgelöste Version | Audit-Einträge | Einschränkung |
| --- | --- | --- | --- |
| torch | 2.8.0 | 8 | Einzelne Advisories nennen Fixes bis 2.13.0; ein Eintrag enthält keine Fixversion. |
| transformers | 4.57.6 | 9 | Einzelne Advisories nennen Fixes bis 5.10.0; einige Einträge enthalten keine Fixversion. |
| nltk | 3.10.3 | 1 | PYSEC-2026-3740 / GHSA-8mgp-746c-j5xp enthält keine Fixversion. |

WhisperX 3.8.6 verlangt torch~=2.8.0, torchaudio~=2.8.0 und torchvision~=0.23.0 sowie huggingface-hub<1.0.0. Transformers 5.19 verlangt dagegen huggingface-hub>=1.31.0. Die Windows-Einrichtung in src/core/create/environment.ts installiert zudem Torch und Torchaudio 2.8.0 als CPU- oder CUDA-12.8-Wheels. Ein Override der Versionsgrenzen wäre keine geprüfte Kompatibilitätslösung.

Ziel ist eine mit CPU und unterstützter NVIDIA-GPU funktionierende Erstellungspipeline mit überprüftem Abhängigkeitsgraphen. Befunde ohne Patch benötigen eine Prüfung des betroffenen Aufrufpfads und gegebenenfalls einen Ersatz der betroffenen Funktion oder Bibliothek. Ein reines Versionsupdate garantiert deshalb noch keinen sauberen Audit.

## Phase 1 Befunde und tatsächliche Nutzung prüfen

- [ ] Die Modell-Audit-Artefakte des Security-Workflows sichern und Advisory-IDs samt CVE/GHSA-Aliasen deduplizieren.
- [ ] Für jedes Advisory die betroffene Funktion, Eingaben und Erreichbarkeit im Sidecar dokumentieren. Insbesondere Modell-Deserialisierung, remote geladenen Modellcode und NLTK-Verarbeitung prüfen.
- [ ] CPU- und CUDA-Pins aus environment.ts mit der tatsächlich installierten Umgebung vergleichen; vorhandene Benutzerumgebungen separat betrachten.
- [ ] Vorhandene Referenzkorpus-Evaluation als Ausgangswert sichern: Noten, Wortzeiten, Laufzeit und Speicherbedarf. Audiodateien und geschützte Songtexte bleiben außerhalb von Git.

## Phase 2 Einen kompatiblen Modellstapel auswählen

- [ ] Prüfen, ob eine gepflegte WhisperX-Version sichere Torch-, Transformers- und Hub-Versionen gemeinsam unterstützt.
- [ ] Falls die Versionskonflikte bestehen bleiben, Transkription und Alignment hinter den vorhandenen Sidecar-Schnittstellen von WhisperX entkoppeln und geeignete Ersatzbibliotheken anhand ihrer offiziellen Abhängigkeiten bewerten.
- [ ] NLTK-Verwendung konkret identifizieren und den ungepatchten Aufrufpfad ersetzen oder ausschließen. Auch Torch- und Transformers-Einträge ohne Fixversion einzeln behandeln.
- [ ] Den Kandidaten ohne GPU-Downloads für Windows/Linux und Python 3.12 auflösen; danach eine echte CPU-Installation und eine CUDA-Installation prüfen. Versionsgrenzen nicht ungeprüft übersteuern.

## Phase 3 Mit Regressionstests migrieren

- [ ] Vor Änderungen Tests für Modellladen, Cache, Preload, Transkription, Alignment und strukturiertes Fehlerverhalten ergänzen und den passenden RED-Zustand nachweisen.
- [ ] Änderungen in python-sidecar/pyproject.toml, ultrastar_pipeline/modelle.py, transcribe.py und align.py schrittweise umsetzen.
- [ ] Windows-Einrichtung, Torch-Index/Pins und Umgebungsfingerprint in src/core/create/environment.ts sowie dessen Tests anpassen.
- [ ] Einen reproduzierbaren Lock oder Constraint-Satz einführen, den Installation und Security-Audit gemeinsam verwenden. Die aktuell dynamische Auflösung des Audits ersetzt keinen Runtime-Lock.
- [ ] Reinstallation bestehender Umgebungen über den bisherigen Status outdated führen; Benutzerumgebungen nicht still überschreiben.

## Phase 4 Abnahme und Veröffentlichung vorbereiten

- [ ] Beide Bun-Audits sowie Python-Basis- und Modell-Audits auf beiden Plattformen bestehen ohne pauschale Advisory-Ausnahmen.
- [ ] Testsuite, Typecheck, CLI-/Desktop-Build und Desktop-Smoke-Tests bestehen.
- [ ] Geänderte Sicherheitsmodule erreichen mindestens 80 Prozent Coverage; echte CPU-/GPU-Modelltests werden ausgeführt und getrennt von Mock-Tests berichtet.
- [ ] Referenzkorpus-Evaluation bestätigt akzeptierte Qualitäts-, Laufzeit- und Speichergrenzen. Die Grenzen werden vor der Migration anhand der Ausgangswerte festgelegt.
- [ ] Unabhängiges Code- und Security-Review durchführen und Rollback der Modellkonfiguration prüfen.

Die aktuellen Modell-Audits bleiben blockierend und bewahren die aufgelösten Versionen samt JSON-Bericht als Workflow-Artefakte auf. Eine Risikoausnahme wäre eine gesonderte Entscheidung mit konkreter Erreichbarkeitsanalyse und Ablaufdatum.

## Quellen und betroffene Stellen

- python-sidecar/pyproject.toml und src/core/create/environment.ts: deklarierter und installierter Modellstapel.
- .github/workflows/security.yml: Basis-/Modell-Audits und Artefakte.
- [WhisperX Paketmetadaten](https://pypi.org/pypi/whisperx/3.8.6/json).
- [Transformers Paketmetadaten](https://pypi.org/pypi/transformers/5.19.0/json).
- [NLTK Advisory](https://github.com/advisories/GHSA-8mgp-746c-j5xp).
- [Torch Advisory mit Fix 2.13.0](https://github.com/advisories/GHSA-rrmf-rvhw-rf47).
- [Transformers Advisory mit Fix 5.10.0](https://github.com/advisories/GHSA-xrqw-3rrv-vx5w).
