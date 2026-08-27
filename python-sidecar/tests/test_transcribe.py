import json
import sys
import types
from pathlib import Path

import pytest

from ultrastar_pipeline import modellwahl, separate, transcribe
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
            "aligner": modellwahl.ALIGNER,
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


def test_gpu_speicher_voll_wird_nicht_zu_language_unsupported(tmp_path, monkeypatch):
    """Ein Speicherfehler ist keine Sprachfrage - der generische Handler in
    __main__ gibt dafuer den passenden Rat (--device cpu), das darf nicht
    hinter LanguageUnsupported verschwinden."""

    def load_model(*args, **kwargs):
        raise RuntimeError("CUDA out of memory")

    modul = types.ModuleType("whisperx")
    modul.load_model = load_model
    monkeypatch.setitem(sys.modules, "whisperx", modul)

    with pytest.raises(RuntimeError):
        transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashOOM", "cpu")


def _stub_mit_alignment() -> types.ModuleType:
    """whisperx-Platzhalter: Transkription plus Forced Alignment des
    Transkripts, ohne ein Modell zu laden."""
    modul = types.ModuleType("whisperx")

    class _Modell:
        def transcribe(self, pfad, language):
            return {"segments": [{"text": "hallo welt kaputt", "start": 0.0, "end": 2.0}]}

    modul.load_model = lambda *a, **k: _Modell()
    modul.load_align_model = lambda **k: ("alignmodell", {"meta": True})

    def align(segmente, modell, metadaten, pfad, device, return_char_alignments):
        return {
            "segments": [
                {"words": [
                    {"word": "hallo", "start": 10.2, "end": 10.6, "score": 0.31},
                    {"word": "welt", "start": 10.7, "end": 11.1},
                    {"word": "kaputt", "start": None, "end": None},
                ]}
            ]
        }

    modul.align = align
    return modul


def test_transkript_zeiten_sind_gemessen_nicht_verteilt(tmp_path, monkeypatch):
    """Die gleichverteilten Segmentzeiten des alten Verfahrens lagen im
    Pilot bis 4 s daneben (erster Anker geschaetzt 6,4 s, gesungen 10,5 s).
    Jetzt kommen die Zeiten aus dem Forced Alignment des Transkripts -
    Woerter ohne Zeitstempel entfallen, ein erfundener Wert waere schlimmer
    als ein fehlendes Wort."""
    monkeypatch.setitem(sys.modules, "whisperx", _stub_mit_alignment())
    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashD", "cpu")
    assert ergebnis == [
        TranskriptWort(text="hallo", start=10.2, ende=10.6, score=0.31),
        TranskriptWort(text="welt", start=10.7, ende=11.1, score=0.0),
    ]


def test_score_ueberlebt_den_cache(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "whisperx", _stub_mit_alignment())
    transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashE", "cpu")

    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    ergebnis = transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashE", "cpu")
    assert zugriffe == []
    assert ergebnis[0].score == 0.31


def test_fehlendes_alignment_modell_nennt_die_stufe_transcribe(tmp_path, monkeypatch):
    """Auch der zweite Modellzugriff dieser Stufe muss die Stufe nennen -
    sonst raet der Nutzer, ob ASR- oder Alignment-Modell fehlt."""
    modul = types.ModuleType("whisperx")

    class _Modell:
        def transcribe(self, pfad, language):
            return {"segments": []}

    modul.load_model = lambda *a, **k: _Modell()

    def load_align_model(**k):
        raise RuntimeError("kein Alignment-Modell")

    modul.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", modul)

    with pytest.raises(LanguageUnsupported) as fehler:
        transcribe.transcribe(Path("egal.wav"), "xy", tmp_path, "hashF", "cpu")
    assert fehler.value.stufe == "transcribe"


def test_anderer_aligner_invalidiert_den_transcribe_cache(tmp_path, monkeypatch):
    """Pass 1 des Alignments laeuft in dieser Stufe (whisperx.align), seine
    Zeiten stecken also im gecachten Ergebnis. Ohne die Aligner-Identitaet im
    Schluessel liefert ein Vergleichslauf still die Zeiten des alten."""
    zugriffe: list[str] = []
    monkeypatch.setitem(sys.modules, "whisperx", _platzhalter(zugriffe))
    atomic_write_bytes(_cache_pfad(tmp_path, "hashC"), json.dumps([]).encode("utf8"))

    assert transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashC", "cpu") == []
    assert zugriffe == []

    monkeypatch.setattr(modellwahl, "ALIGNER", "ein-anderer-aligner")
    with pytest.raises(LanguageUnsupported):
        transcribe.transcribe(Path("egal.wav"), "de", tmp_path, "hashC", "cpu")
    assert zugriffe == ["load_model"]
