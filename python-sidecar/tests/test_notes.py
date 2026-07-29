from ultrastar_pipeline.notes import AlignedWord, PitchPoint, build_notes


def w(text, start, end, line=0, conf=0.9):
    return AlignedWord(text=text, start=start, end=end, confidence=conf, line_index=line)


def flacher_pitch(midi=60.0, bis=10.0):
    """Konstante Tonhoehe, alle 10 ms ein Punkt."""
    return [PitchPoint(time=i / 100, midi=midi, voiced=True) for i in range(int(bis * 100))]


def test_erzeugt_eine_note_pro_silbe():
    noten, _, _, _ = build_notes([w("Hallo", 1.0, 1.5)], flacher_pitch(), bpm=120, language="de")
    assert [n.syllable for n in noten] == ["Hal", "lo "]


def test_letzte_silbe_eines_wortes_traegt_das_trennzeichen():
    """Nur die letzte Silbe eines Wortes bekommt das trailing space, das im
    UltraStar-Format zum naechsten Wort trennt — fruehere Silben bleiben
    unveraendert."""
    noten, _, _, _ = build_notes([w("Hallo", 1.0, 1.5)], flacher_pitch(), bpm=120, language="de")
    silben = [n.syllable for n in noten]
    assert silben[0] == "Hal"
    assert silben[-1] == "lo "
    assert not silben[0].endswith(" ")


def test_erste_note_beginnt_auf_beat_null_und_setzt_gap():
    """gap ist um die gemessene Onset-Korrektur (60 ms) vorverlegt: 2000 ms
    roher Wortstart -> 1940 ms GAP. Der Beat bleibt bei 0, da die Korrektur
    nur den absoluten Nullpunkt verschiebt, nicht die Beat-Struktur."""
    noten, _, gap, _ = build_notes([w("Hallo", 2.0, 2.5)], flacher_pitch(), bpm=120, language="de")
    assert noten[0].beat == 0
    assert gap == 1940


def test_gap_korrektur_verschiebt_den_nullpunkt_um_60ms():
    """Gemessene Onset-Korrektur (siehe ONSET_KORREKTUR_MS): der rohe
    Wortstart wird um 60 ms vorverlegt, geklemmt auf >= 0."""
    noten_spaet, _, gap_spaet, _ = build_notes(
        [w("Hallo", 1.0, 1.5)], flacher_pitch(), bpm=120, language="de"
    )
    assert gap_spaet == 940
    assert noten_spaet[0].beat == 0

    noten_frueh, _, gap_frueh, _ = build_notes(
        [w("Hallo", 0.02, 0.5)], flacher_pitch(), bpm=120, language="de"
    )
    assert gap_frueh == 0  # Klemme: 20 ms - 60 ms waere negativ
    assert noten_frueh[0].beat == 0


def test_noten_sind_zeitlich_aufsteigend():
    words = [w("eins", 1.0, 1.4), w("zwei", 1.5, 1.9), w("drei", 2.0, 2.4)]
    noten, _, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    beats = [n.beat for n in noten]
    assert beats == sorted(set(beats))  # streng aufsteigend, keine Duplikate


def test_kurzes_mehrsilbiges_wort_erzeugt_keine_ueberlappenden_noten():
    """0.12s auf drei Silben (Ba-na-ne) bei 120 BPM: Beat und Laenge runden
    sonst so, dass zwei Silben auf denselben Beat fallen (ueberlappende
    Noten)."""
    noten, _, _, _ = build_notes(
        [w("Banane", 1.0, 1.12)], flacher_pitch(), bpm=120, language="de"
    )
    beats = [n.beat for n in noten]
    assert beats == sorted(set(beats))
    for i in range(len(noten) - 1):
        assert noten[i].beat + noten[i].length <= noten[i + 1].beat


def test_laenge_ist_mindestens_eins():
    noten, _, _, _ = build_notes([w("ah", 1.0, 1.005)], flacher_pitch(), bpm=120, language="de")
    assert all(n.length >= 1 for n in noten)


def test_umbruch_zwischen_zeilen():
    words = [w("eins", 1.0, 1.4, line=0), w("zwei", 3.0, 3.4, line=1)]
    noten, umbrueche, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert len(umbrueche) == 1
    assert umbrueche[0].after_note_index == 0
    assert umbrueche[0].beat > noten[0].beat


def test_kein_umbruch_vor_der_ersten_note():
    words = [w("eins", 1.0, 1.4, line=3)]
    _, umbrueche, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert umbrueche == []


def test_leeres_wort_zwischen_zeilen_erzeugt_keinen_doppelten_umbruch():
    """Ein Wort ohne Silben (leerer Text) darf die Zeilen-Buchhaltung nicht
    verschieben — sonst zaehlt der naechste echte Zeilenwechsel gegen eine
    Notenliste, die sich seit dem letzten Umbruch nicht veraendert hat, und
    es entstehen zwei LineBreaks mit demselben after_note_index."""
    words = [
        w("eins", 1.0, 1.4, line=0),
        w("", 2.0, 2.1, line=1),
        w("zwei", 3.0, 3.4, line=2),
    ]
    noten, umbrueche, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert len(umbrueche) == 1
    indizes = [u.after_note_index for u in umbrueche]
    assert len(indizes) == len(set(indizes))


def test_umbruch_beat_liegt_in_der_luecke_zwischen_den_noten():
    """0.12s auf drei Silben (Ba-na-ne) kollidieren vor der Normalisierung;
    ein Wort auf der naechsten Zeile beginnt kurz danach. Der rohe
    Umbruch-Beat stammt aus der unverschobenen Zeit und kann dadurch vor die
    normalisierte vorherige Note fallen — er muss in die Luecke geklemmt
    werden."""
    words = [
        w("Banane", 1.0, 1.12, line=0),
        w("Hallo", 1.13, 1.63, line=1),
    ]
    noten, umbrueche, _, _ = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert len(umbrueche) == 1
    for umbruch in umbrueche:
        i = umbruch.after_note_index
        assert noten[i].beat + noten[i].length <= umbruch.beat <= noten[i + 1].beat


def test_tonhoehe_kommt_aus_dem_pitch_verlauf():
    noten, _, _, _ = build_notes(
        [w("Hallo", 1.0, 1.5)], flacher_pitch(midi=62.0), bpm=120, language="de"
    )
    assert len({n.pitch for n in noten}) == 1
    assert noten[0].pitch == 14  # 62 MIDI - gemessene Nullage 48


def test_unvoiced_pitch_faellt_auf_rueckfall_zurueck():
    stumm = [PitchPoint(time=i / 100, midi=0.0, voiced=False) for i in range(1000)]
    noten, _, _, _ = build_notes([w("Hallo", 1.0, 1.5)], stumm, bpm=120, language="de")
    # Nichts im gesamten Track ist stimmhaft -> globaler Rueckfall ist 0.
    assert all(n.pitch == 0 for n in noten)


def test_leere_eingabe_ergibt_keine_noten():
    noten, umbrueche, gap, wort_zu_note = build_notes([], flacher_pitch(), bpm=120, language="de")
    assert noten == []
    assert umbrueche == []
    assert gap == 0
    assert wort_zu_note == [0]


def test_wort_zu_note_nennt_die_erste_note_je_wort():
    """Ein zweisilbiges und ein einsilbiges Wort: wort_zu_note muss auf den
    Notenindex zeigen, an dem die Silben des jeweiligen Wortes beginnen, mit
    einem abschliessenden Eintrag gleich der Gesamtzahl der Noten."""
    words = [w("Hallo", 1.0, 1.5), w("Welt", 2.0, 2.3)]
    noten, _, _, wort_zu_note = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert wort_zu_note == [0, 2, len(noten)]
    assert noten[wort_zu_note[0] : wort_zu_note[1]][0].syllable == "Hal"
    assert noten[wort_zu_note[1] : wort_zu_note[2]][0].syllable == "Welt "


def test_wort_ohne_silben_erzeugt_gleiche_aufeinanderfolgende_eintraege():
    """Ein Wort ohne Silben (leerer Text) erzeugt keine Note; sein Eintrag in
    wort_zu_note muss darum mit dem des naechsten Wortes uebereinstimmen,
    statt eine Luecke oder einen falschen Index zu hinterlassen."""
    words = [w("eins", 1.0, 1.4), w("", 2.0, 2.1), w("zwei", 3.0, 3.4)]
    _, _, _, wort_zu_note = build_notes(words, flacher_pitch(), bpm=120, language="de")
    assert wort_zu_note[1] == wort_zu_note[2]


def test_notes_und_syllables_importieren_keine_modelle():
    """Prueft die Importanweisungen der Quelldateien per AST.

    Ein Vergleich gegen sys.modules waere wertlos: sind die Pakete nicht
    installiert, besteht er, ohne etwas zu beweisen.
    """
    import ast
    from pathlib import Path

    verboten = {"torch", "demucs", "whisperx", "librosa", "swift_f0"}
    paket = Path(__file__).resolve().parent.parent / "ultrastar_pipeline"

    for name in ("notes.py", "syllables.py"):
        baum = ast.parse((paket / name).read_text(encoding="utf8"))
        for knoten in ast.walk(baum):
            if isinstance(knoten, ast.Import):
                wurzeln = {a.name.split(".")[0] for a in knoten.names}
            elif isinstance(knoten, ast.ImportFrom):
                wurzeln = {(knoten.module or "").split(".")[0]}
            else:
                continue
            treffer = wurzeln & verboten
            assert not treffer, f"{name} importiert {treffer}"
