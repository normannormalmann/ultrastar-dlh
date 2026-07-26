import json

from ultrastar_pipeline.progress import (
    ERROR_PREFIX,
    PROGRESS_PREFIX,
    emit_error,
    emit_progress,
)


def test_progress_hat_marker_und_json(capsys):
    emit_progress("separate", 0.4)
    zeile = capsys.readouterr().out.strip()
    assert zeile.startswith(PROGRESS_PREFIX)
    assert json.loads(zeile[len(PROGRESS_PREFIX):]) == {"stage": "separate", "percent": 0.4}


def test_progress_begrenzt_auf_null_bis_eins(capsys):
    emit_progress("align", 1.7)
    zeile = capsys.readouterr().out.strip()
    assert json.loads(zeile[len(PROGRESS_PREFIX):])["percent"] == 1.0


def test_error_hat_marker_und_kind(capsys):
    emit_error("language_unsupported", language="is")
    zeile = capsys.readouterr().out.strip()
    assert zeile.startswith(ERROR_PREFIX)
    assert json.loads(zeile[len(ERROR_PREFIX):]) == {
        "kind": "language_unsupported",
        "language": "is",
    }


def test_json_ist_einzeilig(capsys):
    emit_error("alignment_failed", detail="mehrere\nZeilen")
    assert capsys.readouterr().out.count("\n") == 1
