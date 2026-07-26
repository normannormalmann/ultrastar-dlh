import json
import subprocess
import sys
from pathlib import Path

import pytest

from ultrastar_pipeline.progress import ERROR_PREFIX

WURZEL = Path(__file__).resolve().parent.parent


def _lauf(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "ultrastar_pipeline", *args],
        capture_output=True,
        text=True,
        cwd=WURZEL,
    )


def _fehler_kind(ausgabe: str) -> str | None:
    for zeile in ausgabe.splitlines():
        if zeile.startswith(ERROR_PREFIX):
            return json.loads(zeile[len(ERROR_PREFIX):])["kind"]
    return None


def test_fehlende_argumente_ergeben_exit_2():
    assert _lauf().returncode == 2


def test_fehlendes_audio_meldet_strukturierten_fehler(tmp_path):
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Hallo Welt\n", encoding="utf8")
    p = _lauf(
        "--audio", str(tmp_path / "gibtsnicht.wav"),
        "--lyrics-file", str(lyrics),
        "--language", "de",
        "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "audio_unreadable"


def test_leerer_text_meldet_strukturierten_fehler(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"kein echtes audio")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("\n\n", encoding="utf8")
    p = _lauf(
        "--audio", str(audio), "--lyrics-file", str(lyrics),
        "--language", "de", "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "lyrics_empty"


def test_ungeloeste_textfrage_bricht_ab(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"kein echtes audio")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Zeile (2x)\n", encoding="utf8")
    p = _lauf(
        "--audio", str(audio), "--lyrics-file", str(lyrics),
        "--language", "de", "--out", str(tmp_path / "out.json"),
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "lyrics_unresolved"


@pytest.mark.slow
def test_voller_lauf_erzeugt_gueltiges_json(tmp_path):
    """Braucht Modelle. Aufruf: bun run test:py:slow"""
    clip = WURZEL / "tests" / "fixtures" / "clip.wav"
    if not clip.is_file():
        pytest.skip("tests/fixtures/clip.wav fehlt (nicht im Repo, lokal ablegen)")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Hallo Welt\n", encoding="utf8")
    out = tmp_path / "out.json"
    p = _lauf(
        "--audio", str(clip), "--lyrics-file", str(lyrics),
        "--language", "de", "--device", "cpu",
        "--work-dir", str(tmp_path / "cache"), "--out", str(out),
    )
    assert p.returncode == 0, p.stdout
    daten = json.loads(out.read_text(encoding="utf8"))
    assert daten["schemaVersion"] == 1
    assert len(daten["notes"]) > 0
