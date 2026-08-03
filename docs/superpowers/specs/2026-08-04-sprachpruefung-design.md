# Sprachprüfung vor dem Lauf — Design

**Datum:** 2026-08-04
**Zweig:** noch keiner, von `main`
**Vorgeschichte:** Teilprojekt 5 (`docs/superpowers/specs/2026-08-03-erstellen-ui-design.md`) ist fertig; dieses Design schließt eine Lücke, die der erste echte Lauf aufgedeckt hat.

## Das Loch

Der Assistent lässt die Sprache in Schritt 1 wählen und startet auf „Deutsch". Wer einen englischen Song einreiht und das übersieht, bekommt keinen Fehler, sondern **ein fertiges Paket voller Unsinn**: Whisper transkribiert mit dem deutschen Modell, whisperx richtet mit dem deutschen wav2vec2-Modell aus, und die Zeitstempel sind interpoliert statt gemessen.

Nachgewiesen an `Downloads/Ultrastarmakertest/The_Bleachers_-_Don't_Take_The_Money/song.txt` (Lauf vom 2026-08-04, `#LANGUAGE:de` bei englischem Text):

| Messwert | Bleachers (falsche Sprache) | Wahnsinn (richtige Sprache) |
|---|---|---|
| erste Textzeile | 0,0 – 19,9 s | 14,8 – 18,9 s |
| `#GAP` | 0 ms | 14 787 ms |
| Pause zwischen Zeilen, Median | 0,0 s | 1,7 s |
| Tonhöhen-Ausreißer > 1 Oktave | 53 / 600 | 5 / 294 |

Die Silbe „I" ist 108 Beats — 15 Sekunden — lang. Der Lauf kostet zehn Minuten GPU-Zeit und endet mit einem Paket, das aussieht wie ein Erfolg.

## Entscheidungen

**Die Prüfung läuft in der Pipeline, nicht im Assistenten.** In Schritt 2 kennt der Assistent bei einem YouTube-Link nur eine URL; die Tonspur holt erst `acquireMedia` im Queue-Lauf. Eine Erkennung im Assistenten müsste den Download vorziehen — also die teure Hälfte von `acquire` — und ihn ohne Cache verdoppeln. Bei einer lokalen Datei wäre es möglich, aber zwei Wege für dieselbe Prüfung sind es nicht wert.

**Sie läuft vor der `separate`-Stufe, auf dem Originalmix.** Zwei Gründe. Erstens hält `transcribe.py:60-63` fest, dass automatische Erkennung *auf einem stark bearbeiteten Gesangsstem* unzuverlässig ist — auf den getrennten Vocals zu prüfen hieße, gegen eine bereits getroffene Entscheidung zu arbeiten. Auf dem Mix ist Whisper näher an dem, wofür es trainiert wurde. Zweitens ist die Trennung die langsamste Stufe: davor abzubrechen spart sie mit.

**Die Erkennung ist ein Veto, keine Quelle der Wahrheit.** Gesungen wird weiter in der Sprache, die der Nutzer gewählt hat. Die Erkennung darf den Lauf nur *anhalten*, nie die Sprache stillschweigend ersetzen. Damit bleibt die Regel „feste Sprache statt stiller Vermutung" aus Teilprojekt 3 unangetastet.

**Kein Dialog, sondern ein Fehlschlag mit Anweisung.** Wenn die Queue läuft, sitzt niemand im Assistenten; eine Rückfrage würde die Queue blockieren. Der Job wird `failed` mit einem Satz, der beide Sprachen nennt und sagt, was zu tun ist.

**Kein neuer IPC-Kanal, keine neue Ansicht.** Der Weg `emit_error` → `FEHLER_ABBILDUNG`/`baueDetail` → `CreationEntry.error` → `CreationRow` steht schon und zeigt den Fehler als „· ‹Meldung›" hinter dem Status. Für den Hinweis unterhalb der Schwelle fehlt ein Stück — siehe „Die Schwelle".

## Ablauf

```
verarbeitung.py, vor separate:
  1. Audio laden (whisperx.load_audio auf --audio, den Originalmix)
  2. asr = modelle.hole_asr(MODELL, device, sprache)      # Modell wird sowieso gebraucht
  3. erkannt, wahrscheinlichkeit, _ = asr.model.detect_language(
         audio=audio, language_detection_segments=SEGMENTE)
  4. erkannt == gewaehlt            -> weiter, nichts melden
     wahrscheinlichkeit < SCHWELLE  -> weiter, Warnung an den Eintrag
     sonst                          -> emit_error("language_mismatch", ...), Rückgabe 1
```

`asr.model` ist die `faster_whisper.WhisperModel` in whisperx' Hülle. Deren `detect_language` liefert `(sprache, wahrscheinlichkeit, alle)` — whisperx' eigenes `detect_language` verwirft die Wahrscheinlichkeit (`whisperx/asr.py:309-312`) und ist damit unbrauchbar. Gemessen an der installierten Umgebung: whisperx mit faster-whisper 1.2.1.

`language_detection_segments` > 1 ist der Grund, dieses API zu nehmen: ein einzelnes 30-Sekunden-Fenster trifft bei einem instrumentalen oder gesummten Anfang ins Leere. Startwert **3**, wie `MIN_SCORE` in `coverArtArchive.ts` als benannte Konstante mit Begründung und dem Vermerk, dass er an echten Songs nachzumessen ist.

## Die Schwelle

`SPRACH_SCHWELLE = 0.7` als Startwert, über faster-whispers eigenem Standard von 0,5. Darunter wird **nicht** abgebrochen: eine unsichere Erkennung darf einen richtigen Job nicht aufhalten. Stattdessen bekommt der Nutzer einen Hinweis — sichtbar, aber harmlos.

**Der Weg dieses Hinweises muss erst fertiggebaut werden.** Der Sidecar hat nur `@@PROGRESS` und `@@ERROR`, keinen Warnkanal, und die `warnung`-Meldungen in `creations.ts:276` stammen ausschließlich aus `paket.warnungen`. Einen dritten Prefix samt Parser durch drei Schichten zu ziehen wäre für einen Hinweis zu viel. Es gibt aber ein Feld, das schon existiert und heute ins Leere läuft: `SongData.meta.warnings` steht im Vertrag und wird von `parseSongData` gelesen (`songData.ts:150`), doch `assemblePackage` reicht es an niemanden weiter.

Also: der Sidecar hängt den Satz an `meta.warnings` in `song_data.json`, und `assemblePackage` füllt seine `warnungen` künftig **mit** `songData.meta.warnings` vor. Damit landet der Hinweis auf dem Weg, der schon steht — und ein Feld, das seit Teilprojekt 3 niemanden erreicht, erreicht endlich jemanden. Der Preis: der Hinweis erscheint erst am Ende des Laufs, beim Paketbau. Für eine Warnung ist das hinnehmbar, das Paket entsteht ohnehin.

> „Sprache unsicher erkannt: Englisch (0,58) — gewählt ist Deutsch."

Die Asymmetrie ist Absicht. Ein falscher Abbruch kostet den Nutzer eine Wiederholung und Vertrauen; ein durchgelassener Fehlgriff kostet zehn Minuten und ein Paket, das er wegwerfen muss. Beides ist teuer, aber der falsche Abbruch trifft auch den, der alles richtig gemacht hat.

## Der Fehlerweg bis in die UI

Der Sidecar meldet **strukturiert und sprachneutral** — die deutschen Sätze entstehen in TypeScript, wo die Sprachtabelle schon liegt:

```python
emit_error("language_mismatch", erkannt="en", gewaehlt="de", wahrscheinlichkeit=0.98)
```

`FEHLER_ABBILDUNG` in `src/core/create/pipeline.ts` bekommt `language_mismatch: "LanguageUnsupported"` — dieselbe Fehlerklasse, es ist derselbe Sachverhalt aus Nutzersicht. `baueDetail` bekommt einen Fall dafür und baut mit `spracheName()` aus `src/core/create/languages.ts`:

> „Erkannt: Englisch, gewählt: Deutsch — Sprache in Schritt 1 ändern und neu einreihen."

Ohne diesen Fall stünde dort `language_mismatch: erkannt=en gewaehlt=de wahrscheinlichkeit=0.98`, wie es dem Nutzer heute bei `language_unsupported` begegnet ist.

## Was dieses Design bewusst weglässt

- **Eine Sprachheuristik über den Liedtext in Schritt 3.** Sie wäre gratis und würde früher warnen, wäre aber eine zweite, schwächere Wahrheit über dieselbe Frage.
- **Automatisches Umschalten auf die erkannte Sprache.** Siehe oben: dieselbe Falle mit umgekehrtem Vorzeichen.
- **Das Nachrüsten schon erzeugter Pakete.** Wer ein falsches Paket hat, wirft es weg und reiht neu ein.

## Tests

Alles mit Attrappen, keine GPU:

| Fall | Erwartung |
|---|---|
| erkannt ≠ gewählt, Wahrscheinlichkeit über Schwelle | Abbruch vor `separate`, `language_mismatch` mit beiden Codes |
| erkannt ≠ gewählt, Wahrscheinlichkeit unter Schwelle | kein Abbruch, Satz steht in `meta.warnings` |
| `assemblePackage` mit `meta.warnings` | die Sätze stehen in `warnungen`, vor den eigenen Befunden |
| erkannt = gewählt | kein Abbruch, keine Meldung |
| Erkennung wirft (kein Modell, GPU voll) | `MemoryError`/„out of memory" bleibt durchgereicht, wie in `transcribe.py` |
| `baueDetail` mit `language_mismatch` | deutscher Satz mit beiden Sprachnamen, nicht `k=v` |
| `creations` mit einem Worker, der `language_mismatch` wirft | Eintrag `failed`, `error` enthält den Satz, Queue läuft weiter |

## Risiken

- **Ein Modelldurchlauf mehr im Erfolgsfall.** Die Erkennung läuft immer, auch wenn alles stimmt. Sie braucht das ASR-Modell, das sowieso geladen wird, und drei Segmente Encoder-Durchlauf — Sekunden gegen die zehn Minuten des Gesamtlaufs. Falls es doch spürbar wird, ist der Ausweg, sie zu überspringen, wenn der Nutzer die Sprache in dieser Sitzung bewusst umgestellt hat.
- **`asr.model` ist eine Annahme über whisperx' Innenleben.** Ein Versionswechsel kann sie brechen. Der Test dafür ist eine Attrappe, also fällt es erst im echten Lauf auf; die Stelle bekommt deshalb einen Kommentar mit der geprüften Version.
- **Die Schwelle 0,7 ist geraten.** Sie ist an echten Songs nachzumessen — insbesondere an einem deutschen Schlager mit englischem Refrain, dem Fall, in dem eine Erkennung auf dem Mix am ehesten kippt.
