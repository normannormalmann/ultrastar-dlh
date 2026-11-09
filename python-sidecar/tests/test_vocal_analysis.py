import json
from types import SimpleNamespace

from ultrastar_pipeline import vocalAnalysis


def test_analysis_only_separates_and_measures_pitch(tmp_path, monkeypatch):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"audio")
    stem = tmp_path / "stem.wav"
    stem.write_bytes(b"voice")
    monkeypatch.setattr(vocalAnalysis, "separate", lambda *args: stem)
    monkeypatch.setattr(vocalAnalysis, "track_pitch", lambda *args: [
        SimpleNamespace(time=0.1, midi=62.5, voiced=True),
        SimpleNamespace(time=0.2, midi=0, voiced=False),
    ])
    output = tmp_path / "out"
    vocalAnalysis.analyze(audio, output, tmp_path / "cache", "cpu", 60)
    assert (output / "vocals.wav").read_bytes() == b"voice"
    assert json.loads((output / "originalPitch.json").read_text()) == {
        "midiOffset": 60, "points": [{"ms": 100.0, "pitch": 2.5}],
    }
    assert not (output / "song.txt").exists()
