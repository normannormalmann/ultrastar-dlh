# Sicherheitsmigration und praktische Abnahme der KI-Pipeline

Stand: 1. November 2026. Die Migration ist implementiert und unter Windows mit echten CPU- und GPU-Läufen geprüft. Linux-Laufzeitprüfung und eine breite musikalische Qualitätsabnahme stehen weiterhin aus.

## Modellabhängigkeiten

WhisperX 3.8.6 hielt den bisherigen Stack auf Torch 2.8 und Transformers 4.x fest. Die Transkription verwendet jetzt direkt faster-whisper mit Silero-VAD. Der benötigte CTC-Alignment-Code aus WhisperX ist mit BSD-Lizenz und Herkunftsnachweis in `python-sidecar/ultrastar_pipeline/thirdParty/` übernommen. Dieser kleine übernommene Teil muss künftig selbst gepflegt und auf Änderungen im Ursprung geprüft werden. NLTK und dessen zur Laufzeit heruntergeladene Satzmodelle werden nicht mehr benötigt. Die Änderung der Segmentierung und des VAD kann Wortzeiten beeinflussen.

Der geprüfte Stack verwendet Torch 2.15.0, Torchaudio 2.11.1 und Transformers 5.22.1. swift-f0 bleibt bei 0.1.2, damit die Sicherheitsmigration nicht zugleich das Tonhöhenmodell und dessen API ersetzt. Vier vollständige Versionsdateien fixieren CPU/CUDA für Windows/Linux. Installation und CI verwenden dieselben Dateien. `uv pip sync` entfernt alte, nicht mehr benötigte Pakete. Die Cache-Versionen für Transkription und Alignment wurden erhöht.

Torch nutzt in der GPU-Variante CUDA 13.2, CTranslate2 weiterhin CUDA 12. Die dafür benötigten NVIDIA-Bibliotheken werden zusätzlich installiert und vor dem ASR-Laden verfügbar gemacht. Ein kompatibler NVIDIA-Treiber ist Voraussetzung für GPU-Ausführung. Unter Windows wurden beide Komponenten gemeinsam auf einer RTX 3070 ausgeführt.

Alle vier aufgelösten Modellvarianten hatten beim lokalen `pip-audit` am 1. November 2026 **keine gemeldeten Schwachstellen**. Das ist eine Aussage zum damaligen Advisory-Datenstand, keine Garantie für Schwachstellenfreiheit. Die frühere Advisory-Ausnahmedatei ist entfernt. Der Security-Workflow prüft Basis, CPU und CUDA für beide Plattformen ohne Advisory-Unterdrückung und bewahrt die Berichte auf.

Bestehende Benutzerumgebungen werden durch ein Code-Update nicht verändert. Ihr Fingerprint wird veraltet; die Aktualisierung erfolgt über die KI-Einstellungen. Die bisherige installierte Benutzerumgebung blieb bei dieser Prüfung unangetastet. Migration und Paketbau wurden in isolierten Umgebungen geprüft, einschließlich `uv pip check` und mitgelieferter Drittlizenz. Ein Downgrade auf den alten Stack würde dessen bekannte Risiken wieder einführen und ist kein automatischer Fallback.

## Echte Funktionsprüfungen

Die Testprogramme sind wiederholbar; Originalsongs und gespeicherte Zugangsdaten werden nur gelesen. Audio, Texte und lokale Berichte liegen ausschließlich im ignorierten Verzeichnis `.verification/`.

- `scripts/liveServices.ts`: echte USDB-Anmeldung, Suche, Songtextabruf, YouTube-Vorschauauflösung und Dekodierung einer dreisekündigen Audioprobe erfolgreich. Dies ist eine Momentaufnahme der Dienste; nicht jede Download- oder Fehlerkonstellation wurde geprüft.
- `scripts/modelRegression.ts` und `scripts/modelProbe.py`: vollständige Modellläufe mit Separation, Transkription, Alignment, Tonhöhenerkennung und Notenerzeugung. Pro Lauf werden Versionen, Quellfingerprint, Audio-/Referenzhashes, Ergebnisvalidierung, Timing-/Tonhöhenmetriken, Laufzeit und Speicher erfasst. Torch-VRAM enthält nicht die separaten CTranslate2-Allokationen; RAM ist eine Stichprobenmessung des Prozessbaums.
- Nachanalyse eines vorhandenen Songs: 2.206 Tonhöhenpunkte, abspielbare Gesangsspur und unveränderte Notendatei. Wiederverwendung des Caches und Abbruch wurden praktisch geprüft. Der Lauf dauerte etwa 8 Sekunden.
- Desktop-Prüfungen: Erstabgleich eines alten USDB-Songs mit Beibehaltung der lokalen Fassung sowie Nachanalyse bei ungespeicherten Editoränderungen. Die Notenänderung bleibt erhalten.

Automatisierte Abschlussprüfung: 507 TypeScript-Tests bestanden (3 plattformabhängig übersprungen), 160 Python-Tests bestanden (1 Slow-Test separat abgewählt), 6 Desktop-Tests bestanden. Typecheck, Lint der geänderten TypeScript-Dateien sowie CLI-/Desktop-Build erfolgreich. Beide Bun-Audits ohne Befund. Lokal kam das vorhandene Bun 1.3.10 zum Einsatz; CI ist auf Bun 1.4.3 festgelegt. Die echten Modellläufe sind zusätzliche Prüfungen außerhalb der modellfreien Python-Suite.

Ein Referenzfall wurde mit bisherigem und migriertem Stack gemessen:

| Ausführung | Bisheriger Stack | Migrierter Stack |
| --- | ---: | ---: |
| CPU, vollständiger Lauf | 129 s | 94 s |
| GPU, vollständiger Lauf | 92 s | 34 s |

Dies sind Einzelmessungen mit vorhandenem Modell-Downloadcache und frischem Verarbeitungscache, keine allgemeine Leistungszusage. Zwei zusätzliche Solofälle liefen mit der endgültig fixierten GPU-Umgebung in etwa 25 und 32 Sekunden erfolgreich durch. Einer dieser Fälle scheiterte beim alten Stack an der Spracherkennung; auch dieser Fehlschlag bleibt im lokalen Bericht erhalten.

Nach der abschließenden Anpassung der CUDA-Bibliotheksauflösung lief der erste Solofall erneut erfolgreich in 23 Sekunden. Seine Timing-Metriken unterschieden sich deutlich vom vorigen Lauf. Die Testeingaben und Versionen sind nachvollziehbar, die Modellausgabe ist damit jedoch nicht als deterministisch belegt; für eine Qualitätsabnahme sind Wiederholungsmessungen erforderlich.

## Vorhandene Songs und USDB-Erstabgleich

Im Editor kann die Originalstimme samt Tonhöhenkurve nachberechnet werden. Dabei werden nur Separation und Tonhöhenanalyse ausgeführt. Die Veröffentlichung der Artefakte erfolgt erst nach erfolgreichem Abschluss; die Notendatei und ungespeicherte Editoränderungen bleiben erhalten. Audio-Hash, Analyseversion und Tonhöhenkonvention verhindern die Wiederverwendung eines unpassenden Caches. Abbruch beendet den Prozessbaum. Die Analyse teilt sich die Modellumgebung mit der Erstellung, deshalb werden konkurrierende Modellaufträge verhindert.

Bei alten USDB-Downloads lässt sich rückwirkend nicht beweisen, ob eine Abweichung lokal oder auf USDB entstanden ist. Musikalisch identische Dateien erhalten automatisch eine erste Vergleichsbasis; lokale Mediendateinamen zählen dabei nicht als Änderung. Bei Abweichungen zeigt die App einen Erstabgleich. Man kann die neue Fassung übernehmen oder die lokale Fassung behalten und ab jetzt beobachten. Gespeichert werden dabei der tatsächliche USDB-Text und dessen Hash. Spätere lokale und entfernte Änderungen lassen sich getrennt erkennen. Übernahmen bleiben revisionsgeprüft und sichern die vorherige Notendatei.

## Verbleibende Abnahme

Die getesteten Referenzen zeigen schon mit dem bisherigen Stack große Timing-Abweichungen. Beim gemeinsamen Referenzfall liegt die mediane absolute Abweichung bei ungefähr 18–19 Sekunden. Auch erfolgreiche Sololäufe liefern keine hinreichende musikalische Übereinstimmung. Ein technisch gültiges Ergebnis ist deshalb noch kein musikalisch gutes Ergebnis. Eine allgemeine Qualitätsfreigabe wird aus diesen Tests ausdrücklich nicht abgeleitet.

Als nächster Qualitätsschritt ist ein manuell geprüfter Korpus mit korrekter Audiofassung, GAP, BPM, Sprachzuordnung und Tonhöhenkonvention nötig. Er sollte mehrere Sprachen, Solostimmen und Duette enthalten. Vor weiteren Modelländerungen müssen akzeptierte Grenzen für Timing, Tonhöhe, Notenanzahl und Fehlerfälle festgelegt werden. Die vorhandenen Messprogramme liefern dafür reproduzierbare Daten.

Offen sind außerdem echte Linux-CPU-/GPU-Läufe, eine größere Treiber-/Hardwarematrix und ein unabhängiges Code-/Security-Review. Die Linux-Abhängigkeiten wurden aufgelöst und auditiert, aber hier nicht ausgeführt. Eine vollständige Erreichbarkeitsanalyse aller historischen Advisories wurde nicht nachgeholt; stattdessen wurden die betroffenen Pakete ersetzt bzw. aktualisiert und die endgültigen Abhängigkeiten erneut auditiert.

## Nachuntersuchung: Ursachen und Verbesserung der Songerstellung

Recherche und lokale Diagnose vom 1. November 2026. Die folgenden Änderungen sind Empfehlungen, noch keine implementierte Qualitätsverbesserung. Neue Modellkandidaten wurden recherchiert, aber nicht installiert oder gegeneinander vermessen.

### Nachgewiesene Fehlerverstärkung

Die gespeicherten Zwischenstufen wurden ohne neue Modellinferenz durch `build_notes` wiederholt. Notenpositionen und Tonhöhen entsprechen dabei exakt den gespeicherten Ergebnissen. Der Diagnosecode liegt lokal in `.verification/diagnoseQuality.py`, seine Zahlen in `.verification/quality-diagnosis.json`.

| Lauf | Wörter nur interpoliert | Noten ohne stimmhafte F0 im ursprünglichen Zeitfenster | Durch Kollisionsbehandlung verschobene Noten | Größte zusätzliche Verschiebung |
| --- | ---: | ---: | ---: | ---: |
| Duett, final-cpu/0 | 131/184 | 103/214 | 213/214 | 10.217 ms |
| Solo A, final-solo/0 | 66/146 | 158/184 | 124/184 | 4.940 ms |
| Solo A, Wiederholung | 70/146 | 165/184 | 152/184 | 4.940 ms |
| Solo B, final-solo/1 | 45/195 | 54/315 | 157/315 | 1.277 ms |

Diese Verschiebung wird gegen die ursprünglichen gerundeten Modellzeiten gemessen, nicht gegen die möglicherweise unpassende Referenz. `notes.py` erzwingt für jede Note mindestens den nächsten ganzzahligen Tick und kann dadurch viele nachfolgende Einsätze verschieben. Die geprüften Alignments enthalten bereits rückwärts laufende Wortanfänge. Der Notenbau verdeckt diesen Fehler, indem er daraus eine gültige, aber verschobene Reihenfolge macht. Beim Duett kommt die ungeeignete Reduktion mehrerer Stimmen auf eine Sequenz hinzu.

Eine isolierte Wiederholung mit vierfach feinerem Zeitraster senkt den größten zusätzlichen Versatz bei Solo A von 4.940 auf 1.068 ms und bei Solo B von 1.277 auf 160 ms. Das belegt den Einfluss des Rasters; die verbleibenden Fehler zeigen zugleich, dass Rasterverfeinerung allein nicht genügt. Dies ist kein Nachweis besserer Übereinstimmung mit dem tatsächlichen Gesang.

Weitere konkrete Befunde:

- Wortdauer wird gleichmäßig auf orthografische Silben verteilt. Pro Silbe gibt es genau eine Median-Tonhöhe. Ungleiche Silbendauern und mehrere Noten auf einer Silbe können so nicht richtig entstehen.
- Fehlende F0 wird durch den Median des ganzen Songs ersetzt. Timing-Konfidenz bleibt erhalten: bei Solo A hatten 86 der 158 Noten ohne F0 trotzdem eine positive Timing-Konfidenz. Timing, Textzuordnung und Tonhöhe benötigen getrennte Vertrauenswerte.
- Zwei Wiederholungen desselben Solos besitzen unterschiedliche Stem-Hashes; die Transkription enthält einmal 31 und einmal 46 Wörter. Demucs wird mit seinem Standard `shifts=1` aufgerufen; die installierte Implementierung verwendet dafür `random.randint`. Dies ist eine konkrete Quelle von Laufvariationen, ohne damit bereits alle Unterschiede kausal zu erklären.
- `MIDI_NULLAGE=48` wurde aus einer Referenz abgeleitet. Die [offizielle Formatspezifikation](https://usdx.eu/format/) definiert dagegen Pitch 0 als MIDI 60. Standardabbildung, historische Referenztranspositionen und Oktavfehler müssen getrennt behandelt werden; bestehende Songs dürfen dabei nicht pauschal transponiert werden.
- Die Bewertung paart Silben per textueller LCS, berücksichtigt wiederholte Abschnitte nicht explizit und entfernt für die Pitch-Trefferquote den medianen Pitch-Versatz. Das kann Zuordnungsfehler und Transpositionen verdecken. Duettstimmen werden zusammengelegt; der separate Referenzparser berücksichtigt RELATIVE nicht. Absolute und oktavunabhängige Tonhöhengüte sowie Wort-, Silben- und Notenmetriken müssen getrennt ausgewiesen werden.
- `USC_ALIGNER` geht in Cache und Metadaten ein, steuert derzeit aber nicht die tatsächliche Modellauswahl in `hole_align`. Ein Vergleich muss die tatsächlich geladene Checkpoint-ID protokollieren.

### Empfohlene Umsetzung in Reihenfolge

1. **Messung und Fehlerbegrenzung:** Gesangszeiten intern in Sekunden behalten; Exportauflösung vom erkannten musikalischen Tempo trennen. Rückwärts laufende oder stark überlappende Zeiten führen zur erneuten Ausrichtung des Abschnitts. Kollisionen dürfen keine unbeschränkte Verschiebungskette auslösen. Fehlende F0 sichtbar als unbestimmt speichern. Standard-Pitchabbildung mit synthetischen bekannten Frequenzen prüfen. Wiederholungsmessungen mit festen Seeds, Decoderparametern, Modellrevisionen und Stem-Hashes.
2. **Bekannten Text direkt ausrichten:** Abschnitte und jedes Refrainvorkommen identifizieren, danach Wörter und Phoneme innerhalb überlappender lokaler Fenster ausrichten. Freie ASR liefert zusätzliche Evidenz, keine unverrückbaren Grenzen. Ein schlechter Anker muss zurückgenommen werden können. Mischung und getrennte Stimme bei unsicheren Abschnitten vergleichen. LRC nur nach Editionsprüfung als weiche Zeitvorgabe einsetzen. Lange ungemessene Bereiche bleiben Entwurf und werden nicht mit erfundenen sicheren Noten aufgefüllt.
3. **Noten aus Gesang entwickeln:** F0-Kontinuität, Stimmhaftigkeit, Vokalanfänge und stabile Tonhöhenwechsel für Notengrenzen verwenden; Vibrato nicht in viele Noten zerlegen. Silben akustisch zuordnen, Melismen unterstützen. Gesprochene bzw. gerappte Abschnitte gesondert behandeln. Duette bekommen eigene Spuren und getrennte Bewertung.
4. **Gezielte Modellversuche:** Zuerst dasselbe Audio, denselben Stem und denselben Text verwenden und nur eine Stufe tauschen. Kandidaten aus der folgenden Tabelle nur bei messbarem Gewinn übernehmen. Schwache Abschnitte bekommen einen zweiten Lauf; kein pauschales Ensemble über jeden Song.
5. **Abnahme und Betrieb:** Geprüfte Audiofassung, Ausschnittgrenzen, Sample-Rate und Zeitbezüge dokumentieren. Originalaudio bleibt die gemeinsame Zeitachse. Entwicklungs- und unangetastete Testsongs nach Aufnahme/Sänger trennen. Windows und Linux mit denselben Eingaben und numerischen Toleranzen testen. Docker Desktop stellt auf diesem Rechner bereits einen erreichbaren Linux-Daemon bereit; eine Linux-Modellprüfung wurde in dieser Recherche noch nicht ausgeführt.

### Recherche: geeignete Vergleichskandidaten

| Aufgabe | Kandidat und Begründung | Einschränkung / nächster Versuch |
| --- | --- | --- |
| Text erkennen | [Whisper large-v3](https://github.com/openai/whisper/discussions/1762) gegenüber dem aktuellen large-v2; [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) beschreibt explizit Gesang und Songs mit Begleitung. | Sprachbenchmarks sind keine Karaoke-Abnahme. Mix/Stem, Wortabdeckung und falsche Wiederholungen getrennt messen. |
| Wörter ausrichten | [LyricsAlignment-Multilingual](https://github.com/jhuang448/LyricsAlignment-Multilingual) ist auf Lyrics spezialisiert und evaluiert auf mehrsprachigem Jamendo sowie annotiertem MUSDB18. [Qwen3-ForcedAligner](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf) unterstützt Deutsch. | Der Qwen-Aligner wird als Sprachmodell beschrieben; Gesangseignung separat belegen. Die native Transformers-Integration prüfen: das alternative `qwen-asr`-Paket pinnt weiterhin Transformers 4.57.6 und würde die Sicherheitsmigration zurückdrehen. |
| Phoneme ausrichten | [SOFA](https://github.com/qiuqiao/SOFA) ist für Gesang entwickelt und unterstützt ONNX. | Passender deutscher Checkpoint und Phonemwortschatz müssen geprüft werden. Das Projekt-README allein belegt keine sofort nutzbare deutsche Lösung. |
| Tonhöhe und Noten | [RMVPE](https://github.com/Dream-High/RMVPE) für robuste Gesangstonhöhe; [ROSVOT](https://github.com/RickyL-2000/ROSVOT) für echte Notenereignisse mit optionalen Wortgrenzen. | Gegen SwiftF0 und den vorhandenen torchcrepe-Versuch messen. ROSVOTs dokumentierter alter Torch-Stack wird nicht in die App übernommen; zunächst isolierter Adapter/Portierungsversuch. |
| Gesang trennen | Demucs als Basis; ein ausgewählter [BS-/Mel-Band-RoFormer](https://github.com/ZFTurbo/Music-Source-Separation-Training)-Checkpoint als Vergleich. | Qualität anhand der anschließenden Wort-/Notenerkennung beurteilen. Checkpoint-Herkunft, Nutzungsbedingungen und Speicherbedarf einzeln prüfen. Begleitstimmen bleiben ein eigenes Problem. |

Die [ISMIR-2025-Untersuchung](https://ismir2025program.ismir.net/lbd_412.html) zeigt, dass die Qualität der Lyrics-Ausrichtung von der verwendeten Stimmtrennung abhängt. Daraus folgt hier ein gemeinsamer Vergleich von Separation und nachfolgendem Alignment, nicht die Annahme, ein bestimmter Separator gewinne bei jedem Song.

### Qualitätsnachweis

- [JamendoLyrics](https://huggingface.co/datasets/jamendolyrics/jamendolyrics) liefert 79 Songs mit Wortzeiten, einschließlich Deutsch; für freie Transkription verweist das Projekt auf Jam-ALT. Diese Aufgaben benötigen unterschiedliche Referenztexte.
- [GTSinger](https://github.com/liangsw20/GTSinger) enthält unter anderem deutsche Aufnahmen, Phonemannotation und Notenmaterial. Datenbedingungen beachten; ergänzend einen kleinen eigenen manuell geprüften Karaoke-Korpus führen.
- [mir_eval.transcription](https://mir-eval.readthedocs.io/latest/api/transcription.html) liefert etablierte Notenmetriken mit getrennten Kriterien für Beginn, Ende und Tonhöhe. Wortzeiten separat nach Wort-ID/Abschnitt statt allein nach Silben-LCS bewerten.
- Vorschlag für ein erstes Produktziel auf dem festgelegten Solo-Testkorpus: mindestens 90 % der Wortanfänge innerhalb 100 ms, keine unmarkierten Abschnittsfehler über 1 s und keine als sicher ausgegebenen erfundenen Tonhöhen. Das sind vorgeschlagene Abnahmekriterien, keine erreichten Werte. Zusätzlich Noten-F1, absolute F0-/Chroma-Güte, Abdeckungsquote, Wiederholungsstreuung und manuelle Korrekturzeit berichten. Schwierige Songs dürfen nicht durch Ausschluss oder eine sehr kleine automatische Abdeckungsquote den Durchschnitt beschönigen.

Zur Erkennung der richtigen Aufnahme kann [Chromaprint](https://github.com/acoustid/chromaprint) vorhandene nahezu identische Audiofassungen verbinden. Das erleichtert Wiederverwendung guter USDB-Daten und Duplikaterkennung. Ein Treffer beweist jedoch weder identische Schnittfassung noch gleiche Wortzeiten; diese müssen zusätzlich geprüft werden.

## Umsetzung des ersten Qualitätsbausteins

Der erste Baustein der obigen Empfehlungen ist jetzt implementiert. Er begrenzt Fehler im Notenbau und macht fehlende Messungen sichtbar; neue ASR-/Alignment-Modelle sind damit noch nicht eingeführt.

- Der Export verwendet ein ganzzahliges Tempo-Vielfaches mit höchstens 10 ms pro Tick. `meta.musicalBpm` hält das ursprünglich erkannte Tempo fest. Der Editor passt Startzoom und Raster an hohe Export-BPM an.
- Kollisionen werden gegen den ursprünglichen Einsatz geprüft. Die gesamte zulässige Abweichung je Note ist auf 20 ms begrenzt, statt sich von Note zu Note aufzusummieren. Ungültige Wortdauern und größere Konflikte liefern `alignment_failed` mit einer konkreten Meldung. Es wird dann keine neue Ergebnisdatei veröffentlicht.
- Der pauschale Vorlauf von 60 ms entfällt. Neue Erstellungen benutzen MIDI 60 als Nullpunkt. Bestehende Notendateien und Analysen mit explizitem `midiOffset: 48` bleiben unverändert lesbar.
- Fehlende Tonhöhe wird mit `pitchStatus: missing` und Konfidenz 0 gespeichert; `timingConfidence` erhält die getrennte Zeit-Evidenz. Der numerische Platzhalter 0 ist keine gemessene Tonhöhe. Im UltraStar-Export werden diese Stellen zu unbewertetem Freestyle. Persistente Editorhinweise unterscheiden fehlende Tonhöhe von zusätzlich unsicherem Timing; alte Verträge ohne die neuen optionalen Felder bleiben lesbar.
- Ein Regressionstest mit 300 dicht folgenden Silben bestätigt höchstens 6 ms Abweichung der exportierten Einsätze und keine Überlappungen. Das prüft den Export gegen vorgegebene Zeiten, nicht die Erkennung des Gesangs. Weitere Tests decken rückwärts laufende Zeiten, kollabierte Wortdauern, fehlende F0 trotz hoher Timing-Konfidenz und den MIDI-Nullpunkt ab.

Die Wiederholung der vier bisherigen problematischen Modellartefakte (`.verification/quality-block-replay.json`) wird jetzt jeweils bereits wegen einer ungültigen Wortdauer am Anfang abgewiesen. Das ist bewusst keine musikalische Qualitätsfreigabe: Die alten Fehler werden nicht mehr als scheinbar gültige Songs ausgegeben. Der nächste Baustein muss diese Lücken und widersprüchlichen Anker durch bessere Abschnitts-/Wortausrichtung beheben. Die neue 20-ms-Grenze ist eine Grenze der Nachbearbeitung, keine Zusage über die Genauigkeit der Modellzeiten.

Abschlussprüfung dieses Bausteins: 510 TypeScript-Tests bestanden (483 regulär und 27 Prozess-/Sicherheitstests, 3 plattformabhängig übersprungen), 170 Python-Tests bestanden (1 Slow-Test abgewählt), 6 Desktop-Tests bestanden. Typecheck, Lint der betroffenen TypeScript-Module, CLI-/Desktop-Build und Diff-Prüfung erfolgreich. Die Desktop-Prüfung enthält eine Datei mit BPM 1920, einen fehlenden Pitch-Hinweis und das unveränderte Bearbeiten älterer Dateien. Neue vollständige Modellinferenz wurde für diese Änderung nicht ausgeführt; die Modellstufen sind unverändert, die realen gespeicherten Zwischenstufen wurden erneut durch den geänderten Notenbau geführt.

## Wortausrichtung: Umsetzung und Vergleich vom 01.11.2026

Die Pipeline kann jetzt widersprüchliche Wortanker zurücknehmen und den bekannten Text erneut ausrichten. `alignmentTiming.py` wählt eine zeitlich verträgliche Ankerkette mit dynamischer Programmierung. Ungültige, überlappende oder außerhalb des Audios liegende Messungen werden ausgeschlossen. Für fehlenden Text müssen mindestens 60 ms pro geschätzter Silbengruppe verfügbar bleiben. Diese bewusst großzügige Plausibilitätsregel ist eine Heuristik, kein Nachweis korrekter Gesangszeiten; sehr schnelle Passagen können dadurch Anker verlieren.

Bei weniger als 25 % verbleibender Ankerabdeckung versucht die Pipeline zusätzlich, den vollständigen bekannten Text direkt auszurichten. Dieser Versuch ist auf 60 Sekunden und 160 Wörter begrenzt und wird nur bei vollständig zugeordneten, gültigen Wortintervallen übernommen. Scheitert er, bleiben die brauchbaren Anker für die lokale Ausrichtung erhalten. Längere unverankerte Bereiche werden ausdrücklich als geschätzt gemeldet; eine zuverlässige Unterteilung langer Songs in Strophen und einzelne Refrainvorkommen ist damit noch nicht implementiert.

CTC-Ergebnisse müssen zur Tokenfolge passen und endliche, positive, nicht überlappende Zeitbereiche innerhalb ihres Fensters besitzen. Die frühere Grenztoleranz von 500 ms und das künstliche Verlängern ungültiger Wörter entfallen. Schon die Transkriptstufe verwendet keine nachträglich interpolierten CTC-Zeiten mehr als Messung. Speichermangel wird weitergereicht. Geschätzte Wörter behalten Quelle `interpolated` und Konfidenz 0; alle Ausgabezeiten werden vor dem Speichern erneut geprüft. Die Cache-Versionen sind angehoben.

### Messung mit unveränderten Eingaben

Die vier bisherigen Läufe wurden mit identischen gespeicherten Gesangsspuren, Transkripten und Pitch-Tracks erneut ausgerichtet. Separation und Pitch-Modell wurden nicht neu berechnet. Alle vier Ergebnisse bestehen jetzt die strukturellen Zeit- und Exportprüfungen; das ist keine allgemeine musikalische Freigabe.

| Messgröße | Vorher | Neuer Stand |
| --- | ---: | ---: |
| Solo A: mediane absolute Wortanfangsabweichung | 20.634 ms | 81 ms |
| Solo A: 90. Perzentil | 26.866 ms | 320 ms |
| Solo A: Wortanfänge innerhalb 100 ms | 0 / 146 | 82 / 146 |
| Solo A: nur geschätzte Wörter | 66 / 146 | 0 / 146 |
| Solo B: nur geschätzte Wörter | 45 / 195 | 7 / 195 |
| Duett: nur geschätzte Wörter | 131 / 184 | 145 / 184 |

Die Wortmetrik ordnet die vollständige, exakt übereinstimmende Wortfolge nach Position zu, einschließlich wiederholter Wörter. Sie verwendet die ersten Silbeneinsätze aus der vorhandenen Solo-Referenz und keine neue Silben-LCS. Diese Referenzen wurden nicht manuell musikalisch abgenommen; Entwicklungsbeispiele sind kein unabhängiger Testkorpus.

Bei Solo B beträgt der vorzeichenbehaftete mediane Versatz weiterhin etwa −4,63 Sekunden. Die Referenz reicht bis 115,91 s, die tatsächlich vorliegende Audiospur nur bis 111,34 s; der Container beginnt bei 0 s. Das spricht für eine abweichende Synchronisation oder Audiofassung, beweist aber deren genaue Ursache nicht. Nach rein diagnostischem Abzug des medianen Versatzes verändert sich die mediane Wortabweichung von 63 auf 73 ms, das 90. Perzentil von 1.922 auf 1.300 ms. Das Ergebnis ist gemischt; die App korrigiert diesen Versatz nicht automatisch.

Die Pitch-Abdeckung ist weiterhin unzureichend: Bei Solo A fehlen nach der neuen Ausrichtung 137 von 184 Notenmessungen (vorher 158), bei Solo B 65 von 315 (vorher 54). Weniger interpolierte Wörter beweisen weder bessere Tonhöhen noch durchgehend bessere Zeitgenauigkeit. Das Duett bleibt besonders schwach und benötigt getrennte Stimmen.

### Wiederholung und Prüfungen

`scripts/alignmentReplay.py` wiederholt ausschließlich Alignment und Notenbau aus einem einzelnen `modelRegression`-Verzeichnis. Es verlangt eindeutige Zwischenstufen, schreibt in ein neues Verzeichnis und protokolliert die SHA-256-Hashes aller Eingaben. Beispiel in PowerShell mit vorhandenem Modellinterpreter:

```powershell
$env:PYTHONPATH = (Resolve-Path python-sidecar).Path
& .verification/candidate-env/Scripts/python.exe scripts/alignmentReplay.py .verification/final-solo/0 .verification/alignment-repeat --device cuda
```

205 Python-Tests bestanden, ein Slow-Test abgewählt. Die neuen Regressionstests prüfen unter anderem kollabierte Anfänge, widersprüchliche Anker, wiederholte Wörter, fehlgeschlagene direkte Versuche, fehlerhafte CTC-Tokens, Speicherfehler und begrenzte Fenster. Echte CPU- und CUDA-Alignment-Läufe unter Windows liefern bei Solo A dieselben 146 Wortintervalle mit 0 ms maximaler Differenz. Lokale Messartefakte liegen unter `.verification/alignment-ablation-cpu`, `.verification/alignment-ablation-gpu`, `.verification/alignment-replay` und `.verification/alignment-word-metrics.json`.

Ein zusätzlicher CUDA-Lauf mit frisch berechnetem Transkript auf demselben Stem liefert erneut 31 erkannte und 146 ausgerichtete Textwörter; die Wortanfänge stimmen exakt mit dem Vergleichslauf überein (`.verification/alignment-fresh-asr/chain-report.json`). Die neuen Transkript- und Alignment-Stufen wurden damit auch gemeinsam ausgeführt.

Offen bleiben die musikalische Abnahme auf unabhängigen, editionsgeprüften Referenzen, zuverlässige Abschnittserkennung für längere Songs, bessere F0-/Notenerkennung, getrennte Duettstimmen und Linux-Modelllaufzeittests. Für diesen Baustein wurden keine neuen Modellabhängigkeiten installiert.

## Tonhöhenprüfung und vorsichtige Ergänzung

Die Untersuchung verwendet dieselben beiden Solo-Aufnahmen, Gesangsspuren und bereits verbesserten Wortzeiten. Rohfrequenz, Modellkonfidenz, Stimmhaftigkeitsentscheidung und Aufnahmepegel wurden getrennt ausgewertet. Bei Solo A akzeptiert SwiftF0 0.1.2 nur 298 von 3.601 Frames (8,3 %); der Spitzenpegel liegt bei 0,207 und erklärt den Ausfall nicht durch eine extrem leise Aufnahme. Bei Solo B werden 3.222 von 6.958 Frames akzeptiert. Ein bloßes Absenken der Schwelle ist kein Genauigkeitsnachweis.

### Modellvergleich und Entscheidung

SwiftF0 0.3.0 wurde in einem separaten Verzeichnis installiert und mit seiner eigenen Schwelle 0,5 geprüft. Seine API und die Bedeutung der Konfidenz unterscheiden sich von 0.1.2; der [Upstream-Changelog](https://github.com/lars76/swift-f0/blob/v0.3.0/CHANGELOG.md) dokumentiert den Wechsel. Die fehlenden Notenmessungen sinken damit auf 45 beziehungsweise 37. In den Spektralbildern von Solo B bei 2–6 und 30–34 Sekunden verfolgt dieses Modell jedoch häufig einen anderen Frequenzverlauf als das bisherige Modell und CREPE. Sichtbar sind mehrere Tonanteile. Ohne Festlegung und Hörprüfung der gewünschten Hauptstimme wäre eine automatische Übernahme nicht belastbar. Der Standard bleibt deshalb SwiftF0 0.1.2.

CREPE wurde als unabhängiger Vergleich auf sechs vorab festgelegten Vier-Sekunden-Ausschnitten und anschließend auf den beiden vollständigen Gesangsspuren ausgeführt. pYIN lieferte auf diesen Ausschnitten bei der vorab gesetzten Konfidenzgrenze 0,8 insgesamt nur fünf stabile Frames. Dieser Versuch ist für eine belastbare Bewertung ungeeignet; die Grenze wurde nicht nachträglich abgesenkt, um ein besseres Ergebnis zu erhalten. Modellübereinstimmung wird ausdrücklich nicht als menschliche Referenzannotation bezeichnet.

### Implementierter Vergleichsmodus

`USC_PITCH=swift-f0-consensus` ergänzt fehlende SwiftF0-Messungen nur unter folgenden Bedingungen:

- SwiftF0-Konfidenz mindestens 0,5, CREPE stuft den korrespondierenden Frame als stimmhaft ein.
- Höchstens 50 Cent Frequenzdifferenz und 6 ms Abstand der Messzeitpunkte. Oktaven werden nicht gleichgesetzt.
- Mindestens drei aufeinanderfolgende übereinstimmende SwiftF0-Frames; keine Überbrückung von Lücken oder Pausen.
- Bestehende akzeptierte SwiftF0-Messungen bleiben unverändert. Neue Messungen tragen Quelle `consensus` und den kleineren der beiden Modellwerte als konservativen Konfidenzindikator, nicht als kalibrierte Wahrscheinlichkeit.

Die Rohkonfidenzen bleiben jetzt im Pitch-Cache erhalten. Die Notenkonfidenz wird durch die gemessene Pitch-Konfidenz begrenzt, während `timingConfidence` den separaten Alignment-Wert behält. Dadurch übernimmt ein ergänzter unsicherer Ton nicht einfach eine hohe Timing-Konfidenz. Alte `PitchPoint`-Datensätze ohne diese Zusatzfelder bleiben lesbar.

Im CREPE-Adapter sind außerdem drei konkrete technische Probleme behoben: Stille wird auf dem ursprünglichen Signal mit einer RMS-Grenze von −60 dB ausgefiltert; die Verarbeitung verwendet eine gemeinsame 16-kHz-Zeitachse; Viterbi-Batchgröße und Zufalls-Seed der Frequenzquantisierung sind explizit und identisch auf CPU/CUDA. Der vorherige Zufallszustand wird nach dem Modellaufruf wiederhergestellt. Die [CREPE-Dokumentation](https://github.com/maxrmorrison/torchcrepe#filtering-and-thresholding) beschreibt die Gefahr scheinbar sicherer Pitch-Werte in Stille. Ungültige Zahlen, vertauschte Zeitpunkte und unterschiedlich lange SwiftF0-Ausgabefelder werden abgewiesen. Preload prüft jetzt den tatsächlich gewählten Pitch-Backend. Pitch- und Noten-Cacheversionen sind angehoben.

### Ergebnisse mit unveränderten Wortzeiten

| Messgröße | Bisheriger Stand | Konsensmodus |
| --- | ---: | ---: |
| Solo A: fehlende Notenmessungen | 137 / 184 | 86 / 184 |
| Solo B: fehlende Notenmessungen | 65 / 315 | 50 / 315 |
| Solo A: zusätzlich akzeptierte Frames | – | 426 |
| Solo B: zusätzlich akzeptierte Frames | – | 402 |

Das sind Abdeckungswerte, keine Richtigkeitsquote. Fehlende und widersprüchliche Messungen werden weiterhin nicht mit erfundenen Noten gefüllt. Bei Solo A ergeben CPU und CUDA dieselben 3.601 Pitch-Werte und Stimmhaftigkeitsentscheidungen. Der einzelne Vergleichslauf inklusive Modellstart und Notenbau dauerte etwa 63 s auf CPU und 8 s auf CUDA; bei Solo B etwa 10 s auf CUDA. Das ist ein weiterer Grund, den Modus zunächst gezielt zu vergleichen statt ihn ungeprüft als allgemeinen Standard einzuschalten.

### Referenzen und reproduzierbare Prüfung

Sechs Ausschnitte liegen unter `.verification/pitch-review/index.html`, jeweils mit Originalaudio, Gesangsspur und Spektralbild. Ihre Grenzen sind Solo A: 2–6, 19–23, 37–41 Sekunden; Solo B: 2–6, 30–34, 80–84 Sekunden. Alle Bilder wurden visuell geprüft. Das zugehörige `references.json` enthält SHA-256-Nachweise und den ausdrücklichen Status `pending_listening_review`. Es wurden keine menschlich geprüften Referenztöne vorgetäuscht. Die Hörprüfung der Hauptstimme, Tonhöhen und Oktavlage bleibt offen; diese Entwicklungsclips dürfen nicht als unabhängiger Abnahmekorpus ausgegeben werden. Die auffällige Referenzsynchronisation von Solo B wurde nicht automatisch umgeschrieben.

Zusätzlich existieren exakte, generierte Referenzen im Slow-Test `test_pitch_models.py`: 110, 220, 440 und 880 Hz mit Oberton sowie Stille, eingespeist mit 22.050 Hz. Beide echten Backends im Konsensmodus bestehen auf CPU und CUDA: mindestens 90 % Abdeckung im Inneren der Töne, weniger als 50 Cent Fehler je akzeptiertem Frame, keine akzeptierten Frames in der geprüften Stille. Ein frischer zweiter Modelllauf reproduziert das Ergebnis und lässt den NumPy-Zufallszustand unverändert. Ein separater Modellversuch mit leisen synthetischen Tönen zeigt zudem eine Regression von SwiftF0 0.3.0; auch deshalb wurde kein pauschales Upgrade vorgenommen.

Der neue Modus ist ein optionaler Entwickler-/Vergleichsweg, noch keine zusätzliche Auswahl in der Desktop-Oberfläche. Die Zusatzabhängigkeiten sind unter `pitch-quality` exakt auf `torchcrepe==0.0.24` und `resampy==0.4.3` festgelegt. Für den hier ausgeführten Vergleich wurden nur diese beiden Pakete isoliert neben die bereits vollständig eingerichtete Modellumgebung gelegt. Der konkrete Aufruf vom Repository-Stamm lautet:

```powershell
uv pip install --python .verification/candidate-env/Scripts/python.exe --target .verification/pitch-tools --no-deps torchcrepe==0.0.24 resampy==0.4.3
$env:PYTHONPATH = (Resolve-Path .verification/pitch-tools).Path + ';' + (Resolve-Path python-sidecar).Path
& .verification/candidate-env/Scripts/python.exe scripts/pitchReplay.py .verification/final-solo/0 .verification/alignment-replay/final-solo0-words.json .verification/pitch-repeat --backend swift-f0-consensus --device cuda
```

Der Aufruf setzt die vorhandene `.verification/candidate-env` mit ihren Modellabhängigkeiten voraus und ist kein Ersatz für eine vollständige Neuinstallation. In der App-verwalteten Umgebung wurde nichts nachinstalliert. `scripts/pitchReplay.py` friert Wortzeiten und Audio ein, protokolliert Versionen, Parameter und Eingabe-Hashes und schreibt ausschließlich in ein neues Ausgabeverzeichnis. `scripts/pitchReview.py` erzeugt aus einem JSON-Manifest neue Hörprüfpakete; Matplotlib wird nur für dieses separate Diagnosewerkzeug benötigt. Für einen normalen Pipeline-Vergleich mit installierten Extras gilt `$env:USC_PITCH = 'swift-f0-consensus'`.

Prüfstand: 222 reguläre Python-Tests bestanden, drei Slow-Tests abgewählt. Die zwei neuen Slow-Tests wurden separat mit echten CPU-/CUDA-Modellen ausgeführt und bestanden; sie prüfen auch die CREPE-Einzelmessungen, damit richtige SwiftF0-Werte keinen Fehler des zweiten Modells verdecken. 39 gezielte TypeScript-Tests für Songdaten, Export und persistente Editorhinweise bestanden ebenfalls. Alle Links, sechs Bilder und zwölf viersekündigen Audiodateien des Hörprüfpakets sind geprüft. Vollständig aufgelöste optionale Modellabhängigkeiten für Windows und Linux weisen im Audit keine bekannten Schwachstellen auf. Die CI prüft das Extra künftig auch in den CPU-/CUDA-Matrizen. Ein Linux-Modelllauf wurde damit weiterhin nicht ersetzt.
