# Alignment im Vierpass-Modell (Teilprojekt 1c)

Ersetzt die Align-Strategie aus [2026-07-28-alignment-anker-design.md](2026-07-28-alignment-anker-design.md).
Deren Fundament bleibt: Stufen, Cache-Invalidierung über Vorstufen-Identität,
Vertrag v2 mit `sections`, Messharness mit inhaltlicher Silben-Paarung, echte
LCS für das Anker-Matching.

**Vorbild:** [UltraStarKaraokeMaker](https://github.com/walterfr/UltraStarKaraokeMaker)
(MIT, © walterfr). Das Verfahren dort ist über dokumentierte Fehlschläge mit
Messwerten gereift und löst exakt die Schwächen, die unser Pilot nachgewiesen
hat. Portierte Logik trägt einen Attributionshinweis im Dateikopf; der
MIT-Lizenztext wird unter `docs/third-party/` abgelegt.

## Ausgangslage (Pilot, 5 Songs, 2026-07-29)

Nach LCS-Fix und ehrlicher Messung: Median 85–191 ms auf gutartigen Songs,
aber drei strukturelle Schwächen:

1. **Ankerzeiten sind geschätzt.** `transcribe` verteilt die Segmentdauer
   gleichmäßig auf die Wörter — Fehler bis in den Sekundenbereich (gemessen:
   erster Anker 6,4 s, gesungen 10,5 s).
2. **Der Aligner bekommt Text ohne Audio-Evidenz.** Sections zwingen den
   kompletten Text durch `whisperx.align`; wo das Audio die Wörter nicht
   hergibt (Chor: 29 Refrain-Vorkommen ungehört; Rap: 105-Wort-ASR-Loch),
   platziert der CTC sie irgendwo. Ergebnis beim schlimmsten Song: konstant
   ~12,5 s Versatz.
3. **Anker ohne Misstrauen.** Ein zufällig matchendes Füllwort in einem
   ASR-Loch erzeugte eine Section mit 13,6 Wörtern/s; der Ratenwächter fängt
   nur diesen Extremfall.

## Ziel und Abnahme

Unverändert: **80 % der Silben unter 50 ms**, gemessen über 30+ gemischte
Referenzsongs, je Song einzeln ausgewiesen, mit `anteilGepaart` als
Gültigkeitsmaß der Messung.

## Ansatz: vier Pässe plus eine zweite Evidenzquelle

Grundsatz: **Gemessene Zeit schlägt geschätzte Zeit, und geschätzt wird nie
still.** Jedes Wort trägt seine Quelle.

- **Pass 1 — exakte Anker.** Whisper transkribiert frei; das Transkript
  selbst geht durch `whisperx.align` und liefert *gemessene* Zeiten je
  gehörtem Wort. Unsere LCS (echte DP, monoton) matcht bekannte Wörter gegen
  gehörte; jeder Treffer wird ein Anker mit gemessener Zeit und
  phonetischem Score.
- **Pass 2 — Fuzzy-Anker.** In den Lücken zwischen exakten Ankern werden
  fast-gleiche Wörter (Zeichenähnlichkeit ≥ 0,6 auf akzentgefalteten
  Formen, monotone DP-Paarung) nachverankert: das akustische Ereignis ist
  dasselbe, nur die Schreibweise weicht ab („is'"/„ist", Plurale).
- **Anker-Misstrauen** (nach Pass 2):
  - Transkript-Tokens mit Ziffern liefern nie einen Anker — das
    wav2vec2-Vokabular enthält keine Ziffern, der Timestamp wäre erfunden.
  - Kurze Wörter (≤ 2 Zeichen), isoliert in großen Lücken, mit Score
    < 0,3: Anker verwerfen. Ein falscher Anker vergiftet Interpolation
    und Fenstergrenzen; keiner ist billiger.
- **LRC-Anker** (optional, wenn eine synchronisierte Lyrics-Datei vorliegt):
  Zeilenanfänge aus dem .lrc werden über Zeilen-LCS den Textzeilen
  zugeordnet. Erst **entlarven** sie gemessene Anker, die implausibel weit
  (> 3 s) von der interpolierten Erwartung zwischen zwei LRC-Pfosten
  liegen; dann **säen** sie Zeilenanfangs-Anker in Lücken, monoton gegen
  die Nachbarn geprüft. Das Songende wirkt als synthetischer letzter
  Pfosten.
- **Pass 3 — Fenster-Alignment der Lücken.** Für jede zusammenhängende
  Folge unverankerter Wörter läuft `whisperx.align` genau einmal, im
  Zeitfenster zwischen den benachbarten gemessenen Wörtern (bzw.
  Audio-Anfang/-Ende). Vorher wird das Fenster per RMS-Rahmen um Stille an
  den Rändern getrimmt (sonst schmiert der CTC Wörter in die Stille), und
  Zahlwörter werden für den CTC ausgeschrieben und danach wieder auf das
  Ursprungswort zusammengefasst. Das Ergebnis wird validiert (Tokenzahl,
  Monotonie, Fenstergrenzen ± 0,5 s); bei Verstoß fällt die Lücke auf
  Pass 4 zurück, ein Fensterfehler reißt nie die Pipeline.
- **Pass 4 — gewichtete Interpolation (letzter Rückfall).** Was übrig
  bleibt, wird zwischen den Nachbarankern interpoliert, gewichtet nach
  geschätzter Silbenzahl (Vokalgruppen), mit einer „Atempause" vor dem
  nächsten gemessenen Wort. Ketten am Songanfang/-ende sind durch die
  Audiodauer begrenzt. Interpolierte Wörter tragen Score 0,0 — ein anderes
  Signal als „phonetisch unsicher gemessen".

Der bisherige Weg — Sections als Segmente für den Aligner, `baue_abschnitte`,
Ratenwächter — entfällt ersatzlos; seine Aufgabe (Fenstergrenzen aus Ankern)
lebt präziser in Pass 3 weiter.

## Architektur

| Einheit | Änderung |
|---|---|
| `transcribe.py` | erweitert: nach der Transkription richtet `whisperx.align` das Transkript aus; `TranskriptWort` erhält `score`; Zeiten sind gemessen. STAGE_VERSION → 2. Fehlende Modelle → `LanguageUnsupported(stufe="transcribe")`. |
| `anchors.py` | umgebaut: Pass 1 (bestehende LCS) + Pass 2 (Fuzzy) + Misstrauen + LRC-Säen/-Entlarven. Rein, ohne Modelle. `Anker = (start, ende, score, quelle) \| None` je Textwort. `Abschnitt`, `baue_abschnitte`, Ratenwächter entfallen. |
| `align.py` | umgebaut: Pass 3 (Fenster-Alignment, Stille-Trimmen, Zahlwort-Expansion, Validierung) + Pass 4 (Interpolation). Signatur nimmt Anker statt Abschnitte. `zeilen_zuordnen` bleibt. Cache-Schlüssel nimmt einen Digest der Anker auf (deckt Transkript- und LRC-Einfluss ab) — ein geänderter Anker darf nie eine alte Ausrichtung wiederverwenden. |
| `numerals.py` | *neu*: Zahlwort-Expansion für den CTC (de zuerst, en optional; Portierung aus dem Vorbild mit Attribution). |
| `__main__.py` | verdrahtet Anker statt Abschnitte; `--synced-lyrics <pfad>` optional; Quelle je Wort läuft bis in die Noten. |
| `src/core/create/lrclib.ts` | *neu*: holt synchronisierte Lyrics von lrclib.net (Artist, Titel, Dauer), cached im Songverzeichnis, liefert bei Fehlschlag `null` — nie ein Abbruchgrund. |
| `src/core/create/pipeline.ts` | optionaler `syncedLyricsPath` wird als CLI-Argument durchgereicht. |
| `scripts/evaluate-pipeline.ts` | nutzt lrclib.ts je Song; weist im Bericht aus, ob ein .lrc vorlag. |

## Vertrauensmaß und Vertrag

Schema bleibt v2. `sections` beschreibt künftig Läufe gleicher Messbarkeit:
zusammenhängende gemessene Strecken (Quelle anchor/fuzzy/realign/lrc) bilden
Abschnitte mit `confidence` = mittlerem phonetischem Score, interpolierte
Läufe bilden Abschnitte mit `confidence` = 0. `anchoredBothSides` bedeutet:
beidseitig von gemessenen Wörtern begrenzt. Je Note wandert die bestehende
`confidence` weiter mit; der wav2vec-Score ist bei Gesang systematisch
niedrig, auch wenn die Zeit stimmt (Messwert des Vorbilds: 0,0–0,35 bei
korrektem Timing) — er ist Anzeige, nie Verwurfskriterium.

## Fehlerbehandlung

- Fehlendes ASR- oder Alignment-Modell: `LanguageUnsupported` mit Stufe.
- Fenster-Alignment scheitert (Ausnahme, Tokenzahl, Monotonie): Rückfall auf
  Pass 4 für genau diese Lücke, plus Warnung mit Lückenlänge.
- .lrc nicht auffindbar/abweichend: ohne LRC weiterlaufen; Zeilen ohne
  sicheres Zeilen-Matching bekommen schlicht keinen LRC-Anker.
- Song ganz ohne Anker: ein einziges Fenster über die volle Spur (Pass 3)
  — entspricht dem heutigen Verhalten, sichtbar über die Quellen.

## Teststrategie

- Rein und ohne GPU: Fuzzy-Paarung, Misstrauensregeln, LRC-Parsen,
  Zeilen-Matching, Säen/Entlarven mit Monotonie, Interpolationsgewichte,
  Fensterberechnung, Stille-Trimmen (synthetische Arrays), Zahlwort-Expansion,
  Zusammenfassen expandierter Tokens.
- Modelladapter dünn, mit Platzhalter-Stubs wie bisher; Cache-Invalidierung
  über Vorstufen-Identität unverändert testpflichtig.
- Abnahme: Pilot-Rerun (5 Songs), dann 30+-Korpus gegen die 80-%-Marke;
  Bericht weist je Song `anteilGepaart` und LRC-Verfügbarkeit aus.

## Risiken

- **LRCLIB-Abdeckung/-Passung unbekannt** für deutsche Karaoke-Songs; ein
  .lrc einer anderen Edition liefert falsche Pfosten — die 3-s-Toleranz und
  das Nur-equal-Zeilen-Matching begrenzen den Schaden. Wird im Pilot gemessen.
- **Fenster ohne echtes Vokal-Audio** (Chor, den auch der CTC nicht fassen
  kann): Pass 3 validiert und fällt auf Interpolation zurück — sichtbar,
  nicht still.
- **Kosten:** ein zusätzlicher `whisperx.align`-Lauf (Transkript) plus einer
  je Lücke; Modelle bleiben je Prozess geladen, auf GPU unkritisch.

## Bewusst nicht enthalten

Duette (die Singer-Tags des Vorbilds werden nicht portiert), persistenter
Modell-Worker, Verbesserungen an Tonhöhe und Silbentrennung, LRCLIB-Suche
über Fuzzy-Metadaten hinaus (nur exakter Get-Endpunkt mit Dauer-Toleranz).
