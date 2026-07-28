import json
import sys
import types
from pathlib import Path

import pytest

from ultrastar_pipeline import separate, transcribe
from ultrastar_pipeline.cache import atomic_write_bytes, stage_path
from ultrastar_pipeline.errors import LanguageUnsupported
from ultrastar_pipeline.transcribe import TranskriptWort


def _cache_pfad(work_dir: Path, audio_hash: str, sprache: str = "de") -> Path:
    return stage_path(
        work_dir,
        audio_hash,
        "transcribe",
        {
            "sprache": sprache,
            "modell": transcribe.MODELL,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        transcribe.STAGE_VERSION,
        ".json",
    )


def _platzhalter(zugriffe: list[str]) -> types.ModuleType:
    """Ein whisperx, das jeden Modellzugriff mitzaehlt statt eines zu laden."""

    def load_model(*args, **kwargs):
        zugriffe.append("load_model")
        raise RuntimeError("Platzhalter: dieser Test laedt kein Modell")

    modul = types.ModuleType("whisperx")
    modul.load_model = load_model
    return modul


def test_cache_treffer_kommt_ohne_modell_aus(tmp_path, monkeypatch):
    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    atomic_write_bytes(
        _cache_pfad(tmp_path, "hashA"),
        json.dumps([{"text": "eins", "start": 0.0, "ende": 0.5}]).encode("utf8"),
    )

    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashA", "cpu")

    assert ergebnis == [TranskriptWort(text="eins", start=0.0, ende=0.5)]
    assert zugriffe == []


def test_separate_versionswechsel_invalidiert_den_transcribe_cache(tmp_path, monkeypatch):
    """Eine geaenderte Stimmtrennung darf kein Transkript des alten Stems
    wiederverwenden — sonst beschreibt das Transkript Audio, das es nie
    gesehen hat."""
    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    atomic_write_bytes(_cache_pfad(tmp_path, "hashB"), json.dumps([]).encode("utf8"))

    assert transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashB", "cpu") == []
    assert zugriffe == []

    monkeypatch.setattr(separate, "STAGE_VERSION", "999")
    with pytest.raises(LanguageUnsupported):
        transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashB", "cpu")
    assert zugriffe == ["load_model"]


def test_fehlende_asr_sprache_nennt_die_stufe(tmp_path, monkeypatch):
    """LanguageUnsupported allein sagt nicht, welche Stufe kein Modell fand.
    Ohne die Stufe im Detail ist der Fehler fuer den Nutzer nicht zu deuten."""

    def load_model(*args, **kwargs):
        raise RuntimeError("kein Modell fuer diese Sprache")

    modul = types.ModuleType("whisperx")
    modul.load_model = load_model
    monkeypatch.setitem(sys.modules, "whisperx", modul)

    with pytest.raises(LanguageUnsupported) as fehler:
        transcribe.transcribe(Path("egal.wav"), "xx", tmp_path, "hashC", "cpu")
    assert fehler.value.language == "xx"
    assert fehler.value.stufe == "transcribe"
