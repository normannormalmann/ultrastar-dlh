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

    # Nach einem Modellwechsel darf er es nicht mehr: das andere Backend
    # muss rechnen.
    monkeypatch.setattr(modellwahl, "PITCH", "torchcrepe-full")
    monkeypatch.setattr(
        pitch, "_verlauf_torchcrepe", lambda vocals, device: zugriffe.append("torchcrepe") or []
    )
    assert pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA") == []
    assert zugriffe == ["torchcrepe"]


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


# --- torchcrepe als zweites Backend (Pitch-Arm, Parameter vorab eingefroren) ---


def test_swiftf0_schluessel_bleibt_unveraendert(monkeypatch):
    """Der Basis-Cache vom Laptop muss weiter greifen: fuer swift-f0 darf
    kein neuer Eintrag in die Schluesselparameter wandern."""
    monkeypatch.setattr(modellwahl, "PITCH", "swift-f0")
    assert pitch._cache_parameter() == {
        "pitch_model": "swift-f0",
        "separate_stage_version": separate.STAGE_VERSION,
        "separate_model": separate.MODELL,
    }


def test_torchcrepe_parameter_stehen_im_schluessel(monkeypatch):
    """Sonst liefert ein spaeterer Versuch mit anderem Hop oder Schwellwert
    still den alten Verlauf aus dem Cache."""
    monkeypatch.setattr(modellwahl, "PITCH", "torchcrepe-full")
    parameter = pitch._cache_parameter()
    assert parameter["pitch_model"] == "torchcrepe-full"
    assert parameter["torchcrepe"] == pitch.TORCHCREPE_PARAMETER
    assert pitch.TORCHCREPE_PARAMETER == {
        "modell": "full",
        "hop_ms": 10,
        "fmin_hz": 65.0,
        "fmax_hz": 1100.0,
        "decoder": "viterbi",
        "periodicity_medianfenster": 3,
        "stimmhaft_ab": 0.21,
        "batch_frames": 512,
        "silence_rms_db": -60.0,
        "dither_seed": 0,
    }


def test_unbekanntes_tonhoehenmodell_wirft(tmp_path, monkeypatch):
    """Ein Tippfehler in USC_PITCH darf nicht still SwiftF0 rechnen und das
    Ergebnis unter dem falschen Namen cachen."""
    monkeypatch.setattr(modellwahl, "PITCH", "gibt-es-nicht")
    try:
        pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA")
    except ValueError as fehler:
        assert "gibt-es-nicht" in str(fehler)
    else:
        raise AssertionError("ValueError erwartet")


def test_torchcrepe_wird_bei_cache_fehltreffer_gerufen(tmp_path, monkeypatch):
    zugriffe: list[str] = []
    monkeypatch.setattr(modellwahl, "PITCH", "torchcrepe-full")
    monkeypatch.setattr(
        pitch.modelle, "hole_swiftf0", lambda: _Verweigerer(zugriffe)
    )
    erwartet = [pitch.PitchPoint(time=0.0, midi=60.0, voiced=True)]
    monkeypatch.setattr(
        pitch,
        "_verlauf_torchcrepe",
        lambda vocals, device: zugriffe.append(f"torchcrepe:{device}") or erwartet,
    )

    ergebnis = pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA", device="cuda")

    assert ergebnis == erwartet
    assert zugriffe == ["torchcrepe:cuda"]
    # Zweiter Aufruf kommt aus dem Cache.
    assert pitch.track_pitch(Path("egal.wav"), tmp_path, "hashA", device="cuda") == erwartet
    assert zugriffe == ["torchcrepe:cuda"]


def test_torchcrepe_punkte_schwelle_und_zeitraster():
    """Stimmhaft genau dann, wenn die gefilterte Periodicity >= 0.21 liegt;
    Zeitstempel sind i * hop."""
    punkte = pitch._torchcrepe_punkte(
        f0_hz=[440.0, 440.0, 440.0, 440.0],
        periodicity=[0.9, 0.9, 0.2, 0.2],
        hop_s=0.01,
        medianfenster=1,
        stimmhaft_ab=0.21,
    )
    assert [p.time for p in punkte] == [0.0, 0.01, 0.02, 0.03]
    assert [p.voiced for p in punkte] == [True, True, False, False]
    assert all(abs(p.midi - 69.0) < 1e-9 for p in punkte)


def test_torchcrepe_medianfilter_glaettet_einzelne_ausreisser():
    """Fenster 3 wie im torchcrepe-README: ein einzelner Einbruch der
    Periodicity macht den Frame nicht stimmlos, ein einzelner Ausschlag
    nicht stimmhaft."""
    punkte = pitch._torchcrepe_punkte(
        f0_hz=[220.0] * 7,
        periodicity=[0.9, 0.9, 0.1, 0.9, 0.1, 0.1, 0.9],
        hop_s=0.01,
        medianfenster=3,
        stimmhaft_ab=0.21,
    )
    assert [p.voiced for p in punkte] == [True, True, True, False, False, False, False]


def test_torchcrepe_punkte_ohne_frames():
    assert pitch._torchcrepe_punkte([], [], 0.01, 3, 0.21) == []


def test_crepe_silence_does_not_become_a_confident_tone():
    result = pitch._torchcrepe_punkte([440, 440], [.99, .99], .01, 1, .21, [0, .01])
    assert [p.voiced for p in result] == [False, True]
    assert result[1].confidence == .99


def test_swift_preserves_evidence_and_rejects_truncated_arrays(monkeypatch):
    from types import SimpleNamespace
    import pytest
    result = SimpleNamespace(timestamps=[0,.016], pitch_hz=[220,440], voicing=[False,True], confidence=[.6,.95])
    monkeypatch.setattr(pitch.modelle, 'hole_swiftf0', lambda: SimpleNamespace(detect_from_file=lambda path: result))
    points = pitch._verlauf_swiftf0(Path('fake.wav'))
    assert points[0].confidence == .6 and not points[0].voiced
    assert points[1].midi == 69 and points[1].source == 'swift-f0'
    result.confidence = [.6]
    with pytest.raises(ValueError):
        pitch._verlauf_swiftf0(Path('fake.wav'))


def test_invalid_model_values_are_not_cached(tmp_path, monkeypatch):
    import pytest
    monkeypatch.setattr(pitch, '_verlauf_swiftf0', lambda path: [pitch.PitchPoint(0,float('nan'),True)])
    with pytest.raises(ValueError):
        pitch.track_pitch(Path('fake.wav'), tmp_path, 'bad')
    assert not list(tmp_path.rglob('pitch-*.json'))


def test_consensus_cache_contains_recovery_parameters(tmp_path, monkeypatch):
    from ultrastar_pipeline.pitchConsensus import PARAMETERS
    monkeypatch.setattr(modellwahl, 'PITCH', pitch.CONSENSUS)
    assert pitch._cache_parameter()['consensus'] == PARAMETERS
    primary = [pitch.PitchPoint(.008+i*.016,60,False,.6,'swift-f0') for i in range(4)]
    secondary = [pitch.PitchPoint(p.time,60,True,.8,'torchcrepe') for p in primary]
    monkeypatch.setattr(pitch, '_verlauf_swiftf0', lambda path: primary)
    monkeypatch.setattr(pitch, '_verlauf_torchcrepe', lambda path,device: secondary)
    result = pitch.track_pitch(Path('fake.wav'), tmp_path, 'consensus')
    assert all(p.voiced and p.source == 'consensus' for p in result)
    assert pitch.track_pitch(Path('fake.wav'), tmp_path, 'consensus') == result


def test_preload_checks_the_selected_pitch_backend(monkeypatch):
    import sys
    from types import SimpleNamespace
    calls = []
    monkeypatch.setattr(modellwahl, 'PITCH', pitch.CONSENSUS)
    monkeypatch.setattr(pitch.modelle, 'hole_swiftf0', lambda: calls.append('swift'))
    monkeypatch.setitem(sys.modules, 'torchcrepe', SimpleNamespace(load=SimpleNamespace(model=lambda device,model: calls.append((device,model)))))
    pitch.preload_pitch('cuda')
    assert calls == ['swift', ('cuda','full')]
