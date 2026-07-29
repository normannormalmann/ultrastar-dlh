"""Forced Alignment ueber WhisperX: Paesse 3 und 4 des Vierpass-Modells.

Die reine Entscheidungslogik (Interpolation, Fenstergrenzen, Validierung)
liegt in den testbaren Bausteinen; hier sind nur die Modellaufrufe selbst
duenn.

Teile portiert aus UltraStarKaraokeMaker (https://github.com/walterfr/UltraStarKaraokeMaker, MIT, (c) walterfr).
"""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, replace
from pathlib import Path

from . import separate
from .anchors import GemessenesWort, QUELLE_INTERPOLIERT, QUELLE_REALIGN
from .cache import atomic_write_bytes, stage_path
from .errors import LanguageUnsupported
from .notes import AlignedWord
from .numerals import erweitere_zahlwort
from .progress import emit_progress

STAGE_VERSION = "2"

# Re-exportiert: bestehender Code und Tests importieren LanguageUnsupported
# von hier, die eigentliche Definition liegt aber in errors.py (Importzyklus,
# siehe dort).
__all__ = ["LanguageUnsupported", "AlignmentFailed", "align"]


@dataclass
class WortZeit:
    """Ein Textwort mit Zeit, Score und Herkunft der Zeit. Bewusst
    veraenderlich: Pass 3 befoerdert interpolierte Eintraege in place zu
    gemessenen."""

    text: str
    start: float
    ende: float
    score: float
    quelle: str


_VOKALGRUPPE = re.compile(r"[aeiouy]+")


def silbengewicht(wort: str, sprache: str) -> int:
    """Grobe Silbenzahl (Vokalgruppen) als Interpolationsgewicht - keine
    Silbentrennung, nur die Erkenntnis, dass "melodie" laenger klingt als
    "und". Akzente werden gefaltet (Umlaute bleiben Vokale), Zahlen zaehlen
    wie gesungen, nicht wie geschrieben ("20" hat keine Vokale, "zwanzig"
    zwei Gruppen). Mindestens 1."""
    zerlegt = unicodedata.normalize("NFKD", wort.casefold())
    gefaltet = "".join(z for z in zerlegt if not unicodedata.combining(z))
    kern = "".join(z for z in gefaltet if z.isalnum())
    ausgeschrieben = " ".join(erweitere_zahlwort(kern, sprache))
    return max(1, len(_VOKALGRUPPE.findall(ausgeschrieben)))


def interpoliere(
    anker: list[GemessenesWort | None],
    woerter: list[str],
    sprache: str,
    audio_ende: float,
) -> list[WortZeit]:
    """Pass 4, letzter Rueckfall: Woerter ohne Messung werden zwischen den
    gemessenen Nachbarn interpoliert, gewichtet nach geschaetzter
    Silbenzahl, mit einer Atempause vor der naechsten Messung. Ketten an
    den Raendern sind durch Audioanfang und -ende begrenzt (im Vorbild
    gemessen: ohne Deckel liefen 163 Woerter bis 207,6 s bei 199 s Audio).
    Interpolierte Eintraege tragen Score 0,0 - ein anderes Signal als
    "phonetisch unsicher gemessen".

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    n = len(woerter)
    zeiten: list[WortZeit | None] = [None] * n
    for i in range(n):
        a = anker[i]
        if a is not None:
            zeiten[i] = WortZeit(woerter[i], a.start, a.ende, a.score, a.quelle)

    i = 0
    while i < n:
        if zeiten[i] is not None:
            i += 1
            continue
        lauf_start = i
        while i < n and zeiten[i] is None:
            i += 1
        lauf = list(range(lauf_start, i))
        gewichte = [silbengewicht(woerter[k], sprache) for k in lauf]
        davor = anker[lauf_start - 1] if lauf_start > 0 else None
        danach = anker[i] if i < n else None

        if davor is not None and danach is not None:
            spanne = max(0.05 * (len(lauf) + 1), danach.start - davor.ende)
            atem = sum(gewichte) / len(gewichte)
            summe = sum(gewichte) + atem
            t = davor.ende
            for k, g in zip(lauf, gewichte):
                dauer = spanne * g / summe
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer
        elif davor is not None:
            # Songende ohne weitere Messung: nach vorn ketten, ~0,15 s je
            # Silbengruppe, aber nie ueber das Audio hinaus.
            t = davor.ende
            dauern = [min(0.8, max(0.2, 0.15 * g)) for g in gewichte]
            uebrig = audio_ende - t
            noetig = sum(dauern)
            if noetig > uebrig > 0:
                faktor = uebrig / noetig
                dauern = [d * faktor for d in dauern]
            for k, dauer in zip(lauf, dauern):
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer
        elif danach is not None:
            # Songanfang ohne Messung davor: rueckwaerts ketten, endet an
            # der ersten Messung, beginnt fruehestens bei 0.
            t = danach.start
            for k, g in zip(reversed(lauf), reversed(gewichte)):
                dauer = min(0.8, max(0.2, 0.15 * g))
                start = max(0.0, t - dauer)
                zeiten[k] = WortZeit(woerter[k], start, t, 0.0, QUELLE_INTERPOLIERT)
                t = start
        else:
            # Kein einziger Anker im Song: ab 0 ketten, im Audio bleiben.
            # Pass 3 macht daraus anschliessend ein Fenster ueber die
            # volle Spur.
            t = 0.0
            dauern = [min(0.8, max(0.2, 0.15 * g)) for g in gewichte]
            if sum(dauern) > audio_ende > 0:
                faktor = audio_ende / sum(dauern)
                dauern = [d * faktor for d in dauern]
            for k, dauer in zip(lauf, dauern):
                zeiten[k] = WortZeit(woerter[k], t, t + dauer, 0.0, QUELLE_INTERPOLIERT)
                t += dauer

    fertig = [z for z in zeiten if z is not None]
    if len(fertig) != n:
        # Kann nur ein Programmierfehler sein - laut scheitern statt still
        # Woerter verlieren.
        raise AlignmentFailed("Interpolation hat Woerter verloren")
    return fertig


def stille_grenzen(
    audio,
    von_sample: int,
    bis_sample: int,
    abtastrate: int = 16000,
    energie_schwelle: float = 0.01,
    rahmen_ms: float = 20.0,
) -> tuple[int, int]:
    """Trimmt ein Fenster auf den Bereich mit echter Gesangsenergie (RMS je
    Rahmen). Ein Fenster voller Randstille gibt dem CTC keinen Hinweis, wo
    darin das Singen beginnt - er schmiert Woerter in die Stille. Ein
    Rahmen Vorlauf bleibt stehen (Konsonantenansatz). Ohne einen einzigen
    Rahmen ueber der Schwelle bleiben die Grenzen unveraendert.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    import numpy as np

    rahmen_laenge = max(1, int(abtastrate * rahmen_ms / 1000))
    ausschnitt = audio[von_sample:bis_sample]
    if ausschnitt.size < rahmen_laenge:
        return von_sample, bis_sample

    anzahl = ausschnitt.size // rahmen_laenge
    rahmen = ausschnitt[: anzahl * rahmen_laenge].reshape(anzahl, rahmen_laenge)
    rms = np.sqrt(np.mean(rahmen.astype(np.float64) ** 2, axis=1))
    stimmhaft = np.where(rms >= energie_schwelle)[0]
    if stimmhaft.size == 0:
        return von_sample, bis_sample

    erster = max(0, int(stimmhaft[0]) - 1)
    letzter = int(stimmhaft[-1]) + 1
    neu_von = von_sample + erster * rahmen_laenge
    neu_bis = min(bis_sample, von_sample + letzter * rahmen_laenge)
    return neu_von, neu_bis


def _ctc_tokens(wort: str, sprache: str) -> list[str]:
    """Tokens, die dieses Wort gegenueber dem CTC vertreten: Zahlen
    ausgeschrieben, alles andere unveraendert (Satzzeichen verwirft
    whisperx selbst)."""
    kern = "".join(z for z in wort.casefold() if z.isalnum())
    teile = erweitere_zahlwort(kern, sprache)
    return teile if teile != [kern] else [wort]


def _fasse_zusammen(
    roh: list[dict], herkunft: list[int], anzahl: int
) -> list[dict] | None:
    """Fuegt expandierte Tokens wieder zu einer Messung je Ursprungswort
    zusammen (Start des ersten, Ende des letzten, schwaechster Score).
    None, sobald ein Token ohne Zeitstempel dabei ist - dann faellt die
    ganze Luecke sicher auf die Interpolation zurueck."""
    gruppen: list[dict | None] = [None] * anzahl
    for w, pos in zip(roh, herkunft):
        ws, we = w.get("start"), w.get("end")
        if ws is None or we is None:
            return None
        aktuell = gruppen[pos]
        if aktuell is None:
            gruppen[pos] = dict(w)
        else:
            aktuell["start"] = min(float(aktuell["start"]), float(ws))
            aktuell["end"] = max(float(aktuell["end"]), float(we))
            aktuell["score"] = min(
                float(aktuell.get("score", 0.0)), float(w.get("score", 0.0))
            )
    if any(g is None for g in gruppen):
        return None
    return [g for g in gruppen if g is not None]


def _pruefe_fenster(
    woerter_roh: list[dict], fenster_start: float, fenster_ende: float
) -> list[tuple[float, float, float]] | None:
    """Validierung eines Fensterergebnisses: Zeiten vorhanden, im Fenster
    (mit 0,5 s Spiel), monoton steigend. None heisst: Ergebnis verwerfen,
    die Luecke behaelt die Interpolation - ein Fensterfehler reisst nie
    die Pipeline."""
    zeiten: list[tuple[float, float, float]] = []
    letzter_start = fenster_start - 0.001
    for w in woerter_roh:
        ws, we = w.get("start"), w.get("end")
        if ws is None or we is None:
            return None
        ws, we = float(ws), float(we)
        if ws < fenster_start - 0.5 or we > fenster_ende + 0.5 or ws < letzter_start:
            return None
        letzter_start = ws
        zeiten.append((ws, max(we, ws + 0.02), float(w.get("score", 0.0))))
    return zeiten


class AlignmentFailed(Exception):
    """Alignment lieferte kein verwertbares Ergebnis."""


def dauer_sekunden(pfad: Path) -> float:
    """Laufzeit einer WAV-Datei, ueber die Standardbibliothek."""
    import wave

    with wave.open(str(pfad), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def dauer_oder_rueckfall(pfad: Path, rueckfall: float) -> float:
    """Wie dauer_sekunden, faellt aber auf einen Rueckfallwert zurueck.

    Fuer die berichtete Gesamtdauer: der letzte Zeitstempel des
    Tonhoehenverlaufs endet vor dem tatsaechlichen Ende der Aufnahme (die
    letzten unstimmhaften Millisekunden liefern keinen Punkt) und ist damit
    systematisch zu kurz. Nicht jede Datei ist aber eine lesbare WAV — dann
    bleibt der Rueckfallwert die einzige verfuegbare Naeherung.
    """
    try:
        return dauer_sekunden(pfad)
    except Exception:
        return rueckfall


def zeilen_zuordnen(
    woerter: list[AlignedWord], lines: list[str]
) -> tuple[list[AlignedWord], int]:
    """Ordnet flach ausgerichtete Woerter den Quellzeilen zu.

    Grundlage ist die Wortanzahl je Zeile, in der Reihenfolge des Textes.
    Liefert der Aligner mehr Woerter als erwartet, fallen die ueberzaehligen
    an die letzte Zeile; liefert er weniger, bleiben spaetere Zeilen leer.
    Beides ist eine Abweichung und darf nicht still bleiben, wirft hier aber
    nicht: die zweite Rueckgabe ist die Abweichung (Ist minus Soll), positiv
    bei Wortueberschuss, negativ bei Wortmangel, 0 bei Uebereinstimmung — der
    Aufrufer meldet sie als Warnung.
    """
    anzahl_je_zeile = [len(zeile.split()) for zeile in lines]
    abweichung = len(woerter) - sum(anzahl_je_zeile)

    if not woerter:
        return [], abweichung

    letzte_zeile = len(lines) - 1 if lines else 0

    zugeordnet: list[AlignedWord] = []
    index = 0
    for zeile_idx, anzahl in enumerate(anzahl_je_zeile):
        for _ in range(anzahl):
            if index >= len(woerter):
                return zugeordnet, abweichung
            zugeordnet.append(replace(woerter[index], line_index=zeile_idx))
            index += 1

    # Ueberzaehlige Woerter (Aligner liefert mehr, als die Zeilen erwarten
    # lassen) landen auf der letzten Zeile statt verworfen zu werden.
    while index < len(woerter):
        zugeordnet.append(replace(woerter[index], line_index=letzte_zeile))
        index += 1
    return zugeordnet, abweichung


def richte_fenster_aus(
    zeiten: list[WortZeit],
    modell,
    metadaten,
    audio,
    device: str,
    sprache: str,
    warnungen: list[str],
) -> int:
    """Pass 3: je zusammenhaengendem interpoliertem Lauf genau ein
    whisperx.align im Fenster zwischen den gemessenen Nachbarn (bzw.
    Audio-Anfang/-Ende). Vorher wird Randstille getrimmt und Zahlen fuer
    den CTC ausgeschrieben; das Ergebnis wird validiert und bei Verstoss
    verworfen - ein Fensterfehler reisst nie die Pipeline, die Luecke
    behaelt dann sichtbar die Interpolation. Mutiert `zeiten` in place,
    liefert die Zahl befoerderter Woerter.

    Teile portiert aus UltraStarKaraokeMaker (MIT, (c) walterfr)."""
    import whisperx

    abtastrate = 16000  # whisperx.audio.SAMPLE_RATE
    audio_dauer = float(len(audio)) / abtastrate
    n = len(zeiten)
    befoerdert = 0
    i = 0
    while i < n:
        if zeiten[i].quelle != QUELLE_INTERPOLIERT:
            i += 1
            continue
        lauf_start = i
        while i < n and zeiten[i].quelle == QUELLE_INTERPOLIERT:
            i += 1
        lauf = list(range(lauf_start, i))

        fenster_start = zeiten[lauf_start - 1].ende if lauf_start > 0 else 0.0
        fenster_ende = zeiten[i].start if i < n else audio_dauer
        fenster_start = max(0.0, min(fenster_start, audio_dauer))
        fenster_ende = max(0.0, min(fenster_ende, audio_dauer))

        von_sample, bis_sample = stille_grenzen(
            audio,
            int(fenster_start * abtastrate),
            int(fenster_ende * abtastrate),
            abtastrate,
        )
        fenster_start = von_sample / abtastrate
        fenster_ende = bis_sample / abtastrate

        tokens: list[str] = []
        herkunft: list[int] = []
        for pos, k in enumerate(lauf):
            for teil in _ctc_tokens(zeiten[k].text, sprache):
                tokens.append(teil)
                herkunft.append(pos)

        # Zu knappes Fenster: bewusst stiller Verzicht - zwischen zwei
        # nahen Messungen ist die Interpolation ohnehin eng begrenzt, und
        # die Quelle bleibt ueber sections sichtbar.
        if fenster_ende - fenster_start < 0.10 + 0.08 * len(tokens):
            continue

        segment = {"start": fenster_start, "end": fenster_ende, "text": " ".join(tokens)}
        try:
            ergebnis = whisperx.align(
                [segment], modell, metadaten, audio, device,
                interpolate_method="nearest", return_char_alignments=False,
            )
        except Exception:
            warnungen.append(
                f"Fenster-Alignment fehlgeschlagen fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue

        roh = [w for seg in ergebnis.get("segments", []) for w in seg.get("words", [])]
        if len(roh) != len(tokens):
            warnungen.append(
                f"Fenster-Alignment lieferte {len(roh)} statt {len(tokens)} Tokens "
                f"fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue
        woerter_roh = _fasse_zusammen(roh, herkunft, len(lauf))
        if woerter_roh is None:
            warnungen.append(
                f"Fenster-Alignment ohne Zeitstempel fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue
        neu = _pruefe_fenster(woerter_roh, fenster_start, fenster_ende)
        if neu is None:
            warnungen.append(
                f"Fenster-Alignment unplausibel (Fenstergrenzen/Monotonie) "
                f"fuer {len(lauf)} Wort(e); Interpolation bleibt."
            )
            continue

        for k, (ws, we, score) in zip(lauf, neu):
            zeiten[k].start = ws
            zeiten[k].ende = we
            zeiten[k].score = score
            zeiten[k].quelle = QUELLE_REALIGN
            befoerdert += 1
    return befoerdert


def align(
    vocals: Path,
    lines: list[str],
    language: str,
    work_dir: Path,
    audio_hash: str,
    device: str,
    warnungen: list[str],
    anker: list[GemessenesWort | None],
) -> list[AlignedWord]:
    """Paesse 3 und 4: Interpolation als Grundierung, Fenster-Alignment
    fuer jede unverankerte Luecke. Jedes Wort traegt seine Quelle."""
    flach = [wort for zeile in lines for wort in zeile.split()]
    if not flach:
        raise AlignmentFailed("keine Woerter im Text")
    # Die Anker wurden gegen eine anderswo gebildete Wortliste berechnet.
    # Passt die Laenge nicht, zeigten alle Indizes auf falsche Woerter -
    # abbrechen statt still falsch ausrichten.
    if len(anker) != len(flach):
        raise AlignmentFailed(
            f"Anker decken {len(anker)} Woerter ab, der Text hat {len(flach)}"
        )

    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    # Die Anker gehen in den Schluessel ein: sie tragen den Einfluss von
    # Transkript UND LRC. Ein geaenderter Anker darf nie eine alte
    # Ausrichtung wiederverwenden.
    anker_digest = hashlib.sha256(
        json.dumps(
            [None if a is None else [a.start, a.ende, a.score, a.quelle] for a in anker]
        ).encode("utf8")
    ).hexdigest()[:16]
    ziel = stage_path(
        work_dir,
        audio_hash,
        "align",
        {
            "language": language,
            "lines": len(lines),
            "text": text_digest,
            "anker": anker_digest,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        STAGE_VERSION,
        ".json",
    )
    if ziel.is_file():
        gespeichert = json.loads(ziel.read_text(encoding="utf8"))
        # Die Warnungen des urspruenglichen Laufs gelten auch beim Treffer:
        # sie beschreiben das Ergebnis, nicht den Weg dorthin.
        warnungen.extend(gespeichert["warnungen"])
        emit_progress("align", 1.0)
        return [AlignedWord(**w) for w in gespeichert["words"]]

    emit_progress("align", 0.0)
    import whisperx

    try:
        modell, metadaten = whisperx.load_align_model(language_code=language, device=device)
    except Exception as exc:  # kein Alignment-Modell fuer diese Sprache
        raise LanguageUnsupported(language) from exc

    audio = whisperx.load_audio(str(vocals))
    audio_dauer = float(len(audio)) / 16000.0

    neue_warnungen: list[str] = []
    zeiten = interpoliere(anker, flach, language, audio_dauer)
    richte_fenster_aus(zeiten, modell, metadaten, audio, device, language, neue_warnungen)

    woerter = [
        AlignedWord(
            text=z.text,
            start=z.start,
            end=z.ende,
            confidence=z.score,
            line_index=0,  # wird durch zeilen_zuordnen ersetzt
            quelle=z.quelle,
        )
        for z in zeiten
    ]
    # Zeilenzuordnung wie bisher ueber die Wortanzahl je Zeile. Eine
    # Abweichung ist konstruktionsbedingt unmoeglich (die Woerter stammen
    # aus dem Text selbst), darum gibt es keine Abweichungswarnung mehr.
    woerter, _ = zeilen_zuordnen(woerter, lines)

    warnungen.extend(neue_warnungen)
    atomic_write_bytes(
        ziel,
        json.dumps(
            {"words": [w.__dict__ for w in woerter], "warnungen": neue_warnungen},
            ensure_ascii=False,
        ).encode("utf8"),
    )
    emit_progress("align", 1.0)
    return woerter
