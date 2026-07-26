"""Tempoerkennung.

Beat-Tracker verfehlen das Tempo klassischerweise um Faktor zwei — mal
halb, mal doppelt. korrigiere_tempo schiebt den Wert in einen
musikalisch plausiblen Bereich zurueck.
"""


def korrigiere_tempo(bpm: float, min_bpm: float = 70.0, max_bpm: float = 180.0) -> float:
    """Halb/Doppel-Fehler ausgleichen, ohne endlos zu laufen.

    Der Zielbereich ist einschliesslich: ein Wert genau auf min_bpm oder
    max_bpm ist bereits richtig und wird unveraendert zurueckgegeben.
    Die Vergleiche muessen darum strikt bleiben — mit <= bzw. >= wuerden
    Grenzwerte aus dem Bereich hinausgeschoben (70 -> 140, 180 -> 90).
    """
    if bpm <= 0:
        return bpm
    wert = float(bpm)
    # Iterationsgrenze verhindert Endlosschleifen bei Bereichen, die kein
    # Faktor-2-Vielfaches treffen kann.
    for _ in range(8):
        if wert < min_bpm:
            wert *= 2.0
        elif wert > max_bpm:
            wert /= 2.0
        else:
            break
    return wert
