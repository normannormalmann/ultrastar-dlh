import json
import sys
import types
from pathlib import Path

import ultrastar_pipeline.__main__ as haupt
from ultrastar_pipeline.progress import PROGRESS_PREFIX


def _stub_module(name: str, **attrs) -> types.ModuleType:
    modul = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(modul, k, v)
    return modul


def _installiere_modell_stubs(monkeypatch, geladen: list[str]) -> None:
    """Alle vier Modellquellen als Platzhalter, die nur mitzaehlen."""
    monkeypatch.setitem(
        sys.modules, "torch",
        _stub_module("torch", cuda=_stub_module("cuda", is_available=lambda: False)),
    )
    demucs_pretrained = _stub_module(
        "demucs.pretrained", get_model=lambda name: geladen.append(f"demucs:{name}")
    )
    monkeypatch.setitem(sys.modules, "demucs", _stub_module("demucs"))
    monkeypatch.setitem(sys.modules, "demucs.pretrained", demucs_pretrained)
    whisperx = _stub_module(
        "whisperx",
        load_model=lambda *a, **k: geladen.append("asr"),
        load_align_model=lambda **k: (geladen.append(f"align:{k['language_code']}"), ("m", {}))[1],
    )
    monkeypatch.setitem(sys.modules, "whisperx", whisperx)
    monkeypatch.setitem(
        sys.modules, "swift_f0",
        _stub_module("swift_f0", SwiftF0=lambda: geladen.append("pitch")),
    )


def test_preload_laedt_alle_vier_modellarten_und_schreibt_ergebnis(tmp_path, monkeypatch, capsys):
    geladen: list[str] = []
    _installiere_modell_stubs(monkeypatch, geladen)
    out = tmp_path / "preload.json"

    rc = haupt.main(["--preload", "--language", "de", "--device", "cpu", "--out", str(out)])

    assert rc == 0
    assert "demucs:htdemucs" in geladen
    assert "asr" in geladen
    assert "align:de" in geladen
    assert "pitch" in geladen
    daten = json.loads(out.read_text(encoding="utf8"))
    assert daten["device"] == "cpu"
    assert daten["modelle"]["demucs"] == "htdemucs"
    stufen = [
        json.loads(z[len(PROGRESS_PREFIX):])["stage"]
        for z in capsys.readouterr().out.splitlines()
        if z.startswith(PROGRESS_PREFIX)
    ]
    for stufe in ("preload:demucs", "preload:asr", "preload:align", "preload:pitch"):
        assert stufe in stufen


def test_preload_fehlende_sprache_meldet_language_unsupported(tmp_path, monkeypatch, capsys):
    geladen: list[str] = []
    _installiere_modell_stubs(monkeypatch, geladen)

    def kein_align(**k):
        raise RuntimeError("kein Alignment-Modell")

    sys.modules["whisperx"].load_align_model = kein_align

    rc = haupt.main(["--preload", "--language", "xx", "--device", "cpu",
                     "--out", str(tmp_path / "p.json")])
    assert rc == 1
    assert "language_unsupported" in capsys.readouterr().out


def test_ohne_preload_bleiben_audio_und_lyrics_pflicht(tmp_path, capsys):
    rc = haupt.main(["--language", "de", "--out", str(tmp_path / "o.json")])
    assert rc == 1
    assert "audio_unreadable" in capsys.readouterr().out
