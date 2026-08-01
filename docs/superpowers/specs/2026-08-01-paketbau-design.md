# Design: Paketbau — Medien, Cover, Ordnerlayout (Teilprojekt 4)

Teilprojekt 4 von 6 des Song-Erstellungs-Vorhabens
([Master-Spec](2026-07-26-song-creation-pipeline-core-design.md)). Vorbilder im
Bestand: `src/core/download/downloadSong.ts` (paralleles Beschaffen, nie werfende
Optionalteile, `onWarning`), `src/core/download/naming.ts` (Ordnernamen und
Layouts), `src/core/create/writeSongTxt.ts` (die eine Wahrheit fürs
UltraStar-Format).

**Das Loch, das dieses Teilprojekt schließt:** Die Pipeline aus TP1 nimmt eine
Tonspur und liefert `song_data.json`. Der Nutzer hat aber weder eine Tonspur
parat noch nützt ihm eine JSON-Datei — er hat einen Song im Kopf und will einen
spielbaren Ordner. TP4 baut beide Enden an: vorne die Medienbeschaffung, hinten
den fertigen UltraStar-Ordner.

## Entschieden im Brainstorming (2026-08-01)

- **Zwei Eingänge, YouTube-Link ist der Normalfall.** Lokale Audiodatei bleibt
  möglich (eigene Aufnahmen, Studioqualität), ist aber der Nebenweg.
- **Bilder: was gratis anfällt, plus Cover Art Archive.** YouTube-Thumbnail
  bzw. eingebettetes ID3-Bild als Rückfall, echtes Album-Cover über
  MusicBrainz/Cover Art Archive. **Kein fanart.tv, keine Hintergrundbilder** —
  ein API-Schlüssel für eine Quelle, die bei Nischenmusik ohnehin leer ausgeht,
  ist den Preis nicht wert.
- **Mediendateien wie im Download-Pfad:** eine `video.mp4`, `#MP3` und `#VIDEO`
  zeigen beide darauf. Keine doppelte Tonspur auf der Platte. Beim Eingang
  "lokale Datei" gibt es entsprechend nur die Audiodatei und kein `#VIDEO`.
- **Kollision: danebenlegen mit Suffix** (`Interpret - Titel (2)`). Ein
  bestehender Ordner wird nie angefasst — er kann handkorrigierte Notenarbeit
  enthalten, genau das, was TP6 später produziert.
- **Zuschnitt: zwei Bausteine, die Queue verklammert sie.** Nicht eine
  Klammerfunktion, die den Worker selbst besitzt: dessen Lebenszyklus (warm
  halten, Idle-Shutdown, Abbruch, Crash-Bremse) gehört seit TP3 in
  `creations.ts` und bleibt dort.
- **Der Paketbau bleibt in TypeScript.** Die Master-Spec hält das
  UltraStar-Format an einer Stelle; ein Ordnerbau im Python-Sidecar würde
  `sanitizeForPath` und `renderSongTxt` dort nachbauen und eine zweite Wahrheit
  schaffen.

## Bausteine

Die Reihenfolge ist keine Wahl, sondern eine Zwangslage: die Beschaffung muss
**vor** die Pipeline (die braucht die Tonspur), der Ordnerbau **dahinter** (er
braucht `song_data.json`).

### `src/core/create/media.ts` — `acquireMedia`

```
acquireMedia({ quelle: {kind:"youtube", url} | {kind:"datei", pfad},
               jobDir, cookiesBrowser?, videoQuality?, signal?, onProgress? })
  → Effect<AcquiredMedia, MediaError>

AcquiredMedia = { audioPath, videoPath?, coverKandidat? }
```

Bei Link: `downloadYoutubeVideoWithProgress` holt `video.mp4`, ffmpeg extrahiert
die Tonspur nach `audio.m4a`, yt-dlp legt das Thumbnail daneben. Bei lokaler
Datei: die Originaldatei wird nicht angefasst, ihr Pfad wird durchgereicht und
ein eingebettetes ID3-Bild ausgelesen. Alles Erzeugte landet im `jobDir` — nie
in der Bibliothek.

**Die extrahierte Tonspur ist reines Zwischengut.** Sie füttert die Pipeline und
wird mit dem `jobDir` weggeräumt; ins Paket kommt sie nicht, denn dort zeigt
`#MP3` auf die `video.mp4`. Nur im Eingang "lokale Datei" gibt es kein Video —
dann wird die Originaldatei als `audio.<ext>` ins Paket kopiert und `#MP3` zeigt
darauf.

Die Tonspur wird bewusst extrahiert, statt dem Sidecar die `.mp4` zu reichen:
der Stufencache der Pipeline schlüsselt nach Audio-Hash, und eine stabile,
kleine Audiodatei ist der verlässlichere Schlüssel.

### `src/core/api/artwork/coverArtArchive.ts` — `findCover`

```
findCover(artist, title) → Effect<Uint8Array | null, never>
```

MusicBrainz-Recording-Suche → Release-MBID → Cover Art Archive. **Nie werfend:**
kein Treffer heißt `null`, dann greift der Thumbnail-Rückfall. Eigenes Modul
unter `api/artwork/`, weil `api/genres/musicbrainz.ts` eine andere Frage stellt
(Genres statt Bildern) und sein Vertrag nicht verbogen werden soll.

### `src/core/create/packageSong.ts` — `assemblePackage`

```
assemblePackage({ songData, medien, meta: {artist,title,genre?,year?,creator?},
                  libraryDir, layout, jobDir })
  → Effect<{ songDir, dirName, warnungen }, PackageError>
```

Baut den Ordner **im `jobDir` fertig** — `song.txt` über `renderSongTxt`,
dazu `video.mp4` (oder `audio.<ext>` im Datei-Eingang) und `cover.jpg`, sofern
eins gefunden wurde — und verschiebt ihn erst dann an den Zielort aus
`songRelativePath`. So liegt nie ein halbfertiger Ordner in der Bibliothek, auch
nicht nach einem Absturz mitten im Schreiben.

### Erweiterungen im Bestand

- `src/core/api/youtube/download.ts` bekommt eine Thumbnail-Option; heute kennt
  es weder `--write-thumbnail` noch Audio-Extraktion.
- `src/desktop/main/creations.ts` ruft die zwei Bausteine um `submitJob` herum.
- `CreateJobRequest` beschreibt künftig ein **Paket** (Quelle, Metadaten,
  Layout) statt nur ein `outPath`.

## Datenfluss

| Phase | Fortschritt | Ergebnis |
|---|---|---|
| `acquireMedia` | 0–25 % | `video.mp4`, Tonspur, Thumbnail im `jobDir` |
| `submitJob` (TP3) | 25–90 % | `song_data.json` vom warmen Worker |
| `assemblePackage` | 90–100 % | fertiger Ordner in der Bibliothek |

**Zwei getrennte Arbeitsverzeichnisse.** `creationWorkDir()` ist der
*Stufencache* des Sidecars: nach Audio-Hash geschlüsselt und absichtlich über
Jobs hinweg geteilt, damit ein zweiter Lauf desselben Songs Stufen überspringt.
Medien gehören da nicht hinein. Also `…/pipeline-cache/` für den Sidecar und
`…/jobs/<jobId>/` als Kratzverzeichnis je Job. Nach Erfolg wird das
Kratzverzeichnis gelöscht, nach einem Fehler bleibt es für die Diagnose liegen.

**Kollision.** Existiert der Zielordner, wird `Interpret - Titel (2)` gebaut,
bei Bedarf `(3)`. Die Folge wird hier benannt statt versteckt: der ✓-Marker und
die Dubletten-Erkennung matchen auf den Leaf-Namen, die Zweitfassung gilt also
nicht als derselbe Song. Der Originalordner bleibt unangetastet — das war der
Zweck der Entscheidung.

## Fehler

Typisiert wie in TP1 und TP3, mit nie werfenden Job-Wrappern nach dem Muster von
`downloads.ts`:

- `MediaError`: `DownloadFailed`, `AudioExtractionFailed`, `UnreadableFile`,
  `Cancelled`
- `PackageError`: `TargetNotWritable`, `MoveFailed`

**Optionales scheitert nie hart.** Kein Cover gefunden heißt: Warnung sammeln,
Paket ohne `#COVER` ausliefern. Das ist das `onWarning`-Muster aus
`downloadSong.ts`, wo das Cover schon heute optional ist und die Lyrics kritisch
sind.

**Abbruch** greift in der Beschaffung durch: der yt-dlp-Prozessbaum wird
getötet, wofür `processTree.ts` seit TP3 bereitliegt. `assemblePackage` ist kurz
und nicht abbrechbar — ein Abbruch dort spart nichts und verkompliziert das
atomare Verschieben.

## Tests

Kein Netz, keine GPU, kein echtes yt-dlp: die externen Werkzeuge laufen über
einen injizierten Runner beziehungsweise Fake-Skripte, wie `pipeline.test.ts`
und `worker.test.ts` es vormachen. Cover Art Archive gegen einen `fetch`-Fake.

`assemblePackage` läuft gegen ein Temp-Verzeichnis und belegt: Ordnername je
Layout, Header-Inhalt, Suffix bei Kollision, und — der eigentliche Punkt des
atomaren Verschiebens — dass bei einem simulierten Fehler **kein** Zielordner
zurückbleibt.

`naming.ts` und `renderSongTxt` sind bereits getestet. Das wird nicht gedoppelt.

## Risiken

- **Cover Art Archive trifft nicht immer.** Die Recording-Suche über
  Interpret/Titel ist unscharf; ein falsches Album-Cover ist ärgerlicher als
  gar keins. Gegenmittel: nur bei eindeutigem Treffer übernehmen, sonst das
  Thumbnail. Die Schwelle ist zu messen, nicht zu raten.
- **YouTube-Thumbnails sind 16:9 und oft mit Text zugekleistert.** Als Cover in
  einer Songliste sieht das mäßig aus. Das ist der bewusste Preis dafür, keine
  weitere Bildquelle anzubinden.
- **ffmpeg ist eine weitere verwaltete Abhängigkeit im Erstellungspfad.** Sie
  ist über `binaries.ts` schon da, aber der Erstellungspfad hängt damit an zwei
  externen Werkzeugen statt an einem.
- **Der Suffix-Weg kann Dubletten anhäufen**, wenn ein Nutzer denselben Song
  mehrfach erstellt. Aufräumen ist Sache der Oberfläche in TP5.

## Bewusst nicht enthalten

- **Hintergrundbilder und fanart.tv** — entschieden, siehe oben.
- **Duette** (`P1`/`P2`) — wie in der Master-Spec später.
- **Jede Oberfläche**, samt Bildauswahl von Hand und Aufräumen von Dubletten —
  Teilprojekt 5.
- **Korrektur-Editor** — Teilprojekt 6.
- **Automatische Genre-/Jahr-Anreicherung** — `#GENRE` und `#YEAR` werden
  durchgereicht, wenn die Oberfläche sie liefert. Die Bibliothek hat mit
  `enrichGenres.ts` bereits ein Anreicherungs-Feature; ein zweites im
  Erstellungspfad wäre eine zweite Wahrheit.
