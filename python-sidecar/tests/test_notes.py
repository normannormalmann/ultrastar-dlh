import sys

from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes


def w(text, start, end, line=0, conf=0.9):
    return AlignedWord(text=text, start=start, end=end, confidence=conf, line_index=line)


def flacher_pitch(midi=60.0, bis=10.0):
    """Konstante Tonhoehe, alle 10 ms ein Punkt."""
    return [PitchPoint(time=i / 100, midi=midi, voiced=True) for i in range(int(bis * 100))]


def test_erzeugt_eine_note_pro_silbe():
    noten, _, _ = build_notes([w("Hallo", 1.0, 1.5)], flacher_pitch(), bpm=120, language="de")
    assert [n.syllable for n in noten] == ["Hal", "lo"]


def test_erste_note_beginnt_auf_beat_null_und_setzt_gap():
    noten, _, gap = build_notes([w("Hallo", 2.0, 2.5)], flacher_pitch(), bpm=120, language="de")
    assert noten[0].beat == 0
    assert gap == 2000


def test_noten_sind_zeitlich_aufsteigend():
    words = [w("eins", 1.0, 1.4), w("zwei", 1.5, 1.9), w("drei", 2.0, 2.4)]
    noten, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    beats = [n.beat for n in noten]
    assert beats == sorted(beats)


def test_laenge_ist_mindestens_eins():
    noten, _, _ = build_notes([w("ah", 1.0, 1.005)], flacher_pitch(), bpm=120, language="de")
    assert all(n.length >= 1 for n in noten)


def test_umbruch_zwischen_zeilen():
    words = [w("eins", 1.0, 1.4, line=0), w("zwei", 3.0, 3.4, line=1)]
    noten, umbrueche, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert len(umbrueche) == 1
    assert umbrueche[0].after_note_index == 0
    assert umbrueche[0].beat > noten[0].beat


def test_kein_umbruch_vor_der_ersten_note():
    words = [w("eins", 1.0, 1.4, line=3)]
    _, umbrueche, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert umbrueche == []


def test_tonhoehe_kommt_aus_dem_pitch_verlauf():
    noten, _, _ = build_notes(
        [w("Hallo", 1.0, 1.5)], flacher_pitch(midi=62.0), bpm=120, language="de"
    )
    assert len({n.pitch for n in noten}) == 1
    assert noten[0].pitch == 2  # 62 MIDI - Nullage 60


def test_unvoiced_pitch_faellt_auf_rueckfall_zurueck():
    stumm = [PitchPoint(time=i / 100, midi=0.0, voiced=False) for i in range(1000)]
    noten, _, _ = build_notes([w("Hallo", 1.0, 1.5)], stumm, bpm=120, language="de")
    assert all(isinstance(n.pitch, int) for n in noten)


def test_leere_eingabe_ergibt_keine_noten():
    noten, umbrueche, gap = build_notes([], flacher_pitch(), bpm=120, language="de")
    assert noten == []
    assert umbrueche == []
    assert gap == 0


def test_notes_importiert_keine_modelle():
    """notes.py muss rein bleiben, damit es ohne GPU testbar ist."""
    import ultrastar_pipeline.notes  # noqa: F401

    assert not any(m in sys.modules for m in ("torch", "demucs", "whisperx", "librosa"))
