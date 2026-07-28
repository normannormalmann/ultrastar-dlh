import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from ultrastar_pipeline.progress import ERROR_PREFIX

WURZEL = Path(__file__).resolve().parent.parent


def _lauf(*args: str, schattenpfad: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Ruft die CLI als Subprozess auf.

    schattenpfad landet vor den site-packages in PYTHONPATH und kann damit ein
    installiertes Paket verdecken — so laesst sich eine unvollstaendige
    Umgebung erzwingen, statt sie vorzufinden.
    """
    umgebung = None
    if schattenpfad is not None:
        umgebung = dict(os.environ)
        bisher = umgebung.get("PYTHONPATH")
        umgebung["PYTHONPATH"] = (
            f"{schattenpfad}{os.pathsep}{bisher}" if bisher else str(schattenpfad)
        )
    return subprocess.run(
        [sys.executable, "-m", "ultrastar_pipeline", *args],
        capture_output=True,
        text=True,
        cwd=WURZEL,
        env=umgebung,
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


def test_fehlendes_modell_paket_meldet_env_missing_mit_paketnamen(tmp_path):
    """Ein fehlendes Modellpaket muss env_missing melden und das Paket nennen.

    Der Zustand wird erzwungen, nicht vorgefunden: ein vorgeschaltetes
    torch.py wirft beim Import genau das, was ein fehlendes Paket wirft.
    Vorher verliess sich der Test darauf, dass die Modell-Extras in dieser
    Umgebung nicht installiert sind — seit sie es fuer den Bewertungslauf
    sind, prueft er den Zustand der Maschine statt des Verhaltens.

    --bpm gesetzt, damit der erste Modell-Import in separate() (torch) und
    nicht schon in _erkenne_bpm (librosa) stattfindet.
    """
    schatten = tmp_path / "schatten"
    schatten.mkdir()
    (schatten / "torch.py").write_text(
        'raise ModuleNotFoundError("No module named \'torch\'", name="torch")\n',
        encoding="utf8",
    )
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"kein echtes audio")
    lyrics = tmp_path / "l.txt"
    lyrics.write_text("Hallo Welt\n", encoding="utf8")
    p = _lauf(
        "--audio", str(audio), "--lyrics-file", str(lyrics),
        "--language", "de", "--bpm", "120", "--device", "cpu",
        "--work-dir", str(tmp_path / "cache"), "--out", str(tmp_path / "out.json"),
        schattenpfad=schatten,
    )
    assert p.returncode == 1
    assert _fehler_kind(p.stdout) == "env_missing"
    for zeile in p.stdout.splitlines():
        if zeile.startswith(ERROR_PREFIX):
            nutzlast = json.loads(zeile[len(ERROR_PREFIX):])
            assert nutzlast["module"] == "torch"


def test_stage_versions_folgen_den_modulkonstanten(monkeypatch):
    """_stage_versions() muss aus den Modulen lesen, nicht aus Literalen —
    sonst bumpt eine Aenderung von align.STAGE_VERSION den Bericht nicht."""
    import ultrastar_pipeline.__main__ as haupt

    monkeypatch.setattr(haupt, "ALIGN_STAGE_VERSION", "77")
    assert haupt._stage_versions()["align"] == "77"


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
