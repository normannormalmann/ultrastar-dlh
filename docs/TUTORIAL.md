🇩🇪 Deutsch | 🇬🇧 [English](TUTORIAL.en.md) | 🇪🇸 [Español](TUTORIAL.es.md)

# Tutorial: UltraStar - Dirty Little Helper

Dieses Tutorial führt dich von der Installation bis zur fertig gepflegten Karaoke-Bibliothek — Schritt für Schritt. Du brauchst keine Vorkenntnisse.

**Inhalt**
1. [Installation & erster Start](#1-installation--erster-start)
2. [Grundeinstellungen](#2-grundeinstellungen)
3. [Bestehende Sammlung importieren](#3-bestehende-sammlung-importieren)
4. [Songs suchen und herunterladen](#4-songs-suchen-und-herunterladen)
5. [Massen-Downloads mit der Queue](#5-massen-downloads-mit-der-queue)
6. [Die Bibliothek: filtern, sortieren, finden](#6-die-bibliothek-filtern-sortieren-finden)
7. [Genres automatisch nachtragen](#7-genres-automatisch-nachtragen)
8. [Videos reparieren](#8-videos-reparieren)
9. [Problemlösung](#9-problemlösung)

---

## 1. Installation & erster Start

1. Lade die neueste `UltraStar-DLH-Setup-*.exe` von den [Releases](https://github.com/normannormalmann/ultrastar-dlh/releases) herunter.
2. Führe die Datei aus. Windows SmartScreen zeigt eine Warnung (die App ist nicht signiert): klicke **„Weitere Informationen" → „Trotzdem ausführen"**. Die Installation läuft ohne weitere Fragen durch und startet die App.
3. Beim ersten Start passiert automatisch:
   - Die App legt ein anonymes **USDB-Konto** an und meldet sich an (Status-Punkt „USDB" unten links wird grün).
   - Fehlen **yt-dlp** oder **ffmpeg**, lädt die App beide selbst herunter (Status-Punkte werden nach kurzer Zeit grün). Du musst nichts tun.

Die drei Status-Punkte unten links in der Seitenleiste zeigen jederzeit: USDB-Anmeldung, yt-dlp, ffmpeg. Alles grün = startklar.

> **Updates:** Ab Version 1.4.0 meldet sich die App selbst, wenn eine neue Version vorliegt: **Einstellungen → App → „Auf Updates prüfen"**, herunterladen, neu starten. Weil der Installer nicht signiert ist, fragt SmartScreen auch beim Update noch einmal. Von Hand geht es weiterhin: Eine neue Version installierst du einfach über die alte — Einstellungen, Bibliothek und Queue bleiben erhalten.

## 2. Grundeinstellungen

Öffne **Einstellungen** (Zahnrad in der Seitenleiste):

- **Download-Ordner:** Der Ordner, in dem deine Songs liegen (sollen) — z.B. `D:\Ultrastar`. Über „Durchsuchen…" wählbar. *Das ist derselbe Ordner, den du in UltraStar Deluxe als SongDir einträgst.*
- **Browser für YouTube-Cookies:** Wähle den Browser, in dem du bei YouTube **angemeldet** bist (z.B. Edge oder Chrome). YouTube blockiert anonyme Downloads häufig; mit deinen Browser-Cookies umgeht die App das. Wichtig beim Herunterladen: Browser schließen, sonst ist seine Cookie-Datenbank gesperrt.
- **Downloads:**
  - *Ordnerstruktur neuer Downloads* — wie neue Songs abgelegt werden:
    - `Artist - Titel` (flach): alles in einer Ebene — Standard.
    - `Artist / Artist - Titel`: ein Unterordner je Interpret.
    - `A / Artist - Titel`: Unterordner nach Anfangsbuchstabe.
    Die Beispielzeile darunter zeigt den Pfad live. UltraStar Deluxe kommt mit allen Varianten (auch gemischt) klar; bereits vorhandene Songs werden nicht verschoben.
  - *Parallele Downloads* (1–5): Wie viele Songs gleichzeitig laden. 2–3 ist ein guter Standard.
  - *Video-Qualität*: max. 720p spart Platz, max. 1080p ist Standard, „Beste verfügbare" nimmt was YouTube hergibt.
- **Genre-Quelle:** siehe [Kapitel 7](#7-genres-automatisch-nachtragen).
- **Sprache:** Deutsch, Englisch oder Spanisch. Ohne eigene Wahl folgt die App der Sprache deines Systems.

**Speichern** nicht vergessen (Häkchen bestätigt).

## 3. Bestehende Sammlung importieren

Du hast schon Songs auf der Platte? Dann zuerst importieren — sonst kennt die App deinen Bestand nicht und würde Songs doppelt herunterladen.

1. Stelle sicher, dass der **Download-Ordner** (Kapitel 2) auf deine Sammlung zeigt.
2. Öffne **Heruntergeladen** in der Seitenleiste → klicke **„Archiv importieren"**.
3. Die App scannt alle Song-Ordner (auch eine Ebene verschachtelt, z.B. `ABBA\ABBA - Waterloo\`) und übernimmt jeden Ordner mit einer `song.txt` — **ohne irgendetwas herunterzuladen**. Bei großen Sammlungen (10.000+) dauert das einige Minuten; ein Fortschrittsbalken zeigt den Stand.
4. Ergebnis-Meldung lesen: „N Songs importiert (davon X ohne Video — Reparatur ausführen) · M bereits vorhanden". Songs **ohne Video** erscheinen erst nach einer [Reparatur](#8-videos-reparieren) in der Liste, sind aber bereits gegen Doppel-Downloads geschützt.

**Gut zu wissen:**
- Der Import liest Sprache, Genre, Jahr & Co. direkt aus den song.txt-Dateien — deine Filter funktionieren sofort.
- Ein **erneuter** Klick auf „Archiv importieren" schadet nie: Er findet neue Ordner und ergänzt fehlende Metadaten bei bereits importierten Einträgen.
- Hast du Ordner außerhalb der App gelöscht oder geändert: **„Aktualisieren"** klicken — die App prüft den Bestand neu.

## 4. Songs suchen und herunterladen

1. Öffne **Suche** (Lupe). Gib Interpret und/oder Titel ein, `Enter` oder „Suchen".
2. Die Tabelle zeigt Cover, Interpret, Titel, Sprachen, Bewertung (★) und Views. Bereits vorhandene Songs tragen ein grünes **✓** — bei ihnen gibt es nichts zu tun.
3. **Filter** aufklappen (Schieberegler-Symbol) für mehr Kontrolle:
   - **Sprache, Genre, Jahr** — filtern serverseitig über die *gesamte* Datenbank, nicht nur die aktuelle Seite.
   - **Sortierung** + Richtung (z.B. „Bewertung absteigend" für die beliebtesten zuerst).
   - **Nur Golden Notes / Nur Songcheck** — Qualitätsmerkmale der Datenbank.
   - **Bestand:** „Nur fehlende" blendet aus, was du schon hast — perfekt zum Stöbern nach Neuem.
   - Filteränderungen suchen automatisch neu (kleiner Zähler am Filter-Knopf zeigt aktive Filter).
4. **Herunterladen:** Der ⬇-Knopf an der Zeile lädt den Song sofort. Unten erscheint die Download-Leiste mit Fortschritt. Ein kompletter Song (Text + Cover + Video) dauert je nach Video meist unter einer Minute.

Der fertige Song liegt danach als Ordner in deinem Download-Ordner — mit `song.txt`, `cover.jpg` und `video.mp4` — und ist sofort in UltraStar Deluxe singbar (dort ggf. „Songs neu einlesen").

## 5. Massen-Downloads mit der Queue

Für alles, was mehr als ein paar Songs sind:

1. In der Suche sammeln:
   - **„＋ Queue"** an der Zeile: einzelner Song.
   - **„＋ Seite in Queue"**: alle (sichtbaren) Treffer der aktuellen Seite.
   - **„＋ Alle N Seiten"**: *jede* Seite der aktuellen Suche — z.B. „Sprache: German, Genre: Schlager" komplett. Respektiert alle aktiven Filter.
   - **„Ganze Datenbank in Queue"**: wirklich alles (zehntausende Songs — Bestätigungsdialog).
   Bereits vorhandene oder schon eingereihte Songs werden automatisch übersprungen; der Zähler an „Queue" in der Seitenleiste wächst entsprechend.
2. Öffne **Queue** → **„▶ N Songs herunterladen"**. Die App arbeitet die Liste mit der eingestellten Parallelität ab.
3. Du kannst jederzeit **abbrechen** (nach dem laufenden Schwung) — die Queue bleibt gespeichert, auch über App-Neustarts und Abstürze hinweg. „▶" macht später einfach weiter.
4. **Fehlgeschlagene Downloads** landen im aufklappbaren Bereich darunter (häufigste Ursache: YouTube-Bot-Schutz → siehe [Problemlösung](#9-problemlösung)). „↻ Erneut" legt sie wieder in die Queue; zusätzlich liegt im Songs-Ordner eine `failed-downloads.xlsx` mit allen Details.

## 6. Die Bibliothek: filtern, sortieren, finden

**Heruntergeladen** ist deine Bestandsansicht:

- **Textfilter** sucht in Interpret und Titel.
- **Sprache/Genre-Dropdowns** zeigen nur Werte, die zur restlichen Auswahl passen — inklusive Trefferzahlen. Songs mit mehreren Sprachen („Japanese, German") erscheinen unter beiden.
- **Jahr von/bis** grenzt Zeiträume ein („nur 80er": 1980–1989).
- **Sortierung:** Neueste zuerst, Interpret A–Z, Titel A–Z, Jahr aufsteigend.
- Die Liste lädt beim Scrollen automatisch nach („X von Y angezeigt").
- **„Ordner"** an jeder Zeile öffnet den Song im Explorer.
- **„Aktualisieren"** gleicht die Liste mit dem tatsächlichen Plattenbestand ab (z.B. nach manuellem Löschen).

## 7. Genres automatisch nachtragen

Viele USDB-Songs kommen ohne Genre — entsprechend leer bleiben deine Filter. Die App kann fehlende Genres (und Jahre) aus Online-Musikdatenbanken nachtragen:

1. **Einstellungen → Genre-Quelle** wählen:
   - **Deezer** (empfohlen): ohne Anmeldung, gute Trefferquote, ~1–2 Stunden für 10.000 Songs.
   - **Last.fm**: beste Genre-Vielfalt, braucht einen kostenlosen [API-Key](https://www.last.fm/api/account/create) (Feld erscheint bei Auswahl).
   - **MusicBrainz**: offene Datenbank, findet teils andere Songs — aber limitiert auf 1 Anfrage/Sekunde (entsprechend langsam).
2. **Heruntergeladen → „Genres nachtragen"**. Fortschritt: „Suche Genres… (x/y · z gefunden)".
3. Du kannst **jederzeit abbrechen** — der Stand ist gespeichert, der nächste Lauf überspringt bereits angereicherte Songs. Downloads parallel zum Lauf sind kein Problem.
4. Gefundene Genres werden normalisiert (einheitlich „Hip-Hop" statt „rap/hip hop" etc.), in die Bibliothek **und** als `#GENRE:` in die jeweilige song.txt geschrieben — sie sind also auch in UltraStar Deluxe sichtbar.

**Tipp für maximale Abdeckung:** Erst ein Deezer-Volllauf, danach die Quelle auf MusicBrainz stellen und erneut laufen lassen — der zweite Lauf probiert nur die übrig gebliebenen Songs und findet oft weitere. Was dann noch fehlt, existiert in den Datenbanken meist schlicht nicht (Remixe, Nischen-Titel) — das kannst du bei Bedarf von Hand in der song.txt ergänzen.

## 8. Videos reparieren

Wenn Videos fehlen oder defekt sind (abgebrochene Downloads, gelöschte Dateien, importierte Bestände ohne Video):

1. **Reparatur** in der Seitenleiste → **„Scan starten"**.
2. Die App durchsucht den Download-Ordner nach Songs mit fehlendem oder verdächtig kleinem `video.mp4` und lädt **nur die Videos** neu — Texte und Cover bleiben unberührt. Songs ohne Tracking-Eintrag werden dabei rekonstruiert.
3. Der Abschlussbericht zeigt repariert / rekonstruiert / nicht reparierbar. Frisch reparierte Songs erscheinen danach in der Bibliothek.

Auch hier gilt: Steht in den USDB-Kommentaren eine VIDEOGAP-Korrektur zum Video, übernimmt die App sie automatisch in die song.txt.

## 9. Problemlösung

**„YouTube bot protection blocked the download" / viele Fehlschläge hintereinander**
YouTube blockiert anonyme Downloads. Lösung: In den Einstellungen den Browser wählen, in dem du bei YouTube **eingeloggt** bist, den Browser **schließen**, dann erneut versuchen (Fehlgeschlagene per „↻ Erneut"). Hartnäckige Fälle: eine `cookies.txt` (Browser-Erweiterung „Get cookies.txt") in den Songs-Ordner legen.

**Status-Punkt yt-dlp/ffmpeg bleibt rot**
Einstellungen → Tools → „Fehlende Tools automatisch installieren". Schlägt auch das fehl (Firmen-Proxy o.ä.): [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) und [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) manuell installieren, in den PATH aufnehmen, App neu starten.

**Song heruntergeladen, aber Video läuft versetzt zum Text**
Song-Ordner löschen, in der Bibliothek „Aktualisieren", Song neu herunterladen — die App übernimmt inzwischen VIDEOGAP-Korrekturen aus den USDB-Kommentaren automatisch.

**Bibliothek zeigt gelöschte Songs noch an / neue Ordner fehlen**
„Aktualisieren" in der Bibliothek (gleicht mit der Platte ab) bzw. „Archiv importieren" (nimmt neue Ordner auf).

**Import meldet „X ohne Video"**
Normal bei Beständen mit fehlenden Videos. Diese Songs sind getrackt (kein Doppel-Download), erscheinen aber erst nach einer [Reparatur](#8-videos-reparieren) in der Liste.

**Die App fragt nach einem Last.fm-Key**
Nur die Quelle Last.fm braucht einen — kostenlos unter [last.fm/api/account/create](https://www.last.fm/api/account/create), oder einfach bei Deezer bleiben.

---

Fragen, Fehler, Wünsche? → [GitHub Issues](https://github.com/normannormalmann/ultrastar-dlh/issues)
