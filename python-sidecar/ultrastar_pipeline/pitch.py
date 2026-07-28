"""Tonhoehenverlauf ueber SwiftF0. Duenner Adapter."""

import json
import math
from pathlib import Path

from . import separate
from .cache import atomic_write_bytes, stage_path
from .notes import PitchPoint
from .progress import emit_progress

STAGE_VERSION = "1"


def _hz_zu_midi(hz: float) -> float:
    """Frequenz in MIDI-Halbtoene. 0 bedeutet: keine Tonhoehe."""
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def track_pitch(vocals: Path, work_dir: Path, audio_hash: str) -> list[PitchPoint]:
    """f0-Verlauf der Gesangsspur, in MIDI-Halbtoenen."""
    # Die Identitaet der separate-Stufe geht in den Schluessel ein: sonst
    # wuerde eine geanderte Stimmtrennung (neues Modell, neue Version) einen
    # Tonhoehenverlauf wiederverwenden, der noch auf dem alten Stem beruht.
    parameter = {
        "separate_stage_version": separate.STAGE_VERSION,
        "separate_model": separate.MODELL,
    }
    ziel = stage_path(work_dir, audio_hash, "pitch", parameter, STAGE_VERSION, ".json")
    if ziel.is_file():
        emit_progress("pitch", 1.0)
        return [PitchPoint(**p) for p in json.loads(ziel.read_text(encoding="utf8"))]

    emit_progress("pitch", 0.0)
    from swift_f0 import SwiftF0

    # SwiftF0 ist eine Klasse, keine Funktion, und PitchResult liefert die
    # Stimmhaftigkeit schon als Wahrheitswert pro Frame — ein zweiter Aufruf
    # dafuer existiert nicht. Felder: pitch_hz, confidence, timestamps, voicing.
    ergebnis = SwiftF0().detect_from_file(str(vocals))

    punkte = [
        PitchPoint(time=float(t), midi=_hz_zu_midi(float(f)), voiced=bool(v))
        for t, f, v in zip(
            ergebnis.timestamps, ergebnis.pitch_hz, ergebnis.voicing, strict=False
        )
    ]

    atomic_write_bytes(ziel, json.dumps([p.__dict__ for p in punkte]).encode("utf8"))
    emit_progress("pitch", 1.0)
    return punkte
