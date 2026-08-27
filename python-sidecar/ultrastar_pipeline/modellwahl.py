"""Die Identitaet der vier Modelle, an einer Stelle.

Bis hierher standen die Namen verstreut: zwei als Konstanten in ihren Stufen,
zwei gar nicht (der Aligner steckte implizit in whisperx, die Tonhoehe war ein
String-Literal im Preload-Bericht). Das war der Grund fuer einen stillen
Fehler: wer den Aligner oder das Pitch-Modell tauscht, bekommt aus dem Cache
weiter die alten Ergebnisse, weil deren Schluessel die Modellidentitaet nicht
kennen. Ein A/B-Vergleich haette identische Zahlen gezeigt und als "kein
Unterschied" gelesen werden muessen.

Ueber Umgebungsvariablen ueberschreibbar, damit ein Vergleichslauf nicht vier
neue Parameter durch worker.py, __main__.py, preload.py und den TypeScript-
Harness faedeln muss. Welche Werte tatsaechlich galten, steht danach im Bericht
(verarbeitung._stage_versions) und damit in jeder song_data.json - die
Umgebungsvariable ist also kein unsichtbarer Zustand.
"""

import os

SEPARATOR = os.environ.get("USC_SEPARATOR", "htdemucs")
ASR = os.environ.get("USC_ASR", "large-v2")
ALIGNER = os.environ.get("USC_ALIGNER", "wav2vec2")
PITCH = os.environ.get("USC_PITCH", "swift-f0")
