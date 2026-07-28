# Alignment mit Ankern (Teilprojekt 1b)

Datum: 2026-07-28
Status: entworfen, freigegeben
Vorgänger: [Song-Creation-Pipeline Core](2026-07-26-song-creation-pipeline-core-design.md)

## Ausgangslage

Teilprojekt 1 ist vollständig umgesetzt und gemessen. Der erste echte Modellauf hat zwei Dinge gezeigt: Struktur und Melodie stimmen (Notenzahl-Differenz 0, Median-Pitch-Offset 0,0 Halbtöne nach Korrektur der Nullage), **das Timing ist unbrauchbar** — Median 333 ms, nur 5 % der Silben unter 50 ms.

Eine vorzeichenbehaftete Auswertung schließt die billigen Erklärungen aus:

- **Kein konstanter Versatz.** Median-Abzug hebt den Anteil unter 50 ms nur von 5 % auf 7 %.
- **Keine Drift.** Erster und letzter Onset passen zur Referenz (165,2 s gegen 165,3 s), beide Onset-Folgen sind monoton. Ein falscher BPM-Wert sähe anders aus.
- **Lokales Verrutschen.** Der Mittelwert je Zehntel des Songs lautet 232, 96, 118, −94, −236, −122, 1259, 1123, 2827, 391 ms. Das Vorzeichen kippt mehrfach; 88 der 229 Paare liegen über 500 ms, verteilt von Index 11 bis 219.

Ursache ist die gewählte Alignment-Form: **ein einziges Segment über die ganze Aufnahme, ohne Anker.** Der Aligner verteilt den bekannten Text über die volle Länge, verliert in instrumentalen und wiederholten Passagen die Spur und fängt sich später wieder. Der ursprüngliche Entwurf (ein Zeitfenster je Textzeile) war falsch, der Nachfolger ist zu grob. Die Lösung liegt dazwischen.

## Ziel und Abnahme

**80 % der Silben unter 50 ms**, gemessen über **30+ gemischte Referenzsongs** aus der lokalen Bibliothek, Ergebnis je Song einzeln ausgewiesen — nicht nur als Mittelwert.

Die Marke orientiert sich daran, was beim Singen als „sitzt" empfunden wird. Restfehler sollen Einzelfälle sein, die der Korrektur-Editor aus Teilprojekt 6 aufräumt, und nicht die Regel.

Nicht Teil der Abnahme: der Anteil exakt getroffener Tonhöhen (heute 46 %). Verbesserungswürdig, aber ein anderes Problem.

## Ansatz

Ein freier Transkriptionspass liefert eine **vom bisherigen Verfahren unabhängige Evidenzquelle**: gehörte Wörter mit echten Zeitstempeln. Der bekannte Liedtext wird gegen dieses Transkript gematcht; jedes Wortpaar, das zusammenfindet, ist ein Anker der Form „bekanntes Wort Nr. *n* klingt bei Sekunde *t*". An tragfähigen Ankern wird der Text in Abschnitte geschnitten, und jeder Abschnitt bekommt sein eigenes, eng begrenztes Zeitfenster fürs Forced Alignment.

Das Matching läuft über eine **längste gemeinsame Teilfolge**. Deren Monotonie ist nicht Nebeneigenschaft, sondern die tragende Eigenschaft des Entwurfs: sie verbietet strukturell, dass eine Refrainwiederholung mit einer früheren verwechselt wird — und genau danach sieht die Explosion im letzten Songdrittel aus. Verhörte Wörter sind unkritisch: sie fallen aus der Teilfolge heraus, die umliegenden Anker halten trotzdem.

### Verworfene Alternativen

- **Nur Sprachaktivität als Anker.** Gesangsspur segmentieren, Zeilen auf Abschnitte verteilen. Billig, kein zweites Modell — aber die Anker kennen den Text nicht, die Zuordnung Zeile-zu-Abschnitt bliebe geraten. Raten ist die heutige Fehlerursache; das Verfahren würde sie nur feiner gerastert wiederholen.
- **Global ausrichten, dann lokal reparieren.** Verdächtige Stellen erkennen und nachjustieren. Verlockend inkrementell, aber es fehlt die unabhängige Quelle dafür, *wo* der Text hingehört: repariert würde mit denselben Daten, die den Fehler erzeugt haben.

## Architektur

Eine neue Stufe, eine neue reine Einheit, eine geänderte Stufe. Leitregel: **alles, was ein Modell braucht, bleibt ein dünner Adapter ohne Entscheidungen; alles, was entscheidet, ist rein.**

### Neu: `transcribe.py` — Pipelinestufe

Freie Transkription der Gesangsspur über WhisperX-ASR. Eigene `STAGE_VERSION`, eigener Cache-Eintrag, geschlüsselt auf Identität und Version der Stimmtrennung plus ASR-Modell und Sprache. Diese stufenübergreifende Schlüsselung ist Pflicht, nicht Kür — ihr Fehlen war im Abschluss-Review von Teilprojekt 1 ein blockierender Defekt. Läuft nach `separate`, vor `align`. Liefert Wörter mit Zeitstempeln, sonst nichts.

### Neu: `anchors.py` — reine Einheit

Kein Audio, kein Modell, keine Nebenwirkung. Nimmt zwei Wortlisten — bekannter Liedtext und Transkript — und liefert Ankerpaare, Abschnittsgrenzen und ein Vertrauensmaß je Abschnitt.

- **Normalisierung** für den Vergleich: Kleinschreibung, Satzzeichen und Diakritika entfernt. Ausschließlich fürs Matching. Der Ausgabetext bleibt immer der Quelltext — der erste echte Lauf hat bestätigt, dass Forced Alignment den gelieferten Text byte-identisch zurückgibt, und diese Eigenschaft wird nicht aufgegeben.
- **Monotones Matching** über eine längste gemeinsame Teilfolge.
- **Abschnittsbildung**: nicht jeder Anker wird zur Grenze, sonst erstickt der Aligner an zu engen Fenstern. Grenzen entstehen an tragfähigen Ankern in einem Zielabstand, bevorzugt an Zeilengrenzen.

Datenformen:

```
Anchor       { bekannter_index: int, zeit: float }
Abschnitt    { von_index: int, bis_index: int,
               start_s: float, ende_s: float,
               vertrauen: float, beidseitig_verankert: bool }
```

### Geändert: `align.py`

Die Änderung ist kleiner, als sie klingt. `whisperx.align` nimmt bereits eine *Liste* von Segmenten; heute übergibt die Funktion genau eines, das die ganze Aufnahme umspannt. Künftig übergibt sie ein Segment je Abschnitt, jedes mit eigenem Zeitfenster und eigenem Textausschnitt. Ein Modellaufruf wie bisher, ein Modell-Ladevorgang wie bisher — nur nicht mehr blind über die volle Länge.

`zeilen_zuordnen` bleibt erhalten und arbeitet je Abschnitt statt global. Die Wortzählung über Leerzeichen ist gegen echte WhisperX-Ausgabe bestätigt (`deviation = 0`, alle 156 Tokens byte-identisch) und wird nicht angetastet.

### Unverändert

`separate.py`, `pitch.py`, `notes.py`, `cache.py`, `progress.py` sowie die gesamte TypeScript-Orchestrierung mit Ausnahme des Vertrags.

## Datenfluss

```
separate ──► vocals.wav                                      (Cache)
                │
                ├─► transcribe ──► Transkriptwörter + Zeiten  (Cache, neu)
                │                        │
Liedtext ───────┴────────────────────────┤
                                         ▼
                              anchors.finde_anker()      ← rein
                                         │  Ankerpaare
                                         ▼
                              anchors.baue_abschnitte()  ← rein
                                         │  Abschnitte + Vertrauen
                                         ▼
                              align ──► ein Segment je Abschnitt  (Cache)
                                         │
                              zeilen_zuordnen je Abschnitt
                                         ▼
                              notes ──► Noten + Zeilenumbrüche  (unverändert)
```

Zwei Festlegungen zu den Zeitfenstern:

- **Lückenlos.** Das Fenster eines Abschnitts endet dort, wo der nächste beginnt, mit kleiner Überlappung als Sicherheitssaum. Lieber doppelt abgedeckt als eine Lücke, in die ein Wort fällt.
- **Ränder verankert.** Der erste Abschnitt beginnt bei null, der letzte endet an der Spurlänge, damit Text vor dem ersten und nach dem letzten Anker nicht heimatlos wird.

## Vertrauensmaß und Fehlerbehandlung

Das Vertrauen eines Abschnitts ist der Anteil seiner bekannten Wörter, die im Transkript wiedergefunden wurden, zusammen mit der Angabe, ob er beidseitig von Ankern begrenzt ist. Ein einseitig begrenzter Abschnitt ist naturgemäß unsicherer.

**Der wichtigste Fall ist der schlechteste.** Findet sich kein einziger Anker, entsteht genau ein Abschnitt über die volle Spur mit Vertrauen null. Das ist bitweise das heutige Verhalten: der Ansatz kann nie schlechter werden als der gemessene Basiswert, sondern im Zweifel nur sichtbar darauf zurückfallen.

Weitere Fälle:

- **Anker zu spärlich in einer Region** — die Region wird ein langer Abschnitt mit niedrigem Vertrauen, wird aber ausgerichtet.
- **Sprache ohne ASR-Modell** — dieselbe Fehlerart wie beim fehlenden Alignment-Modell, aber mit der Stufe im Fehlerdetail, damit die Ursache unterscheidbar bleibt.

Nichts wird still verschluckt, nichts blockiert unnötig.

## Vertrag

Der Vertrag steigt in der Version und bekommt eine Abschnittsliste:

```
sections: {
  fromNoteIndex: int, toNoteIndex: int,
  confidence: number, anchoredBothSides: boolean
}[]
```

Damit kann der Korrektur-Editor aus Teilprojekt 6 Nutzer gezielt auf unsichere Stellen führen, statt sie die ganze Datei absuchen zu lassen.

**Bereichsgrenzen werden gegen die Notenanzahl geprüft.** Der bestehende Vertrag lässt einen Umbruchindex außerhalb des Bereichs still durchrutschen — ein bekannter, dokumentierter Defekt. Er wird hier nicht wiederholt.

## Test- und Messstrategie

`anchors.py` trägt die Beweislast, mit handgeschriebenen Wortlisten und ohne jedes Modell:

- Identische Listen ergeben lückenlose Anker.
- Ein doppelter Refrain ergibt monoton steigende Anker ohne Rückwärtssprung — der Test, der beim heutigen Verfahren fehlgeschlagen wäre.
- Verhörte Wörter fallen heraus, ohne die Nachbarn zu verlieren.
- Ein leeres Transkript ergibt einen Abschnitt mit Vertrauen null.
- Tragende Invariante: Ankerindizes und Ankerzeiten sind beide streng steigend.

Die Modelladapter bekommen, was in Teilprojekt 1 etabliert wurde: Cache-Treffer und stufenübergreifende Invalidierung, geprüft über **vorgeschaltete Platzhaltermodule statt über eine leere Umgebung**. Ein Test, dessen Beweis die Abwesenheit einer Abhängigkeit ist, hält nur so lange, wie niemand sie installiert.

Die Messvorrichtung wird geschärft: `compareToReference` bekommt den **vorzeichenbehafteten Versatz** und ein **Driftprofil**. Der Absolutwert hat die Unterscheidung zwischen konstantem Versatz und lokalem Verrutschen verdeckt; diese Diagnose musste außerhalb des Harness von Hand gerechnet werden und gehört in die Vorrichtung, sonst wiederholt sich die Handarbeit bei jeder Messung.

## Risiken

**Das Hauptrisiko: Gesang ist für ASR schwerer als Sprache.** Gedehnte Vokale, Hall und Musikreste nach der Stimmtrennung können ein zu dünnes Transkript ergeben. Dann liefert es zu wenige Anker, und der Ansatz fällt auf das heutige Verhalten zurück, statt es zu schlagen.

**Das ist prüfbar, bevor irgendetwas gebaut wird**: Transkript für den bereits vermessenen Song erzeugen und die Ankerausbeute zählen. Diese Probe steht als erster Schritt des Umsetzungsplans und dient als Abbruchkriterium — fällt sie schlecht aus, ist der Entwurf zu überdenken statt umzusetzen.

Weitere Risiken:

- **Die Abschnittsgröße ist ein Stellparameter ohne Vorbild.** Zu große Abschnitte lassen das Verrutschen zurückkehren, zu kleine nehmen dem Aligner den Spielraum, den er braucht. Der Wert ist zu messen, nicht zu raten.
- **Ein zweites Modell auf der Platte** verschärft die Positionierungsfrage aus Teilprojekt 1 weiter: aus dem schlanken Downloader wird endgültig ein Werkzeug mit GPU-Erwartung und mehreren Gigabyte Modellen.
- **Belegt ist bisher eine Sprache.** Die Tokenisierungs-Übereinstimmung gilt gemessen für Deutsch; andere Sprachen bleiben offen.

## Bewusst nicht enthalten

- **Duette** — unverändert vertagt.
- **Sprachen ohne WhisperX-Alignment** — keine Ersatzlösung.
- **Persistenter Worker mit vorgehaltenen Modellen** — später möglich, ohne Vertragsbruch.
- **Verbesserungen an Tonhöhe oder Silbentrennung** — eigenes Problem, eigener Durchgang.
- **Die Umgebungsverwaltung** — bleibt Teilprojekt 2, hier wird nur diagnostiziert.
