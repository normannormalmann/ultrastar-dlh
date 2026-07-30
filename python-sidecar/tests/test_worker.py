import io
import json
import sys
from pathlib import Path

import ultrastar_pipeline.worker as worker
import ultrastar_pipeline.__main__ as haupt
from ultrastar_pipeline.worker import JOB_PREFIX, READY_MARKER


def _job(job_id: str, **extra) -> str:
    basis = {
        "id": job_id,
        "audio": "a.wav",
        "lyricsFile": "l.txt",
        "language": "de",
        "out": "o.json",
    }
    basis.update(extra)
    return json.dumps(basis)


def _job_zeilen(ausgabe: str) -> list[dict]:
    return [
        json.loads(z[len(JOB_PREFIX):])
        for z in ausgabe.splitlines()
        if z.startswith(JOB_PREFIX)
    ]


def test_ready_kommt_vor_dem_ersten_job(monkeypatch, capsys):
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: 0)
    rc = worker.run_worker(io.StringIO(_job("j1") + "\n"))
    zeilen = capsys.readouterr().out.splitlines()
    assert rc == 0
    assert zeilen[0] == READY_MARKER
    assert _job_zeilen("\n".join(zeilen)) == [{"id": "j1", "ok": True}]


def test_fehlgeschlagener_auftrag_meldet_ok_false_und_der_worker_lebt_weiter(
    monkeypatch, capsys
):
    ergebnisse = iter([1, 0])
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: next(ergebnisse))
    rc = worker.run_worker(io.StringIO(_job("schlecht") + "\n" + _job("gut") + "\n"))
    assert rc == 0
    assert _job_zeilen(capsys.readouterr().out) == [
        {"id": "schlecht", "ok": False},
        {"id": "gut", "ok": True},
    ]


def test_defekte_zeile_toetet_den_worker_nicht(monkeypatch, capsys):
    monkeypatch.setattr(worker, "verarbeite_auftrag", lambda auftrag: 0)
    rc = worker.run_worker(io.StringIO("kein json\n" + _job("j2") + "\n"))
    aus = capsys.readouterr().out
    assert rc == 0
    assert "@@ERROR" in aus
    assert _job_zeilen(aus) == [{"id": "j2", "ok": True}]


def test_feldabbildung_bis_in_den_auftrag(monkeypatch, capsys):
    gesehen: list = []
    monkeypatch.setattr(
        worker, "verarbeite_auftrag", lambda auftrag: gesehen.append(auftrag) or 0
    )
    zeile = _job(
        "j3", bpm=120.5, syncedLyrics="s.lrc", workDir="cache", device="cpu"
    )
    worker.run_worker(io.StringIO(zeile + "\n"))
    a = gesehen[0]
    assert a.audio == Path("a.wav")
    assert a.lyrics_file == Path("l.txt")
    assert a.language == "de"
    assert a.out == Path("o.json")
    assert a.bpm == 120.5
    assert a.synced_lyrics == Path("s.lrc")
    assert a.work_dir == Path("cache")
    assert a.device == "cpu"


def test_cli_flag_startet_den_worker_ohne_language_und_out(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    rc = haupt.main(["--worker"])
    assert rc == 0
    assert READY_MARKER in capsys.readouterr().out


def test_cli_ohne_worker_verlangt_language_und_out(capsys):
    import pytest

    with pytest.raises(SystemExit) as ausgang:
        haupt.main([])
    assert ausgang.value.code == 2
