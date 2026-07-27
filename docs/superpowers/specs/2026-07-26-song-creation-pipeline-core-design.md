# Design: Song-Erstellung, Pipeline-Kern (Teilprojekt 1 von 6)

**Datum:** 2026-07-26
**Status:** Entwurf genehmigt
**Ausgangslage:** Bisher lädt die App nur Songs, die es in der USDB schon gibt. Songs, die dort fehlen, kann man mit ihr nicht erzeugen. Auslöser war die Frage, ob sich [UltraStarKaraokeMaker](https://github.com/walterfr/UltraStarKaraokeMaker) (MIT) einfach integrieren lässt.

Die Prüfung ergab: funktional ist es das passende Gegenstück, technisch aber keine Integration. Ihr Stack ist Tauri + Rust + Python, unserer Electron + Bun; ihre Tauri-Hülle ist bei uns nicht lauffähig. Vor allem besitzen wir große Teile ihrer Pipeline schon selbst — yt-dlp (`core/api/youtube`), ffmpeg (`core/platform.ts`), Metadaten über MusicBrainz/Deezer/Last.fm (`core/api/genres`), Cover, Benennung, Storage. Es fehlt uns **ausschließlich** der modellgestützte Teil: Stimmtrennung, Forced Alignment, Pitch, Tempo.

Damit ist das Vorhaben kein Integrationsprojekt, sondern ein Eigenbau mit ihrem Repo als Blaupause (MIT erlaubt das ausdrücklich). Es zerfällt in sechs unabhängige Teilprojekte:

| # | Teilprojekt | Vorbild im Bestand |
|---|---|---|
| **1** | **Pipeline-Kern — dieser Spec** | — |
| 2 | Sidecar-Umgebung (Python, venv, Modelle) | `desktop/main/binaries.ts` |
| 3 | TS-Orchestrierung (IPC, Queue, Abbruch) | `desktop/main/downloads.ts`, `ipc.ts` |
| 4 | Paketbau (Cover, Video, Ordnerlayout) | `download/downloadSong.ts`, `naming.ts` |
| 5 | Erstellen-UI | `desktop/renderer/views/` |
| 6 | Korrektur-Editor (Wellenform, Noten-Drag) | — |

Das gesamte Vorhaben steht und fällt mit Teilprojekt 1: trägt die Sync-Qualität nicht, sind 2 bis 6 wertlos. Deshalb zuerst und deshalb kopflos.

## Entscheidungen

Aus dem Brainstorming, jeweils mit Begründung:

- **Zielgruppe sind alle App-Nutzer**, nicht nur Power-User. Folge: GPU-Zwang, Python und ~4 GB Modelle sind ein UX-Problem erster Klasse — gelöst in Teilprojekt 2 durch bedarfsweise Installation, nicht durch Mitliefern.
- **Der Umfang umfasst einen Nachkorrektur-Editor** (Teilprojekt 6). Ohne ihn ist ein schiefer Sync für Laien eine Sackgasse.
- **Kein Abhängigkeitsverhältnis zu USKMaker.** Eigener Sidecar direkt auf WhisperX + Demucs + SwiftF0. Grund: 19 Tage alt, v0.11.0, elf Releases in 19 Tagen, ein Entwickler — als Fundament eines Flaggschiff-Features zu volatil. Ihr Code bleibt Referenz für die teuren Detailfragen (Demucs-Modellwahl, WhisperX-Parameter, Halb/Doppel-BPM-Fix, Abbildung Alignment → Noten).
- **Sprachagnostisch von Anfang an.** Sprache ist ein Parameter, Modelle werden bedarfsweise geladen — plus definierter Rückfall, weil WhisperX nur eine begrenzte Sprachliste hat und pyphen nicht jede Sprache kennt.
- **Prozess-CLI, nicht Bibliothek, nicht Dauer-Worker.** Python liefert JSON, TypeScript schreibt das `.txt`. Ein persistenter Worker mit vorgehaltenen Modellen (spart 30–60 s Ladezeit pro Song) ist später möglich, ohne den Vertrag zu brechen — jetzt unnötige Komplexität.
- **Qualitätslatte ist messbar**, nicht subjektiv: Vergleich gegen von Menschen gesynctes `.txt` aus der USDB.

## Abgrenzung

**Eingang:** lokaler Audiopfad, Liedtext als Zeilen (eine pro gesungener Phrase), Sprache, optional BPM.
**Ausgang:** `song_data.json` und ein spielbares `song.txt`.

Wichtig für die Aufteilung: **Interpret und Titel erreichen Python nie.** Sie sind reine Kopfdaten und werden erst auf TS-Seite in `renderSongTxt(songData, headers)` eingesetzt. Python bekommt vom Metadatenkram ausschließlich `--bpm` — und zwar nur, weil das die Tempoerkennung ersetzt: ist der Wert gesetzt, wird `detect_bpm` übersprungen; fehlt er, wird er ermittelt.
**Kein** Electron, **keine** UI, **keine** IPC. Beide Seiten laufen über Kommandozeile.

Bewusst kein YouTube-Eingang: der Bewertungs-Harness braucht ohnehin deterministisches lokales Audio, und die Beschaffung steht schon in `core/api/youtube` — die nutzt der Harness, nicht die Pipeline.

## Architektur

Die Prozessgrenze ist nach Fähigkeit geschnitten, nicht nach Bequemlichkeit:

| Seite | Verantwortung |
|---|---|
| **Python** (`python-sidecar/`) | Alles Modellgestützte. Ergebnis ist ausschließlich JSON — Python kennt das UltraStar-Format nicht. |
| **TypeScript** (`src/core/create/`) | Prozess starten, Fortschritt lesen, abbrechen, JSON validieren, `.txt` serialisieren, Qualität messen. Kennt keine Modelle. |

Sinn der Trennung: das UltraStar-Format bleibt an *einer* Stelle. Teilprojekte 4 und 5 bauen darauf auf, ohne eine zweite Wahrheit in Python zu pflegen.

Bestehende Muster, denen gefolgt wird: `Effect` für Nebenläufigkeit und typisierte Fehler (das Projekt nutzt ausschließlich `import { Effect }` — kein Schema, kein zod, also handgeschriebene Validierung) und Kommentare auf Deutsch.

## Python-Sidecar (`python-sidecar/ultrastar_pipeline/`)

| Modul | Aufgabe | Hängt ab von |
|---|---|---|
| `__main__.py` | CLI, Orchestrierung, Fortschritt, JSON schreiben | alle unten |
| `separate.py` | `separate(audio, work) -> Path` (vocals.wav) | demucs, torch |
| `align.py` | `align(vocals, lines, language) -> list[AlignedWord]` mit Start/Ende/Konfidenz | whisperx |
| `pitch.py` | `track_pitch(vocals) -> PitchTrack` (f0-Verlauf + voiced-Flag) | swift-f0 |
| `tempo.py` | `detect_bpm(audio) -> float`, inkl. Halb/Doppel-Korrektur | librosa |
| `syllables.py` | `split(wort, sprache) -> list[str]`, mit Rückfall | pyphen |
| **`notes.py`** | **`build_notes(words, pitch, bpm, language) -> list[Note]`** | **nichts** |
| `contract.py` | `schemaVersion`, Serialisierung | — |
| `cache.py` | Hash(Audioinhalt + Stufenparameter + Stufenversion) → Arbeitsverzeichnis | — |
| `progress.py` | JSON-Lines mit Marker-Präfix auf stdout | — |

CLI:

```
python -m ultrastar_pipeline \
  --audio PFAD --lyrics-file PFAD --language de \
  [--bpm N] [--device auto|cuda|cpu] [--work-dir D] \
  --out song_data.json
```

## TypeScript (`src/core/create/`)

| Modul | Aufgabe |
|---|---|
| `pipeline.ts` | `runPipeline(input): Effect<SongData, PipelineError>` — spawnen, Fortschritt, Abbruch |
| `songData.ts` | Typen + `parseSongData(unknown): SongData`, prüft `schemaVersion` |
| **`writeSongTxt.ts`** | **`renderSongTxt(songData, headers): string`** |
| `lyrics.ts` | `normalizeLyrics(raw): { lines, entfernt, offeneFragen }` |
| `evaluate.ts` | `compareToReference(unser, referenz): Metrics` |

### Der Noten-Serialisierer ist Neuland

Frühere Annahme war, wir hätten den `.txt`-Writer schon. Das ist falsch: `downloadSong.ts` schreibt den von der USDB gelieferten Text **unverändert** weg (`writeFile(song.txt, content)`), und `repairSongs.ts` parst und patcht nur den Kopfblock. Einen Noten-Serialisierer gibt es nicht.

`writeSongTxt.ts` muss also neu entstehen: Kopfblock, `:`-Notenzeilen mit Beat/Länge/Tonhöhe/Silbe, `-`-Zeilenumbrüche, `E`-Abschluss. Es lehnt sich an die Header-Kenntnis aus `repairSongs.ts` an — dort ist unter anderem schon bekannt, dass deutsche Dateien bei `#BPM` Komma als Dezimaltrenner nutzen.

### Die tragende Eigenschaft

`notes.py`, `writeSongTxt.ts`, `lyrics.ts` und `evaluate.ts` sind **rein** — keine Modelle, kein Dateisystem, keine GPU. Genau in ihnen wird die Sync-Qualität entschieden. Die Tuning-Schleife von Teilprojekt 1 läuft damit in Funktionen, die in Millisekunden ohne GPU testbar sind; die Modell-Module drumherum sind dünne Adapter, die man einmal richtig hinbekommt.

Wäre `notes.py` in der CLI vergraben, müsste für jede Justierung Demucs laufen.

## Vertrag (`song_data.json`)

```json
{
  "schemaVersion": 1,
  "bpm": 294.5,
  "gap": 1200,
  "language": "de",
  "notes": [
    { "beat": 0, "length": 4, "pitch": 5, "syllable": "Hal", "confidence": 0.91 }
  ],
  "lineBreaks": [{ "afterNoteIndex": 7, "beat": 32 }],
  "meta": {
    "durationSec": 214.3,
    "device": "cuda",
    "stageVersions": {},
    "warnings": [],
    "confidence": { "median": 0.88, "unsureRatio": 0.04, "largestGapSec": 1.9 },
    "lowConfidence": false
  }
}
```

`schemaVersion` von Anfang an: wir haben uns gegen Kopplung an USKMaker entschieden, sollten uns aber auch nicht unversioniert an uns selbst koppeln.

## Datenfluss und Cache

```
TS: runPipeline()  ->  spawn python -m ultrastar_pipeline
                          |
                          +- tempo    (librosa, Originalmix)     billig
                          +- separate (Demucs -> vocals.wav)     teuer   <- gecacht
                          +- align    (WhisperX: vocals+Zeilen)  teuer   <- gecacht
                          +- pitch    (SwiftF0 -> f0-Verlauf)    mittel  <- gecacht
                          +- notes    (rein: -> Noten + Beats)   billig  <- nie gecacht
                          |
                     song_data.json
                          |
TS: parseSongData -> renderSongTxt -> song.txt
```

`notes` wird absichtlich nie gecacht: billig, und genau das, was justiert wird. Die drei teuren Stufen liegen im Cache, geschlüsselt über Hash aus **Audioinhalt** (nicht Pfad) + Stufenparameter + Stufen-Codeversion. Eine Änderung an der Notenlogik läuft damit in Sekunden neu.

Stufenergebnisse werden erst in eine Temporärdatei geschrieben, dann umbenannt — ein Abbruch kann den Cache nicht vergiften. Das Muster steht schon in `binaries.ts`, wo `downloadFile` nach `.download` schreibt und dann umbenennt.

## Fortschritts- und Fehlerkanal

torch, Demucs und WhisperX schreiben reichlich eigenen Text, teils auf stdout. Reines JSON-Lines wäre daher nicht verlässlich parsebar. Deshalb Marker-Präfix:

```
@@PROGRESS {"stage":"separate","percent":0.4}
@@ERROR    {"kind":"language_unsupported","language":"is"}
```

TS filtert auf das Präfix, alles andere ist Log. Das ist immun gegen Bibliotheksrauschen und funktioniert auf Windows, im Gegensatz zu einem zusätzlichen Filedeskriptor.

Fehler werden auf typisierte Effect-Fehler abgebildet — `EnvMissing`, `LanguageUnsupported`, `AlignmentFailed`, `DeviceError`, `Cancelled`, `ContractMismatch`. Kein Parsen von Prosa, kein `includes("CUDA")`.

## Textaufbereitung (`lyrics.ts`)

Marker im Liedtext werden nicht abgelehnt, sondern aufbereitet — mit Rückfrage, wo es mehrdeutig ist:

| Fall | Verhalten |
|---|---|
| `.lrc`-Zeitstempel `[00:12.34]` | deterministisch entfernen — wird nie gesungen |
| `[Verse 1]`, `[Bridge]`, `[Intro]` **mit** folgendem Text | Überschrift, entfernen |
| `[Chorus]` **allein**, ohne folgenden Text, früherer Refrain vorhanden | **Rückfrage:** Refrain hier ausschreiben? |
| `(2x)`, `(x2)`, `2x` am Zeilen- oder Blockende | **Rückfrage:** nur die Zeile oder der ganze Block? |

`[Chorus]` hat zwei Bedeutungen — Überschrift oder Verweis „hier den Refrain nochmal singen". Blindes Entfernen würde im zweiten Fall gesungenen Text verlieren, was schlimmer ist als Ablehnen.

Zwei Folgen:

- **Leerzeilen sind Struktur, nicht Müll.** Sie definieren, was ein Block ist, und dürfen erst *nach* dem Ausschreiben entfernt werden — sonst ist „Zeile oder Block" nicht mehr beantwortbar.
- **Die Rückfrage gehört nicht in Teilprojekt 1.** Kopflos ist niemand zu fragen. `normalizeLyrics` **meldet** offene Fragen strukturiert, es entscheidet nicht. Beantwortet werden sie später in der UI (Teilprojekt 5). Die CLI nimmt aufbereiteten Text; stecken ungelöste Fragen darin, bricht sie sofort ab und listet sie, statt zu raten.

Das Modul liegt in TS und nicht in Python, weil die UI es interaktiv nutzen muss, bevor überhaupt ein Prozess startet — und weil es reine Textlogik ohne Modell ist.

## Fehlerfälle

Der gefährlichste Fehler ist der stille: passen die Lyrics nicht zum Audio, scheitert Forced Alignment *nicht*, sondern liefert etwas Plausibles und Falsches. Gegenmittel:

1. **Vorprüfung vor der GPU-Zeit** über `lyrics.ts` — kostet Millisekunden, verhindert einen Zehn-Minuten-Lauf ins Leere.
2. **Konfidenz auswerten** — WhisperX liefert Konfidenz pro Wort. Aggregiert nach `meta.confidence` (Median, Anteil unsicherer Wörter, größte nicht zugeordnete Lücke). Unter der Schwelle wird `lowConfidence` gesetzt; Teilprojekt 5 warnt später, Teilprojekt 1 macht es sichtbar.

Weitere Fälle:

| Fall | Verhalten |
|---|---|
| WhisperX-Alignment-Modell fehlt für Sprache | harter Abbruch mit Sprachnamen — Alignment ist nicht ersetzbar |
| pyphen-Wörterbuch fehlt für Sprache | Rückfall auf ganze Wörter statt Silben, als Warnung in `meta` |
| Umgebung fehlt (Interpreter, Pakete) | präzise Diagnose: welches Paket, welcher Interpreter, welcher Befehl hilft. Installation ist Teilprojekt 2 |
| Kein CUDA vorhanden | bei `--device auto` auf CPU, mit Warnung |
| GPU-Speicher voll (OOM) | harter Abbruch mit Hinweis auf `--device cpu`. **Kein** automatisches Ausweichen — das verwandelt einen 40-Sekunden-Fehler stillschweigend in zehn Minuten |
| Abbruch durch Aufrufer | Prozessbaum killen, weil Demucs Kindprozesse startet |
| `schemaVersion` unbekannt | expliziter Fehler, kein teilweises Parsen |

## Format-Konventionen empirisch festnageln

Beat-Einheit und Tonhöhen-Nullage im UltraStar-Format sind notorisch verwechselbar: `#BPM` und die `:`-Beatwerte stehen nicht im naiven Verhältnis, und ob Tonhöhe 0 auf C4 liegt, wird unterschiedlich behauptet.

Das wird **nicht** aus der Doku abgeleitet, sondern **aus dem Referenzkorpus gemessen**. Wir haben tausende von Menschen gesyncte `.txt` mit bekanntem BPM; daraus lässt sich die Konvention empirisch bestimmen. Ein kleines Analyseskript liest Referenzdateien samt BPM und meldet das gemessene Beat-Verhältnis.

Das ist Voraussetzung dafür, dass `notes.py` überhaupt sinnvoll justierbar ist, und muss deshalb vor dessen Feinarbeit erledigt sein.

## Tests

Vier Ebenen, bewusst unterschiedlich schnell.

**1. Reine Einheitstests — die Masse, ohne GPU, Millisekunden.** `notes.py` im Zentrum, tabellengetrieben mit synthetischen Alignment- und Pitch-Eingaben. Dazu `syllables.py` samt Rückfall, die Halb/Doppel-Korrektur aus `tempo.py`, und auf TS-Seite `lyrics.ts` (Marker, Blöcke, offene Fragen), `writeSongTxt.ts` gegen Golden-Strings, `songData.ts` inklusive `schemaVersion`-Bruch, `evaluate.ts` auf synthetischen Paaren.

**2. Adapter-Rauchtests — dünn und wenige.** `separate`, `align`, `pitch` je ein Test auf einem wenige Sekunden langen Clip. Geprüft wird die **Form** der Ausgabe, nicht die Qualität. Langsam, GPU-nah, standardmäßig übersprungen.

**3. Integrationstest ohne Modelle.** Committet werden nicht Audio, sondern die **Alignment- und Pitch-JSONs** eines kurzen Songs als Fixture — die sind klein. Damit läuft `notes → JSON → .txt` vollständig durch, in CI, ohne GPU und ohne 4 GB Modelle. Das deckt genau die Kette ab, in der Formatfehler sitzen.

**4. Bewertungs-Harness — der eigentliche Nachweis, kein Test.** Liegt als `scripts/evaluate-pipeline.ts` neben dem Repo-Code, nicht unter `src/`, weil es kein Auslieferungsbestandteil ist. Ebenso das Konventions-Analyseskript aus dem vorigen Abschnitt als `scripts/measure-beat-convention.ts`. Beide sind über `bun run` startbar und laufen ausschließlich lokal.

Skript über N Referenzsongs: Audio über `core/api/youtube` besorgen, Lyrics **aus dem Referenz-`.txt`** ziehen, Pipeline laufen lassen, Onsets gegen das Original vergleichen. Bericht mit Median-Abweichung, p90, Anteil Silben unter 50 ms und unter 100 ms, Abweichung in der Notenanzahl.

Weil die Lyrics aus der Referenz selbst stammen, stimmen die Silbenfolgen 1:1 überein — der Vergleich ist wohldefiniert und nicht durch Textnormalisierung verfälscht.

### Randbedingungen

- **Kein Audio und keine Referenz-`.txt` im Repo** (Urheberrecht). Stattdessen ein Manifest mit Interpret/Titel/USDB-ID und ein ignoriertes lokales Cache-Verzeichnis.
- **Übersprungene Tests müssen sichtbar sein.** Auf CI gibt es keine GPU — ohne Gegenmaßnahme wäre „alles grün" identisch mit „nichts gelaufen". Reine Tests laufen immer, langsame werden explizit markiert und ihre Anzahl im Bericht ausgewiesen.
- **Python-Tests brauchen einen eigenen Einstieg** neben `bun test src`, weil pytest davon nicht erfasst wird.

## Offene Risiken

- **Modell-Lizenzen sind nicht geprüft.** MIT gilt für den Code von USKMaker, nicht automatisch für Modellgewichte. Bei Demucs gab es historisch nicht-kommerzielle Varianten; WhisperX zieht für Diarisierung pyannote-Modelle, die auf Hugging Face zugangsbeschränkt sind (daher der `HF_TOKEN` in ihrer Anleitung). Für eine Ein-Klick-Installation an Endnutzer ist ein selbst zu besorgender Token ein echtes Hindernis. **Muss vor Teilprojekt 2 belastbar geklärt werden** — betrifft Teilprojekt 1 nur insofern, als die Modellauswahl davon abhängen kann.
- **Erreichbare Alignment-Qualität ist unbewiesen.** Genau deshalb ist dieses Teilprojekt das erste und hat eine messbare Latte.

  Der Zielwert steht hier absichtlich noch nicht: eine Zahl ohne Messgrundlage wäre geraten. Stattdessen ist das Verfahren festgelegt, mit dem sie entsteht:

  1. Erster Meilenstein der Umsetzung ist „Harness läuft und Basiswert ist dokumentiert" — noch **vor** der Feinarbeit an `notes.py`.
  2. Der Basiswert wird über ein festes Korpus von mindestens 20 Songs gemessen, gemischt über Sprachen und Tempi.
  3. Die daraus abgeleitete Schwelle wird als `## Nachtrag` in **dieses** Dokument geschrieben, wie es der Genre-Anreicherungs-Spec mit seinem Volllauf-Befund vormacht.
  4. Ab dann gilt sie als Regressionsgrenze: verschlechtert sich der Wert, ist die Änderung schuld, nicht die Messung.
- **Sprachagnostik ist nur so gut wie die Modellabdeckung.** Für Sprachen ohne WhisperX-Alignment gibt es keinen Ersatz; die Liste der unterstützten Sprachen wird damit zur Produkteigenschaft und muss später in der UI sichtbar sein.
- **Produktcharakter verschiebt sich.** Aus einem schlanken Downloader wird ein Werkzeug mit GPU-Erwartung und mehreren Gigabyte Modellen. Das ist eine Positionierungsentscheidung, keine technische, und liegt außerhalb dieses Specs.

## Bewusst nicht enthalten

- **Duette** (`P1`/`P2`-Format) — später, verdoppelt Alignment- und Notenlogik.
- **YouTube als Pipeline-Eingang** — der Harness nutzt den bestehenden Core, die Pipeline nimmt lokale Dateien.
- **Cover, Hintergrund, Video, Ordnerlayout** — Teilprojekt 4.
- **Lyrics-Suche (LRCLIB)** — senkt die Einstiegshürde, gehört aber zur UI in Teilprojekt 5.
- **Jede UI, jedes IPC, jede Queue** — Teilprojekte 3 und 5.
- **Korrektur-Editor** — Teilprojekt 6.
- **Installation der Python-Umgebung und Modelle** — Teilprojekt 2. Teilprojekt 1 diagnostiziert nur.
- **Persistenter Worker mit vorgehaltenen Modellen** — später möglich ohne Vertragsbruch.

## Nachtrag: Gemessene Beat-Konvention (2026-07-26)

`BEATS_PER_BPM_UNIT = 4`, gemessen über 40 Songs der lokalen Bibliothek (`J:/Ultrastar`).
Median Songende/Audiodauer 0,919; 36/40 im zweiseitigen Fenster 0,6–1,05 (>= 90 %, also konsistent). Vergleichswerte aus demselben Lauf: Faktor 1 → Median 3,407 (2/40 im Fenster), Faktor 2 → Median 1,742 (1/40), Faktor 8 → Median 0,490 (0/40, unterschreitet die Untergrenze). Faktor 4 ist damit klar der einzige plausible Wert.
Ermittelt mit `scripts/measure-beat-convention.ts`.

## Nachtrag: Zurückgestellte Befunde bei Abschluss des Codes (2026-07-27)

Alle zwölf Teilaufgaben sind umgesetzt und abgenommen. Die folgenden Befunde stammen aus den Task-Reviews und aus eigenen Messungen; jeder wurde bewusst zurückgestellt, mit Begründung. Sie stehen hier, weil das Arbeitsverzeichnis des Ablaufs gelöscht wird und dieses Wissen sonst verloren ginge.

### Blockierend für den Qualitätsnachweis

- **Der Alignment-Ansatz ist unbewiesen.** Kein Modellaufruf des Sidecars ist je ausgeführt worden. Der ursprüngliche Entwurf war falsch — er gab jeder Textzeile ein eigenes Zeitfenster der Länge Null — und wurde auf einen Durchgang über die ganze Aufnahme umgestellt. Besser begründet, nicht belegt.
- **Die Zeilenrückgewinnung zählt Wörter über Leerzeichen-Trennung.** WhisperX kann anders tokenisieren. Dann verschiebt sich die Zuordnung *und* die Abweichungswarnung schlägt fälschlich an. Bewusst nicht blind umgebaut: erst echte Aligner-Ausgabe ansehen, dann einmal informiert korrigieren.
- **WhisperX ist auf Python 3.14 nicht installierbar.** Es pinnt `ctranslate2==4.4.0`, wofür kein Wheel für 3.14 existiert (verfügbar ab 4.6.1); zahlreiche Pakete im Umfeld enden bei `<3.13`. **Konsequenz für Teilprojekt 2:** die Umgebungsverwaltung muss eine passende Python-Version mitliefern, statt sich auf die vorhandene zu verlassen.

### Lücken im Vertrag

`parseSongData` lässt Eingaben durch, die der deklarierte Typ ausschließt.

- **Eine Silbe mit Zeilenumbruch zerstört die Datei.** Verifiziert: die Ausgabe erhält eine verwaiste Zeile, die kein gültiges Konstrukt ist. Heute unerreichbar, weil beide Produzenten Umbrüche wegschneiden — der Vertrag verbietet es aber nicht. Fixstelle: `text()` in `songData.ts`.
- **`lineBreaks[].afterNoteIndex` wird nicht gegen `notes.length` geprüft.** Ein Index außerhalb des Bereichs wird beim Serialisieren still verworfen.
- **`language: ""` besteht die Validierung**, führt aber dazu, dass `#LANGUAGE` still fehlt.
- **`stageVersions` hat auf der Python-Seite keine Laufzeitprüfung** auf Strings. Die TypeScript-Seite koerziert defensiv; das sollte ein No-op sein und ist derzeit nicht garantiert.

### Bekannte Verhaltensgrenzen

- **Wiederholungsmarker jenseits von zweimal** werden nicht erkannt. Praxisrelevant.
- **Ein alleinstehender Refrain-Verweis als allererste Zeile** erzeugt eine Rückfrage mit leerer Vorlage. Die Oberfläche in Teilprojekt 5 muss das abfangen.
- **Bei einem Cache-Treffer entfällt die Abweichungswarnung**, obwohl die Bedingung beim Schreiben galt. Sauber zu lösen hieße, den Cache-Inhalt zu versionieren.
- **`MIDI_NULLAGE = 60` ist eine Annahme.** Über 300 Referenzsongs liegt der Median der Song-Median-Tonhöhen bei 8, was dazu passt — ein Irrtum um eine Oktave sähe identisch aus. Der Tonhöhen-Vergleich der Metrik klärt es beim ersten Lauf.
- **Die Tempokorrektur klemmt nicht** bei absurden Eingaben, sondern gibt nach acht Schritten einen Wert außerhalb des Bereichs zurück.
- **Die verlustfreie Silbenzerlegung gilt nur**, solange das Wort das interne Trennzeichen nicht enthält.

### Testlücken

- Der Monotonie-Test der Zeitumrechnung prüft nur ein Nachbarpaar bei einem Tempo.
- Der POSIX-Zweig des Prozessbaum-Abbruchs ist ungetestet — es gibt keinen POSIX-Läufer. Der Fix ruht auf Begründung.
- Der Pfad „pyphen fehlt vollständig" ist ungetestet; nur der Fall einer unbekannten Sprache wird geprüft.
- Der Nebenläufigkeits-Test des Caches belegt den geteilten Temp-Pfad, nicht buchstäbliches Vermischen von Bytes. Er wacht über die richtige Invariante, beweist aber das schwächere Merkmal.
- Die AST-Reinheitsprüfung erfasst nur die beiden genannten Dateien; ein verbotenes Paket über ein drittes lokales Modul bliebe unentdeckt.

### Bewusste Abwägungen

- **Ein `detached`-Kind ist auf POSIX verwaist**, wenn der Elternprozess ohne den Abbruchpfad stirbt. Das ist der Preis dafür, dass der Gruppen-Abbruch überhaupt wirkt. **Teilprojekt 3 muss beim Beenden aktiv aufräumen.**
- **Ein fehlgeschlagener Abbruch ist unsichtbar** — Folge der bewusst verschluckenden Fehlerbehandlung.
- **`runPipeline` erkennt Testskripte an der Dateiendung**, statt einen injizierbaren Starter anzubieten. Vertagt, weil es die öffentliche Form ändert, auf die der Harness zugreift.
- **Log-Ausgaben könnten theoretisch ein Markerpräfix vortäuschen.**
- **Der Parameterhash des Caches ist auf acht Zeichen gekürzt** — dünner Kollisionsspielraum.
- **Ein nicht serialisierbarer Stufenparameter** wirft einen rohen `TypeError` ohne Kontext.
- **Ein fehlendes oder beschädigtes WAV** meldet `pipeline_failed` statt einer eigenen Fehlerart.
- **Die Tonhöhenmittelung behandelt MIDI 0 wie stimmlos** und verschmilzt damit zwei Zustände.
