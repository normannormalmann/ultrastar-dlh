from importlib import import_module
from types import SimpleNamespace


def test_asr_decodes_paths_without_pyav_and_preserves_segment_times(monkeypatch):
    backend = import_module("ultrastar_pipeline.modelBackend")
    waveform = object()
    monkeypatch.setattr(backend, "load_audio", lambda path: waveform)
    calls = []

    class Model:
        def transcribe(self, audio, **options):
            calls.append((audio, options))
            return iter([SimpleNamespace(start=1.25, end=2.5, text=" hello")]), None

    result = backend.Asr(Model()).transcribe("audio.wav", "en")
    assert result == {"segments": [{"start": 1.25, "end": 2.5, "text": " hello"}]}
    assert calls[0][0] is waveform
    assert calls[0][1]["language"] == "en"
    assert calls[0][1]["condition_on_previous_text"] is False
    assert calls[0][1]["vad_filter"] is True
