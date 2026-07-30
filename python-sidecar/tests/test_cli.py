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
    sonst bumpt eine Aenderung von align.STAGE_VERSION den Bericht nicht.
    Seit dem Worker-Umzug lebt der Kern in verarbeitung.py - dort patchen."""
    import ultrastar_pipeline.verarbeitung as verarbeitung

    monkeypatch.setattr(verarbeitung, "ALIGN_STAGE_VERSION", "77")
    assert verarbeitung._stage_versions()["align"] == "77"

    monkeypatch.setattr(verarbeitung, "TRANSCRIBE_STAGE_VERSION", "88")
    assert verarbeitung._stage_versions()["transcribe"] == "88"


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


def test_sections_beschreiben_laeufe_gleicher_messbarkeit():
    """Zusammenhaengend gemessene Strecken bilden Abschnitte mit mittlerem
    Score, interpolierte Laeufe bekommen confidence 0 - so sieht der
    Nutzer, welchen Teilen des Songs zu trauen ist."""
    import ultrastar_pipeline.__main__ as haupt
    from ultrastar_pipeline.notes import AlignedWord

    woerter = [
        AlignedWord("a", 0.0, 0.5, 0.4, 0, quelle="anchor"),
        AlignedWord("b", 0.5, 1.0, 0.2, 0, quelle="realign"),
        AlignedWord("c", 1.0, 1.5, 0.0, 0, quelle="interpolated"),
        AlignedWord("d", 1.5, 2.0, 0.6, 0, quelle="fuzzy"),
        AlignedWord("e", 2.0, 2.5, 0.0, 0, quelle="interpolated"),
    ]
    wort_zu_note = [0, 1, 2, 3, 4, 5]
    sections = haupt._baue_sections(woerter, wort_zu_note)
    assert sections == [
        {"fromNoteIndex": 0, "toNoteIndex": 2, "confidence": pytest.approx(0.3), "anchoredBothSides": True},
        {"fromNoteIndex": 2, "toNoteIndex": 3, "confidence": 0.0, "anchoredBothSides": True},
        {"fromNoteIndex": 3, "toNoteIndex": 4, "confidence": pytest.approx(0.6), "anchoredBothSides": True},
        # Interpolierter Lauf am Songende: nur einseitig begrenzt.
        {"fromNoteIndex": 4, "toNoteIndex": 5, "confidence": 0.0, "anchoredBothSides": False},
    ]


def test_sections_ueberspringen_notenlose_laeufe():
    """Ein Wort mit 0 Silben dupliziert seinen Notenindex in wort_zu_note
    (siehe notes.py). Ein Lauf, der nur aus solchen Woertern besteht, haette
    fromNoteIndex == toNoteIndex - kein Notenbereich, den eine Section
    beschreiben koennte, und songData.ts lehnt das ab. Hier ist Wort 'b'
    (isoliert durch den Quellenwechsel auf beiden Seiten) notenlos."""
    import ultrastar_pipeline.__main__ as haupt
    from ultrastar_pipeline.notes import AlignedWord

    woerter = [
        AlignedWord("a", 0.0, 0.5, 0.4, 0, quelle="anchor"),
        AlignedWord("b", 0.5, 0.5, 0.0, 0, quelle="interpolated"),
        AlignedWord("c", 0.5, 1.0, 0.4, 0, quelle="anchor"),
    ]
    wort_zu_note = [0, 1, 1, 2]
    sections = haupt._baue_sections(woerter, wort_zu_note)
    assert sections == [
        {"fromNoteIndex": 0, "toNoteIndex": 1, "confidence": pytest.approx(0.4), "anchoredBothSides": True},
        {"fromNoteIndex": 1, "toNoteIndex": 2, "confidence": pytest.approx(0.4), "anchoredBothSides": True},
    ]
    # Keine Section beschreibt einen leeren Notenbereich.
    assert all(s["fromNoteIndex"] != s["toNoteIndex"] for s in sections)


def test_lrc_wird_bei_zu_vielen_konflikten_verworfen():
    """Ein .lrc, das fast allen Messungen widerspricht, ist vermutlich die
    falsche Edition - dann darf es keinen einzigen Anker kosten."""
    import ultrastar_pipeline.__main__ as haupt
    from ultrastar_pipeline.anchors import GemessenesWort

    zeilen = [f"w{i}" for i in range(10)]
    lrc_text = "\n".join(f"[00:1{i}.00]w{i}" for i in range(10))
    anker: list = [GemessenesWort(100.0 + i, 100.2 + i, 0.9, "anchor") for i in range(10)]
    anker_vorher = list(anker)
    warnungen: list[str] = []

    haupt._wende_lrc_an(anker, zeilen, lrc_text, 200.0, warnungen)

    assert anker == anker_vorher
    assert len(warnungen) == 1
    assert warnungen[0].startswith("LRC verworfen")


def test_lrc_wird_bei_wenigen_konflikten_angewendet():
    """Passt das .lrc ueberwiegend zu den Messungen, wird es normal
    angewendet: entlarven bei Ausreissern, saeen in den Luecken."""
    import ultrastar_pipeline.__main__ as haupt
    from ultrastar_pipeline.anchors import GemessenesWort

    zeilen = [f"w{i}" for i in range(10)]
    lrc_text = "\n".join(f"[00:1{i}.00]w{i}" for i in range(10))
    anker: list = [GemessenesWort(10.0 + i, 10.2 + i, 0.9, "anchor") for i in range(10)]
    anker[5] = None
    warnungen: list[str] = []

    haupt._wende_lrc_an(anker, zeilen, lrc_text, 200.0, warnungen)

    assert anker[5] is not None
    assert anker[5].quelle == "lrc"
    assert len(warnungen) == 1
    assert warnungen[0].startswith("LRC:")


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
    assert daten["schemaVersion"] == 2
    assert len(daten["notes"]) > 0
