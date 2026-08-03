# Design: Erstellen-UI (Teilprojekt 5)

**Datum:** 2026-08-03
**Status:** Entwurf genehmigt

Teilprojekt 5 von 6 des Song-Erstellungs-Vorhabens
([Master-Spec](2026-07-26-song-creation-pipeline-core-design.md)). Vorbilder im
Bestand: `src/desktop/renderer/views/SearchView.tsx` (Formular, Trefferliste,
Statusabhängigkeit), `src/desktop/renderer/views/SettingsView.tsx` (die
Umgebungs-Installation aus TP2), `src/desktop/main/ipc.ts` (der eine
Kanal-Vertrag), `src/core/storage/queue.ts` (persistierte Queue).

**Das Loch, das dieses Teilprojekt schließt:** TP1 bis TP4 haben einen
vollständigen Weg von einer Tonspur zum spielbaren Ordner gebaut — Pipeline,
Umgebung, Worker-Queue, Paketbau. Nur kann ihn niemand betreten. Die Kanäle
`create:queueAdd`, `create:start` und `event:creations` existieren seit TP3,
aber im Renderer ruft sie keine einzige Zeile auf: kein Sidebar-Punkt, keine
Ansicht, kein Formular. TP5 baut die Bedienung.

Drei lose Enden liegen dabei ohnehin auf dem Weg und werden mitgenommen:

- `CreateJobRequest.lyricsPath` erwartet eine **Datei**; eine UI hat Text.
- `normalizeLyrics` meldet `offeneFragen`, aber niemand kann sie beantworten —
  die Master-Spec weist genau das der UI zu.
- `src/core/create/lrclib.ts` ist fertig und getestet, aber **kein Aufrufer
  existiert**. Damit läuft das Alignment seit TP1 ohne seine zweite
  Evidenzquelle.

## Entschieden im Brainstorming (2026-08-03)

- **Nur die Desktop-UI.** Das Sidecar-Design notierte „die TUI folgt erst mit
  Teilprojekt 5"; diese Erwartung wird bewusst gestrichen. Ein zweiter
  Bedienweg für einen Ablauf mit Rückfragen, Bildwahl und Zehn-Minuten-Läufen
  wäre eine zweite Wahrheit über die Bedienung, kein Gewinn.
- **Ein Assistent in fünf Schritten**, kein Formular und keine Werkbank. Die
  Master-Spec legt als Zielgruppe ausdrücklich *alle* App-Nutzer fest. Der
  Ablauf hat drei Stellen, an denen die UI verhandeln muss statt einzusammeln
  (LRCLIB-Treffer, offene Textfragen, Bildwahl); im Assistenten ist jede davon
  einfach der jeweilige Schritt, im Formular wären es drei Dialoge obendrauf.
- **Die YouTube-Suche steckt im Assistenten.** `searchYoutubeVideos()` liefert
  fünf Treffer mit Titel, Kanal, Dauer und Thumbnails, ohne etwas
  herunterzuladen. Der Nutzer muss die App nicht verlassen — und die Spieldauer
  kommt gratis mit, die LRCLIB braucht.
- **LRCLIB fragt von selbst**, sobald Interpret, Titel und Dauer stehen. Ein
  Knopf „bei LRCLIB nachsehen" würde von den meisten nie gefunden. Kein Treffer
  ist nie ein Fehler, nur ein leeres Feld.
- **Die Bildwahl ist ein eigener Schritt**, nicht in „Prüfen" eingeklemmt: bei
  drei Kandidaten entscheidet die Größe der Vorschau, und eine Wahl gehört
  nicht in einen Schritt, dessen Aufgabe Kontrolle ist.
- **Die Bildwahl fällt vor dem Lauf, nicht danach.** Nachträgliches Tauschen
  hieße, in einen fertigen Bibliotheks-Ordner zu schreiben — genau den fasst
  der Paketbau bewusst nie wieder an, weil dort ab TP6 Handarbeit steckt.
- **Die Erstellungen erscheinen in der bestehenden `QueueView`**, als zweiter
  Abschnitt unter den Downloads. Ein Ort für „was arbeitet die App gerade".
- **Die Erstellen-Queue wird persistiert**, aber nur ihre wartenden Jobs.
- **Der Liedtext reist als Text im Job**, nicht als Pfad. Sonst müsste die
  Persistenz Dateien mitverwalten, die niemandem gehören.

## Der Assistent

Eigener Sidebar-Punkt „Erstellen" mit `Wand2` als Symbol (`Mic` ist an die
Marke vergeben), fünf Schritte, Schrittleiste oben.

**Die Job-`id` entsteht mit dem Entwurf**, nicht erst beim Absenden
(`crypto.randomUUID()` in Schritt 1). Schritt 4 braucht sie als Schlüssel für
den Cover-Cache, und ein Entwurf, dessen Bild schon abgelegt ist, muss beim
Absenden derselbe Job bleiben.

| Schritt | Der Nutzer gibt | Die App holt automatisch |
|---|---|---|
| 1 Song | Interpret, Titel, Sprache; optional Genre, Jahr, BPM | — |
| 2 Quelle | wählt einen von fünf Treffern, fügt einen Link ein oder wählt eine Datei | `searchYoutubeVideos` → Dauer, Kanal, Thumbnail |
| 3 Liedtext | prüft den Text, beantwortet offene Fragen | LRCLIB über Interpret/Titel/Dauer |
| 4 Bild | wählt Album-Cover, Thumbnail oder eigene Datei | `findCover` (Cover Art Archive) |
| 5 Prüfen | bestätigt | Abgleich gegen die Bibliothek |

### Schritt 2 — Quelle

Die Suchanfrage ist `"<Interpret> <Titel>"`. Angezeigt werden Thumbnail, Titel,
Kanal und Dauer; ein Treffer wird ausgewählt, nicht heruntergeladen — das tut
erst der Job. Daneben zwei Nebenwege: Link einfügen und lokale Audiodatei.

Bei beiden Nebenwegen fehlt die Dauer, die Schritt 3 braucht. Sie wird über
`create:sourceInfo` ermittelt: beim Link mit `yt-dlp --print duration`, bei der
lokalen Datei mit `ffmpeg -i` und Auswertung der Ausgabe. **Kein ffprobe** —
`binaries.ts` holt ausschließlich `ffmpeg.exe` aus dem Archiv, ffprobe wäre auf
einer verwalteten Installation nicht vorhanden.

Die lokale Datei wird hier auf Existenz und Lesbarkeit geprüft. Eine kaputte
Datei erst zehn Minuten später im Lauf zu bemerken, wäre die vermeidbare
Variante von `UnreadableFile`.

### Schritt 3 — Liedtext

`src/core/create/lyrics.ts` ist rein (keine Node-Importe), also importiert der
Renderer `normalizeLyrics` direkt. Kein IPC-Umweg, und vor allem keine zweite
Wahrheit über die Textaufbereitung: die CLI prüft mit derselben Funktion.

1. `create:lyricsSearch` liefert den LRCLIB-Text oder `null`.
2. Der Text füllt das Feld. `normalizeLyrics` läuft bei jeder Änderung; die
   LRC-Zeitstempel entfernt es ohnehin.
3. `entfernt` wird als stille Liste gezeigt („diese Zeilen fliegen raus:
   `[Intro]`, `[Chorus]`") — der Nutzer soll sehen, dass gekürzt wurde.
4. Jede `offeneFrage` wird ein Kärtchen mit zwei Knöpfen:
   - `repeat_scope` — „Zeile endet auf `(2x)`. Nur diese Zeile doppeln oder den
     ganzen Block?", mit dem betroffenen Block im Kärtchen.
   - `chorus_reference` — „Hier steht nur `[Chorus]`. Diesen Refrain
     einsetzen?", mit den Zeilen der Vorlage.
5. `resolveLyrics(raw, antworten)` erzeugt die endgültigen Zeilen.

**Solange eine Frage offen ist, ist „Weiter" gesperrt**, mit Begründung am
Knopf. Das ist die Lücke, die die Master-Spec der UI zuweist: „Beantwortet
werden sie später in der UI (Teilprojekt 5)."

Der LRCLIB-Text ist zugleich die zweite Evidenzquelle: er reist als
`syncedLyricsText` im Job mit, `creations.ts` schreibt ihn in den `jobDir` und
gibt dem Worker den Pfad. Fügt der Nutzer eigenen Text ein, entfällt das —
`syncedLyricsPath` ist im Worker-Vertrag optional.

### Schritt 4 — Bild

Drei Kandidaten in großer Vorschau: Album-Cover (Cover Art Archive),
YouTube-Thumbnail, eigene Datei. Vorbelegt ist das Album-Cover, wenn es eins
gibt — die Begründung steht in `packageSong.ts:117`: ein echtes Cover ist
quadratisch und unbeschriftet, ein Video-Thumbnail ist beides nicht. Gibt es
keins, ist das Thumbnail vorbelegt. Auch „kein Bild" ist erlaubt.

### Schritt 5 — Prüfen

Zusammenfassung: Interpret, Titel, Sprache, Dauer, Zahl der Textzeilen, Quelle,
ob synchronisierte Lyrics vorliegen, der Zielordner aus `songRelativePath`, das
gewählte Bild. Dazu die Duplikat-Warnung: existiert „Interpret – Titel"
normalisiert schon in der `downloaded`-Liste, die der Renderer sowieso hält,
sagt der Assistent das — als Warnung, nicht als Verbot. `freierZielpfad` legt
absichtlich „Titel (2)" daneben, und der Nutzer darf genau das wollen.

„Zur Queue" ruft `createQueueAdd([job])`. Der Assistent springt auf Schritt 1
zurück, damit ein Stapel zügig entsteht.

### Umgebungs-Gate

`CreateView` fragt beim Mounten `environmentStatus()` und hört auf
`event:environmentStatus`. Bei `missing`, `broken` oder `outdated` steht oben
ein Banner: was fehlt, plus ein Knopf, der `environmentInstall()` direkt
anwirft (dieselbe Funktion, die `SettingsView.tsx:120` nutzt).

Der Assistent bleibt dabei voll bedienbar und Jobs dürfen in die Queue — nur
der Start scheitert, und zwar mit der Meldung, die `creations.ts:133` bereits
sendet. Grund: die Modelle zu ziehen dauert Minuten, und wer währenddessen drei
Songs vorbereiten will, soll das können.

## Bausteine

### Neu im Renderer

| Datei | Aufgabe |
|---|---|
| `views/CreateView.tsx` | Hülle: Schrittleiste, Umgebungs-Banner, Navigation |
| `views/createDraft.ts` | **DOM-frei:** Entwurf, Validierung, welcher Schritt erlaubt ist |
| `components/create/StepSong.tsx` | Schritt 1 |
| `components/create/StepSource.tsx` | Schritt 2 |
| `components/create/StepLyrics.tsx` | Schritt 3 |
| `components/create/StepCover.tsx` | Schritt 4 |
| `components/create/StepReview.tsx` | Schritt 5 |

Ein Schritt pro Datei, und der Zustand in einem eigenen Modul: `SearchView.tsx`
liegt heute bei 17 KB und markiert die Grenze des Erträglichen. Die
Step-Komponenten bleiben dumm — sie zeigen an und melden Änderungen.

Der Entwurf lebt im Zustand von `App`, nicht in `CreateView`. Sonst wirft ein
Blick in die Queue fünf Schritte Arbeit weg, weil React die View abbaut.

### Neu im Core

| Datei | Aufgabe |
|---|---|
| `core/create/probe.ts` | `dauerSekunden(quelle)` über yt-dlp bzw. ffmpeg |
| `core/storage/createQueue.ts` | `loadCreateQueue` / `saveCreateQueue`, Vorbild `storage/queue.ts` |

`core/create/lyrics.ts` bekommt `resolveLyrics(raw, antworten) → string[]`. Das
Anwenden der Antworten (Block doppeln, Refrainzeilen einsetzen) gehört als
reine Funktion neben die Meldung der Fragen, nicht in eine React-Komponente.

### Geändert im Bestand

- **`core/create/lrclib.ts`** — der Netz-Teil wird zu
  `fetchSyncedLyrics({artist, title, durationSec, fetchFn?}) → Promise<string | null>`.
  Das Schreiben in ein Songverzeichnis fällt weg: zum Zeitpunkt der Abfrage
  existiert es noch nicht, und kein Aufrufer hat es je benutzt.
  `cachedLyricsPfad` verschwindet mit ihm.
- **`core/create/packageSong.ts`** — `PackageOptions` bekommt
  `coverWahl?: { pfad: string } | "keins"`. Ist es gesetzt, entfällt der
  `findCover`-Aufruf und das gewählte Bild wird zu `cover.jpg`. Ist es nicht
  gesetzt, bleibt alles wie heute — der Baustein bleibt kopflos benutzbar.
- **`desktop/main/creations.ts`** — schreibt `lyricsText` und
  `syncedLyricsText` beim Jobstart in den `jobDir`; lädt und speichert die
  Queue über `storage/createQueue.ts`; trägt `songDir`, `dirName` und
  `lowConfidence` in den `CreationEntry` ein; räumt den Cover-Cache auf.
- **`desktop/renderer/views/QueueView.tsx`** — zweiter Abschnitt
  „Erstellungen".
- **`components/Sidebar.tsx`** — Punkt „Erstellen"; der Zähler addiert
  wartende Jobs beider Arten.

## Verträge

### Geändert

```
CreateJobRequest = {
  id, quelle, language, artist, title,
  lyricsText: string,          // war lyricsPath
  syncedLyricsText?: string,   // war syncedLyricsPath
  coverWahl?: { pfad: string } | "keins",  // neu: Ergebnis von Schritt 4
  genre?, year?, bpm?,
}

CreationEntry = {
  id, artist?, title?, status, stage?, progress?, error?,
  songDir?: string,        // neu: fertiger Ordner, fuer "Ordner oeffnen"
  dirName?: string,        // neu: der tatsaechliche Name (kann "(2)" tragen)
  lowConfidence?: boolean, // neu: aus song_data.json meta
}
```

### Neue Kanäle

```
"create:youtubeSearch"   (query: string) -> YoutubeVideo[]
"create:sourceInfo"      (quelle: MediaQuelle) -> { durationSec: number } | null
"create:lyricsSearch"    ({ artist, title, durationSec }) -> string | null
"create:coverCandidates" ({ jobId, artist, title, thumbnailUrl? })
    -> Array<{ kind: "caa" | "thumbnail", pfad: string, dataUrl: string }>
"create:chooseFile"      (art: "audio" | "bild") -> string | null
```

`ipcContract.test.ts` erzwingt, dass jeder Kanal einen Handler hat — die
Erweiterung ist damit tsc-geprüft.

**Cover-Kandidaten liegen als Dateien vor, nicht als Bytes auf der Leitung.**
`create:coverCandidates` legt sie unter `<userData>/create-cover/<jobId>/` ab
und liefert Pfad plus Data-URL für die Vorschau; der Job trägt nur `coverWahl`.
So übersteht eine gewählte Grafik den Neustart, ohne dass Base64 in der
persistierten Queue landet.

`coverWahl` hat dieselbe Form wie das neue Feld in `PackageOptions` und wird
unverändert durchgereicht. **Fehlt es, heißt das „entscheide selbst"**, nicht
„kein Bild": dann greift der `findCover`-Weg von heute. Der Assistent setzt es
immer explizit — die Lücke ist für den kopflosen Gebrauch und für Jobs da, die
aus einer älteren `create-queue.json` geladen werden. Aufgeräumt wird an drei Stellen: nach Abschluss des
Jobs, beim Entfernen aus der Queue, und beim App-Start für alle Ordner, deren
`jobId` in der geladenen Queue nicht vorkommt.

Eine eigene Bilddatei wird **nicht** kopiert; ihr Originalpfad geht in den Job.
Ist sie beim Lauf verschwunden, gilt die Warnung „Paket ohne Bild", die
`packageSong.ts:123` schon kennt.

## Datenfluss

```
Schritt 1..5 -> CreateJobRequest -> create:queueAdd -> create-queue.json
                                                    |
                                        creations.ts (TP3/TP4)
                 lyricsText -> jobDir/lyrics.txt ---|
           syncedLyricsText -> jobDir/synced.lrc ---|
                                                    v
                       acquireMedia -> submitJob -> assemblePackage
                                                    |
                          event:creations (Stufe, Fortschritt, songDir)
                                                    v
                                 QueueView, Abschnitt "Erstellungen"
```

## Queue-Sicht und Abschluss

Eine Zeile je `CreationEntry`: Statuspunkt, Interpret – Titel, deutsche
Stufenbezeichnung, Fortschrittsbalken, Abbrechen (laufend) bzw. Entfernen
(wartend).

Die Stufenbezeichnung ist eine Übersetzungstabelle im Renderer, weil `stage`
aus zwei Quellen kommt: `creations.ts` setzt selbst schon deutsch
(`beschaffen`, `paket`), der Sidecar meldet englisch. Die Namen sind in
`python-sidecar/ultrastar_pipeline/` nachgesehen, nicht geraten:
`separate → trennen`, `transcribe → erkennen`, `align → ausrichten`,
`pitch → Tonhöhe`, `tempo → Tempo`, `notes → Noten`, und `preload:*` →
„Modelle laden". Eine unbekannte Stufe wird unverändert gezeigt — ein neuer
Pipeline-Schritt im Sidecar darf die Anzeige nicht leer lassen.

Eine fertige Zeile klappt auf und zeigt:

- die Cover-Vorschau über `covers:getLocal(songDir)` (existiert),
- „Ordner öffnen" über `shell:openFolder` (existiert),
- bei `lowConfidence` den ehrlichen Satz, dass der Sync wackelt und der Editor
  aus TP6 ihn geradezieht.

Ohne diesen Abschluss endet ein Zehn-Minuten-Lauf mit einem stillen Häkchen.

## Persistenz

`create-queue.json` neben `queue.json` im Datenverzeichnis, geschrieben bei
jeder Änderung der Queue.

**Nur wartende Jobs.** Beim Laden wird ein „running" zu „queued": die App ist
mitten im Lauf gestorben, also ist der Job nicht halb fertig, sondern nicht
gelaufen. Fertige, gescheiterte und abgebrochene Einträge sind Historie und
sterben mit dem Prozess — der fertige Song steht in der Bibliothek, das ist der
bessere Beleg.

**Nach dem Laden wird nicht gestartet.** Ein Programmstart, der ungefragt die
GPU belegt und Lüfter aufdreht, ist ein Übergriff. Der Nutzer drückt Start.

## Fehlerfälle

Keiner bricht den Assistenten ab; jeder erklärt sich in einem Satz.

| Fall | Verhalten |
|---|---|
| LRCLIB kein Treffer, Netz weg | leeres Textfeld, ein Satz Erklärung |
| yt-dlp fehlt | keine Suche, Hinweis plus Link-Feld; `StatusDots` zeigt das Fehlen bereits |
| Dauer-Probe scheitert | Schritt 3 ohne Vorschlag, Rest unberührt |
| `findCover` leer | nur Thumbnail und eigene Datei zur Wahl |
| lokale Datei unlesbar | Vorabprüfung in Schritt 2; verschwindet sie später, greift `UnreadableFile` im Lauf |
| Text leer oder Frage offen | „Weiter" gesperrt, mit Begründung am Knopf |
| Umgebung fehlt oder veraltet | Banner mit Installations-Knopf; Queue füllbar, Start abgelehnt |
| Refrain-Verweis als erste Zeile | `refrainZeilen` ist leer, also gibt es nichts einzusetzen: das Kärtchen bietet nur „Zeile verwerfen", und `resolveLyrics` lehnt ein „einsetzen" auf leerer Vorlage ab statt eine Leerzeile zu erzeugen |

## Tests

Es gibt im Projekt **keine** Renderer-Unit-Tests: kein `*.test.tsx`, keine
Testing-Library, kein happy-dom, nur ein Playwright-Smoke-Test in
`e2e/app.spec.ts`. Diese Lage wird nicht umgeworfen — stattdessen wandert das
Prüfbare in DOM-freie Module.

- `lyrics.test.ts` → `resolveLyrics`: `(2x)` nur die Zeile, `(2x)` ganzer
  Block, Refrain-Verweis einsetzen, Refrain-Verweis als erste Zeile (Absage),
  mehrere Fragen in einem Text.
- `probe.test.ts`: echte yt-dlp- und ffmpeg-Ausgaben als Fixtures, kein
  Prozessstart im Test.
- `createQueue.test.ts`: Roundtrip, kaputtes JSON → leere Queue (wie
  `queue.test.ts`).
- `lrclib.test.ts`: `fetchSyncedLyrics` mit injiziertem `fetchFn`, nie gegen
  das echte Netz — die bestehenden Fälle werden umgeschrieben, nicht ergänzt.
- `createDraft.test.ts`: welcher Schritt bei welchem Entwurf erlaubt ist, und
  dass der Entwurf einen gültigen `CreateJobRequest` erzeugt.
- `creations.test.ts` (Erweiterung): Laden setzt „running" auf „queued";
  `lyricsText` landet im `jobDir`; Cover-Cache wird bei Abschluss und für
  Waisen gelöscht.
- `packageSong.test.ts` (Erweiterung): `coverWahl` gesetzt → `findCover` wird
  nicht gerufen; `"keins"` → kein `#COVER` im `song.txt`.
- `e2e/app.spec.ts` (Erweiterung): Sidebar → Erstellen → Schritt 1 füllen →
  Schritt 2 erscheint. Ohne Netz, ohne GPU.

## Offene Risiken

- **Die YouTube-Suche liefert oft Live-Versionen und Remixe.** Dauer und Kanal
  in der Trefferliste sind die einzige Hilfe, die die UI dagegen hat. Wählt der
  Nutzer falsch, passt der Text nicht zur Aufnahme und das Alignment wird
  schlecht — sichtbar erst nach dem Lauf, über `lowConfidence`.
- **Die LRCLIB-Abfrage hängt an der Dauer der gewählten Quelle.** Weicht das
  Video um mehr als zwei Sekunden von der Albumfassung ab, gibt es keinen
  Treffer, obwohl der Text existiert. Bewusst kein Fuzzy-Fallback: die
  Begründung in `lrclib.ts:3` gilt weiter — ein falsches `.lrc` setzt falsche
  Pfosten.
- **`ffmpeg -i` als Dauer-Quelle ist Textauswertung**, kein API. Ändert ffmpeg
  sein Ausgabeformat, fällt Schritt 3 auf „kein Vorschlag" zurück. Deshalb
  liefert `probe.ts` bei Zweifeln `null` statt einer geratenen Zahl.
- **Der Cover-Cache lebt außerhalb des `jobDir`**, weil er vor dem Job
  entsteht. Waisen sind damit möglich; das Aufräumen beim App-Start ist die
  Gegenmaßnahme, keine Garantie.

## Bewusst nicht enthalten

- **Korrektur-Editor** — Teilprojekt 6.
- **Jeder TUI-Erstellen-Pfad** — entschieden, siehe oben.
- **Duette (`P1`/`P2`)** — wie in der Master-Spec später.
- **Hintergrundbilder, fanart.tv** — im Paketbau begründet abgelehnt.
- **Genre- und Jahr-Anreicherung im Erstellungspfad.** Beides sind Felder im
  Assistenten; `enrichGenres.ts` bleibt die eine Wahrheit fürs Anreichern.
- **Bearbeiten eines wartenden Jobs.** Entfernen und neu anlegen genügt; ein
  Editor für Queue-Einträge wäre ein zweiter Assistent.
- **Historie fertiger Erstellungen über den Prozess hinaus** — die Bibliothek
  ist die Historie.
