"""Cache-Schluessel der Tonhoehen-Stufe.

Diese Datei fehlte, und genau hier sass der Fehler: der Schluessel kannte das
Tonhoehenmodell nicht. Ein Vergleichslauf mit einem anderen Modell haette
stillschweigend den alten Verlauf aus dem Cache bekommen und als "kein
Unterschied" gelesen werden muessen.
"""

import json
from pathlib import Path

from ultrastar_pipeline import modellwahl, pitch, separate
from ultrastar_pipeline.cache import atomic_write_bytes, stage_path


def _cache_pfad(work_dir: Path, audio_hash: str) -> Path:
    return stage_path(
        work_dir,
        audio_hash,
        "pitch",
        {
            "pitch_model": modellwahl.PITCH,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        pitch.STAGE_VERSION,
        ".json",
    )


class _Verweigerer:
    """Jeder Zugriff ist ein Beweis, dass der Cache verfehlt wurde."""

    def __init__(self, zugriffe: list[str]) -> None:
        self._zugriffe = zugriffe

    def detect_from_file(self, _pfad: str):
        self._zugriffe.append("detect_from_file")
        raise AssertionError("Modell wurde geladen, obwohl der Cache greifen sollte")


def test_cache_treffer_kommt_ohne_modell_aus(tmp_path, monkeypatch):
    zugriffe: list[str] = []
    monkeypatch.setattr(
        pitch.modelle, "hole_swiftf0", lambda: _Verweigerer(zugriffe)
    )
    atomic_write_bytes(_cache_pfad(tmp_path, "hashA"), json.dumps([]).encode("utf8"))

    assert pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA") == []
    assert zugriffe == []


def test_anderes_tonhoehenmodell_invalidiert_den_cache(tmp_path, monkeypatch):
    """Der eigentliche Grund fuer diese Datei."""
    zugriffe: list[str] = []
    monkeypatch.setattr(
        pitch.modelle, "hole_swiftf0", lambda: _Verweigerer(zugriffe)
    )
    atomic_write_bytes(_cache_pfad(tmp_path, "hashA"), json.dumps([]).encode("utf8"))

    # Erst greift der Cache.
    assert pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA") == []
    assert zugriffe == []

    # Nach einem Modellwechsel darf er es nicht mehr.
    monkeypatch.setattr(modellwahl, "PITCH", "ein-anderes-modell")
    try:
        pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA")
    except AssertionError:
        pass
    assert zugriffe == ["detect_from_file"]


def test_separate_versionswechsel_invalidiert_den_cache(tmp_path, monkeypatch):
    """Ein Verlauf auf dem alten Stem beschriebe Audio, das es nie gab."""
    zugriffe: list[str] = []
    monkeypatch.setattr(
        pitch.modelle, "hole_swiftf0", lambda: _Verweigerer(zugriffe)
    )
    atomic_write_bytes(_cache_pfad(tmp_path, "hashA"), json.dumps([]).encode("utf8"))

    assert pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA") == []
    monkeypatch.setattr(separate, "STAGE_VERSION", "999")
    try:
        pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA")
    except AssertionError:
        pass
    assert zugriffe == ["detect_from_file"]
