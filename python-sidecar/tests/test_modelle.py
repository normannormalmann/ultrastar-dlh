import sys
import types

import pytest

from ultrastar_pipeline import modelle


def _whisperx_zaehler(monkeypatch, ladungen: list[str]) -> None:
    modul = types.ModuleType("whisperx")
    modul.load_model = lambda name, device, compute_type, language: ladungen.append(
        f"asr:{name}:{device}:{language}"
    ) or object()
    modul.load_align_model = lambda language_code, device: ladungen.append(
        f"align:{language_code}:{device}"
    ) or (object(), {})
    monkeypatch.setitem(sys.modules, "whisperx", modul)


def test_asr_wird_je_schluessel_nur_einmal_geladen(monkeypatch):
    ladungen: list[str] = []
    _whisperx_zaehler(monkeypatch, ladungen)
    a = modelle.hole_asr("large-v2", "cpu", "de")
    b = modelle.hole_asr("large-v2", "cpu", "de")
    assert a is b
    assert ladungen == ["asr:large-v2:cpu:de"]


def test_verschiedene_schluessel_laden_getrennt(monkeypatch):
    ladungen: list[str] = []
    _whisperx_zaehler(monkeypatch, ladungen)
    modelle.hole_asr("large-v2", "cpu", "de")
    modelle.hole_asr("large-v2", "cpu", "en")
    modelle.hole_align("de", "cpu")
    modelle.hole_align("de", "cpu")
    assert ladungen == ["asr:large-v2:cpu:de", "asr:large-v2:cpu:en", "align:de:cpu"]


def test_demucs_und_swiftf0_cachen(monkeypatch):
    demucs_ladungen: list[str] = []
    demucs_pretrained = types.ModuleType("demucs.pretrained")
    demucs_pretrained.get_model = lambda name: demucs_ladungen.append(name) or object()
    monkeypatch.setitem(sys.modules, "demucs", types.ModuleType("demucs"))
    monkeypatch.setitem(sys.modules, "demucs.pretrained", demucs_pretrained)
    swift_ladungen: list[int] = []
    swift = types.ModuleType("swift_f0")
    swift.SwiftF0 = lambda: swift_ladungen.append(1) or object()
    monkeypatch.setitem(sys.modules, "swift_f0", swift)

    assert modelle.hole_demucs("htdemucs") is modelle.hole_demucs("htdemucs")
    assert modelle.hole_swiftf0() is modelle.hole_swiftf0()
    assert demucs_ladungen == ["htdemucs"]
    assert swift_ladungen == [1]
