"""Smoke test for verarbeitung core - wiring verification."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from ultrastar_pipeline.notes import AlignedWord
from ultrastar_pipeline.verarbeitung import Auftrag, verarbeite_auftrag


def test_verarbeite_auftrag_happy_path_smoke(tmp_path, monkeypatch):
    """Smoke test that verarbeite_auftrag wiring works end-to-end.

    Catches import and basic call errors that fast tests miss because
    the full integration test is slow/deselected. Uses monkeypatch to stub
    expensive operations."""

    # Create minimal tmp files
    audio = tmp_path / "test.wav"
    audio.write_bytes(b"dummy audio")

    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("Hallo Welt\nTest Text\n", encoding="utf8")

    out = tmp_path / "out.json"

    # Stub expensive operations at module level
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung._erkenne_bpm", lambda _: 120.0)
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.audio_fingerprint", lambda _: "hashX")

    # Stub separate to return a dummy file
    dummy_vocals = tmp_path / "vocals.wav"
    dummy_vocals.write_bytes(b"vocal")
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.separate", lambda *_: dummy_vocals)

    # Stub transcribe module with SimpleNamespace
    def stub_transcribe(*_):
        return []

    transcribe_stub = SimpleNamespace(transcribe=stub_transcribe)
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.transcribe", transcribe_stub)

    # Stub anchors
    def stub_berechne_anker(flat, _):
        return [None] * len(flat)

    anchors_stub = SimpleNamespace(
        berechne_anker=stub_berechne_anker,
        lese_lrc=lambda _: [],
        ordne_lrc_zeilen=lambda *_: [],
        finde_lrc_konflikte=lambda *_: [],
        entlarve_mit_lrc=lambda *_: 0,
        saee_lrc_anker=lambda *_: 0,
        MAX_LRC_KONFLIKT_QUOTE=0.5,
    )
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.anchors", anchors_stub)

    # Stub align to return one AlignedWord per text word
    def stub_align(*_):
        return [
            AlignedWord("Hallo", 0.0, 0.5, 0.8, 0, quelle="anchor"),
            AlignedWord("Welt", 0.5, 1.0, 0.8, 0, quelle="anchor"),
            AlignedWord("Test", 1.0, 1.5, 0.8, 0, quelle="anchor"),
            AlignedWord("Text", 1.5, 2.0, 0.8, 0, quelle="anchor"),
        ]

    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.align", stub_align)

    # Stub pitch tracking
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.track_pitch", lambda *_: [])

    # Stub duration
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.dauer_oder_rueckfall", lambda *_: 2.0)
    monkeypatch.setattr("ultrastar_pipeline.verarbeitung.dauer_sekunden", lambda _: 2.0)

    # Create auftrag and run
    auftrag = Auftrag(
        language="de",
        out=out,
        audio=audio,
        lyrics_file=lyrics,
        bpm=120.0,
        device="cpu",
        work_dir=tmp_path / "cache",
        synced_lyrics=None,
    )

    result = verarbeite_auftrag(auftrag)

    # Verify success
    assert result == 0, "verarbeite_auftrag should return 0 on success"
    assert out.is_file(), "Output file should exist"

    # Verify JSON structure
    import json

    data = json.loads(out.read_text(encoding="utf8"))
    assert "schemaVersion" in data
    assert "notes" in data
    assert "sections" in data
    assert len(data["sections"]) > 0, "Should have sections"
