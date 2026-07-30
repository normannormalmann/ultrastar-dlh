"""Der geteilte Verarbeitungskern: ein Auftrag rein, song_data.json raus.

CLI (ein Auftrag pro Prozess) und Worker (viele Auftraege pro Prozess)
laufen durch exakt dieselbe Funktion - gleiche Fehlerleitung, gleiche
@@PROGRESS/@@ERROR-Ausgaben, gleicher Vertrag. Getrennt von __main__.py,
damit der Worker den Kern importieren kann, ohne das CLI-Modul doppelt
zu laden (python -m laedt __main__ unter anderem Namen).
"""

import json
from dataclasses import dataclass
from pathlib import Path

from . import anchors
from .align import (
    STAGE_VERSION as ALIGN_STAGE_VERSION,
    AlignmentFailed,
    LanguageUnsupported,
    align,
    dauer_oder_rueckfall,
    dauer_sekunden,
)
from .cache import atomic_write_bytes, audio_fingerprint
from .contract import baue_song_data
from .notes import build_notes
from .pitch import STAGE_VERSION as PITCH_STAGE_VERSION, track_pitch
from .progress import emit_error, emit_progress
from .separate import STAGE_VERSION as SEPARATE_STAGE_VERSION, separate
from .syllables import has_dictionary
from .tempo import korrigiere_tempo
from .transcribe import STAGE_VERSION as TRANSCRIBE_STAGE_VERSION

# Marker, die eine Aufbereitung durch lyrics.ts erfordern. Kopflos wird
# hier nicht geraten - es wird abgebrochen.
UNGELOESTE_MARKER = ("(2x)", "(x2)", "[chorus]", "[refrain]")


def _waehle_device(wunsch: str, warnungen: list[str]) -> str:
    if wunsch != "auto":
        return wunsch
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    warnungen.append("Keine GPU gefunden, Verarbeitung auf CPU (deutlich langsamer).")
    return "cpu"


def _erkenne_bpm(audio: Path) -> float:
    import librosa
    import numpy as np

    y, sr = librosa.load(str(audio), mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # librosa 0.11 liefert das Tempo als Array, nicht als Skalar, und unter
    # NumPy 2 wirft float() auf ein Array mit einem Element. Erst flach
    # machen, dann den ersten Wert nehmen - deckt Skalar und Array ab.
    werte = np.asarray(tempo).reshape(-1)
    if werte.size == 0:
        raise ValueError("Tempoerkennung lieferte keinen Wert")
    return korrigiere_tempo(float(werte[0]))


def _stage_versions() -> dict[str, str]:
    """Stufenversionen fuer den Bericht, aus den Modulen selbst - nicht
    hartkodiert, damit eine Versionsbumpe in separate/transcribe/align/pitch
    hier automatisch ankommt. notes wird nie gecacht (siehe Modulkopf) und
    hat darum keine eigene STAGE_VERSION."""
    return {
        "separate": SEPARATE_STAGE_VERSION,
        "transcribe": TRANSCRIBE_STAGE_VERSION,
        "align": ALIGN_STAGE_VERSION,
        "pitch": PITCH_STAGE_VERSION,
        "notes": "1",
    }


def _wende_lrc_an(anker, zeilen, lrc_text, audio_dauer, warnungen) -> None:
    """Wendet die LRC-Anker an - oder verwirft das .lrc als Ganzes, wenn es
    einem zu grossen Teil der Messungen widerspricht (dann ist es die
    falsche Edition; gemessen: 78 entlarvte Anker rissen die Songraender
    um Sekunden). Erst entlarven, dann saeen: entlarvte Luecken sollen
    neu besaet werden koennen."""
    lrc_zeilen = anchors.lese_lrc(lrc_text)
    pfosten = anchors.ordne_lrc_zeilen(zeilen, lrc_zeilen)
    gemessen = sum(1 for a in anker if a is not None)
    konflikte = anchors.finde_lrc_konflikte(anker, pfosten, audio_dauer)
    if gemessen and len(konflikte) / gemessen > anchors.MAX_LRC_KONFLIKT_QUOTE:
        warnungen.append(
            f"LRC verworfen: {len(konflikte)} von {gemessen} gemessenen Ankern "
            "widersprechen den Zeilenzeiten - vermutlich eine andere Edition."
        )
        return
    entlarvt = anchors.entlarve_mit_lrc(anker, pfosten, audio_dauer)
    gesaeht = anchors.saee_lrc_anker(anker, pfosten)
    warnungen.append(f"LRC: {entlarvt} Anker entlarvt, {gesaeht} Zeilenanfaenge gesaeht.")


def _baue_sections(woerter, wort_zu_note: list[int]) -> list[dict]:
    """Sections beschreiben Laeufe gleicher Messbarkeit: zusammenhaengend
    gemessene Strecken (anchor/fuzzy/realign/lrc) mit mittlerem
    phonetischem Score, interpolierte Laeufe mit confidence 0.
    anchoredBothSides heisst: beidseitig von gemessenen Woertern begrenzt
    - fuer gemessene Laeufe trivial wahr, fuer interpolierte genau dann,
    wenn sie nicht am Songanfang oder -ende liegen."""
    sections: list[dict] = []
    i = 0
    n = len(woerter)
    while i < n:
        gemessen = woerter[i].quelle != "interpolated"
        j = i
        while j < n and (woerter[j].quelle != "interpolated") == gemessen:
            j += 1
        # Woerter mit 0 Silben duplizieren ihren Notenindex in wort_zu_note
        # (siehe notes.py); ein Lauf nur aus solchen Woertern haette
        # fromNoteIndex == toNoteIndex - keinen Notenbereich, den eine
        # Section beschreiben koennte. songData.ts lehnt das ab.
        if wort_zu_note[j] > wort_zu_note[i]:
            sections.append(
                {
                    "fromNoteIndex": wort_zu_note[i],
                    "toNoteIndex": wort_zu_note[j],
                    "confidence": (
                        sum(w.confidence for w in woerter[i:j]) / (j - i) if gemessen else 0.0
                    ),
                    "anchoredBothSides": True if gemessen else (i > 0 and j < n),
                }
            )
        i = j
    return sections


@dataclass(frozen=True)
class Auftrag:
    language: str
    out: Path
    audio: Path | None = None
    lyrics_file: Path | None = None
    bpm: float | None = None
    device: str = "auto"
    work_dir: Path = Path(".pipeline-cache")
    synced_lyrics: Path | None = None


def verarbeite_auftrag(auftrag: Auftrag) -> int:
    """Verarbeite einen Auftrag vollstaendig: von Audio und Liedtext zu
    song_data.json. Gibt 0 bei Erfolg zurueck, sonst einen Fehlercode."""
    warnungen: list[str] = []

    device = _waehle_device(auftrag.device, warnungen)

    if auftrag.audio is None or not auftrag.audio.is_file():
        emit_error("audio_unreadable", path=str(auftrag.audio))
        return 1
    if auftrag.lyrics_file is None or not auftrag.lyrics_file.is_file():
        emit_error("lyrics_unreadable", path=str(auftrag.lyrics_file))
        return 1

    roh = auftrag.lyrics_file.read_text(encoding="utf8")
    zeilen = [z.strip() for z in roh.splitlines() if z.strip()]
    if not zeilen:
        emit_error("lyrics_empty")
        return 1

    # Bekannte Luecke, absichtlich ungefixt: dieser Scan findet nur die
    # literalen Marker selbst. Liedtext, der von lyrics.ts schon normalisiert
    # wurde, dessen offene Rueckfragen aber nie beantwortet wurden, sieht in
    # einer reinen .txt-Datei identisch zu geklaertem Text aus - dieser
    # Zustand ist hier nicht repraesentierbar. Gehoert zum UI-Teilprojekt.
    klein = roh.lower()
    gefunden = [m for m in UNGELOESTE_MARKER if m in klein]
    if gefunden:
        emit_error("lyrics_unresolved", markers=gefunden)
        return 1

    if not has_dictionary(auftrag.language):
        warnungen.append(
            f"Keine Silbentrennung fuer '{auftrag.language}', ganze Woerter werden genutzt."
        )

    try:
        emit_progress("tempo", 0.0)
        bpm = auftrag.bpm if auftrag.bpm is not None else _erkenne_bpm(auftrag.audio)
        emit_progress("tempo", 1.0)

        fingerprint = audio_fingerprint(auftrag.audio)
        vocals = separate(auftrag.audio, auftrag.work_dir, fingerprint, device)

        transkript = transcribe.transcribe(vocals, auftrag.language, auftrag.work_dir, fingerprint, device)
        flach = [wort for zeile in zeilen for wort in zeile.split()]
        anker = anchors.berechne_anker(flach, transkript)
        if auftrag.synced_lyrics is not None:
            if auftrag.synced_lyrics.is_file():
                _wende_lrc_an(
                    anker,
                    zeilen,
                    auftrag.synced_lyrics.read_text(encoding="utf8"),
                    dauer_sekunden(vocals),
                    warnungen,
                )
            else:
                warnungen.append(
                    "Synchronisierte Lyrics nicht lesbar, weiter ohne LRC-Anker."
                )

        woerter = align(
            vocals,
            zeilen,
            auftrag.language,
            auftrag.work_dir,
            fingerprint,
            device,
            warnungen,
            anker,
        )
        # Weiter unten wird wort_zu_note (aus build_notes) benutzt, um
        # Wortindizes in `woerter` auf Notenindizes zu uebersetzen - das ist
        # nur gueltig, wenn `woerter` dieselbe Laenge (und damit Reihenfolge)
        # wie `flach` hat. Die Konstruktion von align() macht eine Abweichung
        # eigentlich unmoeglich (siehe dort), aber ein stiller Programmierfehler
        # darf hier trotzdem nicht zu lautlos falsch verschobenen sections
        # fuehren. Deshalb hier abbrechen statt zu raten.
        if len(woerter) != len(flach):
            raise AlignmentFailed(
                f"Alignment lieferte {len(woerter)} Wort(e) zurueck, der Text hat "
                f"{len(flach)}; die Wort-zu-Note-Zuordnung waere damit nicht mehr gueltig."
            )
        interpoliert = sum(1 for w in woerter if w.quelle == "interpolated")
        if interpoliert:
            warnungen.append(
                f"{interpoliert} von {len(woerter)} Woertern ohne Messung (interpoliert)."
            )
        verlauf = track_pitch(vocals, auftrag.work_dir, fingerprint)

        # Groesste nicht zugeordnete Luecke: ein Indiz dafuer, dass der
        # Text nicht zum Audio passt (fehlende Strophe, falscher Song).
        luecken = [b.start - a.end for a, b in zip(woerter, woerter[1:])]
        # Ueberlappende oder unsortierte Woerter koennten eine negative
        # Luecke ergeben; das waere kein Indiz, sondern nur Rauschen.
        groesste_luecke = max(0.0, max(luecken)) if luecken else 0.0

        emit_progress("notes", 0.0)
        noten, umbrueche, gap, wort_zu_note = build_notes(woerter, verlauf, bpm, auftrag.language)
        emit_progress("notes", 1.0)

        sections = _baue_sections(woerter, wort_zu_note)

    except LanguageUnsupported as exc:
        emit_error("language_unsupported", language=exc.language, stufe=exc.stufe)
        return 1
    except AlignmentFailed as exc:
        emit_error("alignment_failed", detail=str(exc))
        return 1
    except MemoryError:
        emit_error("device_error", detail="Speicher voll. Mit --device cpu erneut versuchen.")
        return 1
    except ModuleNotFoundError as exc:
        # Bei weitem der wahrscheinlichste Fehler, solange die Modell-Extras
        # nicht installiert sind - muss deshalb vor dem generischen Fall
        # abgefangen werden, sonst verschwindet der Paketname darin.
        emit_error("env_missing", module=exc.name)
        return 1
    except Exception as exc:  # noqa: BLE001 - letzte Instanz, strukturiert melden
        art = type(exc).__name__
        # Kein automatisches Ausweichen auf CPU: das verwandelt einen
        # 40-Sekunden-Fehler stillschweigend in zehn Minuten.
        if "OutOfMemory" in art or "out of memory" in str(exc).lower():
            emit_error(
                "device_error", detail="GPU-Speicher voll. Mit --device cpu erneut versuchen."
            )
        else:
            emit_error("pipeline_failed", detail=f"{art}: {exc}")
        return 1

    # Der letzte Zeitstempel des Tonhoehenverlaufs bleibt der Rueckfall: die
    # echte WAV-Laenge (aus vocals, der garantiert eine WAV ist) ist genauer,
    # aber nicht in jedem Umfeld lesbar.
    dauer = dauer_oder_rueckfall(vocals, verlauf[-1].time if verlauf else 0.0)

    daten = baue_song_data(
        bpm=bpm,
        gap=gap,
        language=auftrag.language,
        notes=noten,
        line_breaks=umbrueche,
        duration_sec=dauer,
        device=device,
        stage_versions=_stage_versions(),
        warnings=warnungen,
        largest_gap_sec=groesste_luecke,
        sections=sections,
    )
    atomic_write_bytes(
        auftrag.out, json.dumps(daten, ensure_ascii=False, indent=2).encode("utf8")
    )
    return 0
