import os

from ultrastar_pipeline.cache import atomic_write_bytes, audio_fingerprint, stage_path


def test_fingerprint_haengt_am_inhalt_nicht_am_pfad(tmp_path):
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    a.write_bytes(b"identisch")
    b.write_bytes(b"identisch")
    assert audio_fingerprint(a) == audio_fingerprint(b)


def test_fingerprint_aendert_sich_mit_dem_inhalt(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"eins")
    erster = audio_fingerprint(a)
    a.write_bytes(b"zwei")
    assert audio_fingerprint(a) != erster


def test_stage_path_unterscheidet_parameter(tmp_path):
    p1 = stage_path(tmp_path, "abc", "separate", {"model": "htdemucs"}, "1", ".wav")
    p2 = stage_path(tmp_path, "abc", "separate", {"model": "mdx"}, "1", ".wav")
    assert p1 != p2


def test_stage_path_unterscheidet_stufenversion(tmp_path):
    p1 = stage_path(tmp_path, "abc", "align", {}, "1", ".json")
    p2 = stage_path(tmp_path, "abc", "align", {}, "2", ".json")
    assert p1 != p2


def test_stage_path_ist_stabil(tmp_path):
    args = (tmp_path, "abc", "pitch", {"hop": 256}, "1", ".json")
    assert stage_path(*args) == stage_path(*args)


def test_atomic_write_hinterlaesst_keine_temporaerdatei(tmp_path):
    ziel = tmp_path / "unter" / "ergebnis.json"
    atomic_write_bytes(ziel, b"inhalt")
    assert ziel.read_bytes() == b"inhalt"
    assert list(tmp_path.rglob("*.tmp")) == []


def test_gleichzeitige_schreiber_teilen_keine_temporaerdatei(tmp_path, monkeypatch):
    """Zwei Schreiber auf denselben Zielpfad — z. B. zwei Jobs der
    Desktop-Warteschlange ueber derselben Datei — duerfen sich keine
    Tempdatei teilen. Sonst koennte die zweite Schreiboperation Bytes der
    ersten ueberschreiben, bevor deren Umbenennung passiert ist, und das
    Ergebnis waere eine Mischung aus beiden Inhalten statt eines der beiden.

    Ohne echte Threads simuliert: os.replace wird abgefangen, sodass beide
    Tempdateien vollstaendig geschrieben gleichzeitig auf der Platte liegen,
    bevor eine von beiden umbenannt wird. Mit dem alten, geteilten Tempnamen
    haette die zweite Schreiboperation die Tempdatei der ersten ueberschrieben
    — es waere danach nur eine Tempdatei zu finden statt zwei.
    """
    ziel = tmp_path / "ergebnis.json"
    echtes_replace = os.replace
    aufgeschoben: list[tuple[os.PathLike, os.PathLike]] = []
    monkeypatch.setattr(os, "replace", lambda src, dst: aufgeschoben.append((src, dst)))

    atomic_write_bytes(ziel, b"payload-a")
    atomic_write_bytes(ziel, b"payload-b")

    tmp_dateien = list(tmp_path.rglob("*.tmp"))
    assert len(tmp_dateien) == 2, "beide Schreiber muessen eigene Tempdateien haben"
    inhalte = {p.read_bytes() for p in tmp_dateien}
    assert inhalte == {b"payload-a", b"payload-b"}  # keine Vermischung waehrend beide offen sind

    monkeypatch.setattr(os, "replace", echtes_replace)
    for src, dst in aufgeschoben:
        os.replace(src, dst)

    assert ziel.read_bytes() in (b"payload-a", b"payload-b")  # niemals eine Mischung
    assert list(tmp_path.rglob("*.tmp")) == []
