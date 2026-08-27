import hashlib
import json
import sys
import types
import wave
from pathlib import Path

import pytest

from ultrastar_pipeline import align as align_modul, modellwahl, separate
from ultrastar_pipeline.align import (
    AlignmentFailed,
    LanguageUnsupported,
    align,
    dauer_oder_rueckfall,
    zeilen_zuordnen,
)
from ultrastar_pipeline.cache import atomic_write_bytes, stage_path
from ultrastar_pipeline.notes import AlignedWord


def w(text, i=0):
    """AlignedWord mit Platzhalter-Zeiten; line_index absichtlich falsch (99),
    damit ein Test wirklich prueft, dass zeilen_zuordnen ihn ueberschreibt."""
    return AlignedWord(text=text, start=float(i), end=float(i) + 0.5, confidence=0.9, line_index=99)


def test_exakte_zuordnung_ueber_mehrere_zeilen():
    lines = ["eins zwei", "drei", "vier fuenf sechs"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "drei", "vier", "fuenf", "sechs"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 1, 2, 2, 2]
    # Text und Zeitwerte bleiben unveraendert, nur line_index wird ersetzt.
    assert [e.text for e in ergebnis] == [e.text for e in woerter]
    assert abweichung == 0  # Anzahl stimmt genau ueberein


def test_ueberzaehlige_woerter_fallen_an_die_letzte_zeile():
    lines = ["eins", "zwei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei", "extra1", "extra2"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 1, 1, 1]
    assert abweichung == 2  # zwei Woerter mehr als die Zeilen erwarten liessen


def test_fehlende_woerter_lassen_spaetere_zeilen_leer():
    lines = ["eins", "zwei", "drei"]
    woerter = [w(t, i) for i, t in enumerate(["eins", "zwei"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    # Nur zwei Woerter geliefert: die dritte Zeile bekommt nichts, statt dass
    # etwas erfunden wird.
    assert [e.line_index for e in ergebnis] == [0, 1]
    assert len(ergebnis) == 2
    assert abweichung == -1  # ein Wort weniger als die Zeilen erwarten liessen


def test_einzelne_zeile_bekommt_alle_woerter():
    lines = ["ein einziges wort hier"]
    woerter = [w(t, i) for i, t in enumerate(["ein", "einziges", "wort", "hier"])]
    ergebnis, abweichung = zeilen_zuordnen(woerter, lines)
    assert [e.line_index for e in ergebnis] == [0, 0, 0, 0]
    assert abweichung == 0


def test_leere_wortliste_ergibt_leere_liste():
    ergebnis, abweichung = zeilen_zuordnen([], ["eins", "zwei"])
    assert ergebnis == []
    assert abweichung == -2  # zwei erwartete Woerter, keines geliefert


def _cache_pfad(
    work_dir: Path, audio_hash: str, lines: list[str], anker: list, language: str = "de"
) -> Path:
    text_digest = hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]
    # Die Anker gehen in den Schluessel ein, wie in align() selbst - der
    # Digest muss deshalb genau demselben Verfahren folgen.
    anker_digest = hashlib.sha256(
        json.dumps(
            [None if a is None else [a.start, a.ende, a.score, a.quelle] for a in anker]
        ).encode("utf8")
    ).hexdigest()[:16]
    return stage_path(
        work_dir,
        audio_hash,
        "align",
        {
            "language": language,
            "lines": len(lines),
            "text": text_digest,
            "anker": anker_digest,
            "aligner": modellwahl.ALIGNER,
            "separate_stage_version": separate.STAGE_VERSION,
            "separate_model": separate.MODELL,
        },
        align_modul.STAGE_VERSION,
        ".json",
    )


def test_separate_versionswechsel_invalidiert_den_align_cache(tmp_path, monkeypatch):
    """separate.STAGE_VERSION geht in den align-Cache-Schluessel ein: eine
    geanderte Stimmtrennung darf keine Ausrichtung wiederverwenden, die noch
    auf dem alten Stem beruht. Nachweis: derselbe Cache-Inhalt ist nach dem
    Versionswechsel ein Treffer unter dem alten, aber ein Fehlschlag unter
    dem neuen Pfad.

    Der Fehlschlag wird an einem vorgeschalteten Platzhalter-whisperx
    abgelesen, der jeden Zugriff mitzaehlt. Vorher diente der Importfehler des
    echten Pakets als Beweis - das prueft die Umgebung statt des Caches und
    faellt in dem Moment um, in dem die Modelle wirklich installiert sind.
    """
    lines = ["eins"]
    anker = [None]
    ziel = _cache_pfad(tmp_path, "hashXYZ", lines, anker)
    atomic_write_bytes(
        ziel, json.dumps({"words": [], "warnungen": []}, ensure_ascii=False).encode("utf8")
    )

    zugriffe: list[str] = []

    def load_align_model(language_code: str, device: str):
        zugriffe.append(language_code)
        raise RuntimeError("Platzhalter: dieser Test laedt kein Modell")

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    # Vor dem Versionswechsel: Cache-Treffer, das Modell bleibt unberuehrt.
    assert align(Path("egal.wav"), lines, "de", tmp_path, "hashXYZ", "cpu", [], anker) == []
    assert zugriffe == []

    monkeypatch.setattr(separate, "STAGE_VERSION", "999")
    # Derselbe Cache-Inhalt liegt jetzt unter einem anderen Pfad -> Treffer
    # bleibt aus, der Aligner wird angefasst. Dass daraus LanguageUnsupported
    # wird, ist nur die Huelle des Platzhalter-Fehlers; entscheidend ist der
    # gezaehlte Zugriff.
    with pytest.raises(LanguageUnsupported):
        align(Path("egal.wav"), lines, "de", tmp_path, "hashXYZ", "cpu", [], anker)
    assert zugriffe == ["de"]


def test_anderer_aligner_invalidiert_den_align_cache(tmp_path, monkeypatch):
    """Die Aligner-Identitaet gehoert in den Schluessel, sonst liefert ein
    Vergleichslauf mit einem anderen Aligner still die Zeiten des alten -
    und der A/B-Vergleich zeigt "kein Unterschied", wo keiner gemessen wurde.
    Gleicher Nachweis wie beim Versionswechsel, nur ueber modellwahl.ALIGNER.
    """
    lines = ["eins"]
    anker_liste = [None]
    ziel = _cache_pfad(tmp_path, "hashALG", lines, anker_liste)
    atomic_write_bytes(
        ziel, json.dumps({"words": [], "warnungen": []}, ensure_ascii=False).encode("utf8")
    )

    zugriffe: list[str] = []

    def load_align_model(language_code: str, device: str):
        zugriffe.append(language_code)
        raise RuntimeError("Platzhalter: dieser Test laedt kein Modell")

    platzhalter = types.ModuleType("whisperx")
    platzhalter.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", platzhalter)

    assert align(Path("egal.wav"), lines, "de", tmp_path, "hashALG", "cpu", [], anker_liste) == []
    assert zugriffe == []

    monkeypatch.setattr(modellwahl, "ALIGNER", "ein-anderer-aligner")
    with pytest.raises(LanguageUnsupported):
        align(Path("egal.wav"), lines, "de", tmp_path, "hashALG", "cpu", [], anker_liste)
    assert zugriffe == ["de"]


def test_dauer_oder_rueckfall_liest_die_echte_wav_laenge(tmp_path):
    pfad = tmp_path / "clip.wav"
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(100)
        w.writeframes(b"\x00\x00" * 250)  # 2.5 Sekunden bei 100 Hz
    assert dauer_oder_rueckfall(pfad, 999.0) == pytest.approx(2.5)


def test_dauer_oder_rueckfall_faellt_bei_unlesbarer_datei_auf_den_rueckfall_zurueck(tmp_path):
    pfad = tmp_path / "kaputt.wav"
    pfad.write_bytes(b"kein echtes wav")
    assert dauer_oder_rueckfall(pfad, 4.1) == 4.1


from ultrastar_pipeline.anchors import GemessenesWort
from ultrastar_pipeline.align import (
    WortZeit,
    silbengewicht,
    interpoliere,
    stille_grenzen,
    _ctc_tokens,
    _fasse_zusammen,
    _pruefe_fenster,
    richte_fenster_aus,
)


def test_silbengewicht_zaehlt_vokalgruppen():
    assert silbengewicht("und", "de") == 1
    assert silbengewicht("melodie", "de") == 3
    # Akzentfaltung: Umlaute bleiben Vokale (o-Umlaut -> o).
    # Unicode-Escape waehrt ASCII-Pflicht.
    assert silbengewicht("sch\u00f6n", "de") == 1


def test_silbengewicht_zaehlt_zahlen_wie_gesungen():
    # "20" hat keine Vokale und woege 1; gesungen wird "zwanzig" (2 Gruppen).
    assert silbengewicht("20", "de") == 2


def test_silbengewicht_ist_nie_null():
    assert silbengewicht("pst", "de") == 1


def test_interpoliere_verteilt_nach_silbengewicht():
    """Luecke zwischen zwei Messungen: "melodie" (3 Gruppen) bekommt dreimal
    so viel Zeit wie "und" (1 Gruppe), und vor dem naechsten gemessenen
    Wort bleibt eine Atempause."""
    anker = [
        GemessenesWort(0.0, 1.0, 0.5, "anchor"),
        None,
        None,
        GemessenesWort(9.0, 9.5, 0.5, "anchor"),
    ]
    zeiten = interpoliere(anker, ["start", "und", "melodie", "ende"], "de", 20.0)
    assert [z.quelle for z in zeiten] == ["anchor", "interpolated", "interpolated", "anchor"]
    dauer_und = zeiten[1].ende - zeiten[1].start
    dauer_melodie = zeiten[2].ende - zeiten[2].start
    assert dauer_melodie == pytest.approx(3 * dauer_und)
    assert zeiten[1].start == pytest.approx(1.0)
    # Atempause: das letzte interpolierte Wort endet vor der Messung bei 9.0.
    assert zeiten[2].ende < 9.0
    assert all(z.score == 0.0 for z in zeiten[1:3])


def test_interpoliere_kette_am_ende_bleibt_im_audio():
    """Ohne Deckel liefe die Kette hinter das Songende (im Vorbild gemessen:
    163 Woerter bis 207,6 s bei 199 s Audio) - Noten nach dem Ende sind
    objektiver Muell."""
    anker = [GemessenesWort(9.0, 9.4, 0.5, "anchor")] + [None] * 20
    woerter = ["a"] + ["lalala"] * 20
    zeiten = interpoliere(anker, woerter, "de", 10.0)
    assert zeiten[-1].ende <= 10.0 + 1e-9


def test_interpoliere_kette_am_anfang_endet_an_der_ersten_messung():
    anker = [None, None, GemessenesWort(5.0, 5.4, 0.5, "anchor")]
    zeiten = interpoliere(anker, ["eins", "zwei", "drei"], "de", 20.0)
    assert zeiten[1].ende == pytest.approx(5.0)
    assert zeiten[0].start >= 0.0
    assert zeiten[0].ende == pytest.approx(zeiten[1].start)


def test_interpoliere_ohne_jeden_anker_beginnt_bei_null():
    zeiten = interpoliere([None, None], ["eins", "zwei"], "de", 100.0)
    assert zeiten[0].start == 0.0
    assert all(z.quelle == "interpolated" for z in zeiten)


def test_stille_grenzen_trimmt_raender():
    import numpy as np

    abtastrate = 16000
    rahmen = int(abtastrate * 0.02)
    stille = np.zeros(rahmen * 10, dtype=np.float32)
    ton = np.full(rahmen * 5, 0.5, dtype=np.float32)
    audio = np.concatenate([stille, ton, stille])
    von, bis = stille_grenzen(audio, 0, len(audio))
    # Ein Rahmen Vorlauf bleibt: der Konsonantenansatz hat weniger Energie
    # als der Vokal, gehoert aber zum Wort.
    assert von == rahmen * 9
    assert bis <= rahmen * 16


def test_stille_grenzen_ohne_energie_bleibt_unveraendert():
    import numpy as np

    audio = np.zeros(16000, dtype=np.float32)
    assert stille_grenzen(audio, 100, 8000) == (100, 8000)


def test_ctc_tokens_schreiben_zahlen_aus_und_lassen_rest_stehen():
    assert _ctc_tokens("20", "de") == ["zwanzig"]
    assert _ctc_tokens("Haus,", "de") == ["Haus,"]


def test_fasse_zusammen_vereinigt_expandierte_tokens():
    roh = [
        {"word": "twenty", "start": 1.0, "end": 1.4, "score": 0.5},
        {"word": "one", "start": 1.5, "end": 1.8, "score": 0.3},
    ]
    ergebnis = _fasse_zusammen(roh, [0, 0], 1)
    assert ergebnis is not None
    assert ergebnis[0]["start"] == 1.0
    assert ergebnis[0]["end"] == 1.8
    assert ergebnis[0]["score"] == 0.3


def test_fasse_zusammen_meldet_fehlende_zeitstempel():
    roh = [{"word": "x", "start": None, "end": None}]
    assert _fasse_zusammen(roh, [0], 1) is None


def test_pruefe_fenster_akzeptiert_monotone_zeiten_im_fenster():
    roh = [
        {"word": "a", "start": 1.0, "end": 1.2, "score": 0.4},
        {"word": "b", "start": 1.3, "end": 1.6, "score": 0.2},
    ]
    assert _pruefe_fenster(roh, 0.9, 2.0) == [(1.0, 1.2, 0.4), (1.3, 1.6, 0.2)]


def test_pruefe_fenster_toleriert_das_erste_wort_am_fensterrand():
    """Die dokumentierte Toleranz von 0,5 s gilt auch fuer das erste Wort,
    nicht nur fuer die Monotonie der Folgewoerter."""
    knapp_davor = [{"word": "a", "start": 0.7, "end": 0.9, "score": 0.4}]
    assert _pruefe_fenster(knapp_davor, 1.0, 2.0) == [(0.7, 0.9, 0.4)]
    zu_frueh = [{"word": "a", "start": 0.4, "end": 0.6, "score": 0.4}]
    assert _pruefe_fenster(zu_frueh, 1.0, 2.0) is None


def test_pruefe_fenster_verwirft_ausbrecher_und_rueckwaertslauf():
    ausserhalb = [{"word": "a", "start": 5.0, "end": 5.2, "score": 0.4}]
    assert _pruefe_fenster(ausserhalb, 0.9, 2.0) is None
    rueckwaerts = [
        {"word": "a", "start": 1.5, "end": 1.7, "score": 0.4},
        {"word": "b", "start": 1.0, "end": 1.2, "score": 0.4},
    ]
    assert _pruefe_fenster(rueckwaerts, 0.9, 2.0) is None


def _vierpass_platzhalter(
    align_aufrufe: list, fenster_woerter: list[dict]
) -> types.ModuleType:
    """whisperx-Stub fuer den Vierpass-Weg: 30 s stilles Audio, ein
    vorgegebenes Fensterergebnis."""
    import numpy as np

    modul = types.ModuleType("whisperx")
    modul.load_align_model = lambda **k: ("modell", {"meta": True})
    modul.load_audio = lambda pfad: np.zeros(16000 * 30, dtype=np.float32)

    def align_fn(segmente, modell, metadaten, audio, device,
                 interpolate_method=None, return_char_alignments=False):
        align_aufrufe.append(segmente)
        return {"segments": [{"words": fenster_woerter}]}

    modul.align = align_fn
    return modul


def _drei_woerter_anker() -> list:
    return [
        GemessenesWort(1.0, 1.4, 0.5, "anchor"),
        None,
        GemessenesWort(9.0, 9.4, 0.5, "anchor"),
    ]


def test_align_misst_luecken_im_fenster_zwischen_den_nachbarn(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe, [{"word": "zwei", "start": 4.0, "end": 4.5, "score": 0.2}]
    ))
    warnungen: list[str] = []
    woerter = align(
        Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashG", "cpu",
        warnungen, _drei_woerter_anker(),
    )
    assert [w.quelle for w in woerter] == ["anchor", "realign", "anchor"]
    assert woerter[1].start == 4.0 and woerter[1].confidence == 0.2
    assert warnungen == []
    # Das Fenster liegt zwischen Ende des Vorgaengers und Start des
    # Nachfolgers - nicht ueber der ganzen Spur.
    assert aufrufe[0][0]["start"] >= 1.4 - 1e-9
    assert aufrufe[0][0]["end"] <= 9.0 + 1e-9


def test_align_faellt_bei_ausbrechern_auf_interpolation_zurueck(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe, [{"word": "zwei", "start": 25.0, "end": 25.5, "score": 0.9}]
    ))
    warnungen: list[str] = []
    woerter = align(
        Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashH", "cpu",
        warnungen, _drei_woerter_anker(),
    )
    assert woerter[1].quelle == "interpolated"
    assert woerter[1].confidence == 0.0
    assert 1.4 <= woerter[1].start <= 9.0
    assert len(warnungen) == 1 and "Wort" in warnungen[0]


def test_align_cache_traegt_quelle_und_warnungen(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        [], [{"word": "zwei", "start": 25.0, "end": 25.5, "score": 0.9}]
    ))
    erste: list[str] = []
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashI", "cpu",
          erste, _drei_woerter_anker())

    kaputt = types.ModuleType("whisperx")  # jeder Zugriff waere ein Fehler
    monkeypatch.setitem(sys.modules, "whisperx", kaputt)
    zweite: list[str] = []
    woerter = align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashI",
                    "cpu", zweite, _drei_woerter_anker())
    assert [w.quelle for w in woerter] == ["anchor", "interpolated", "anchor"]
    assert zweite == erste and len(zweite) == 1


def test_geaenderte_anker_invalidieren_den_align_cache(tmp_path, monkeypatch):
    """Die Anker tragen den Einfluss von Transkript und LRC - ein
    geaenderter Anker darf nie eine alte Ausrichtung wiederverwenden."""
    aufrufe: list = []
    stub = _vierpass_platzhalter(aufrufe, [{"word": "zwei", "start": 4.0, "end": 4.5, "score": 0.2}])
    monkeypatch.setitem(sys.modules, "whisperx", stub)
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashJ", "cpu",
          [], _drei_woerter_anker())
    andere = _drei_woerter_anker()
    andere[0] = GemessenesWort(2.0, 2.4, 0.5, "anchor")
    align(Path("egal.wav"), ["eins zwei drei"], "de", tmp_path, "hashJ", "cpu",
          [], andere)
    assert len(aufrufe) == 2


def test_anker_laenge_muss_zur_wortzahl_passen(tmp_path):
    with pytest.raises(AlignmentFailed):
        align(Path("egal.wav"), ["eins zwei"], "de", tmp_path, "hashK", "cpu",
              [], [None])


def test_song_ohne_anker_bekommt_ein_fenster_ueber_die_volle_spur(tmp_path, monkeypatch):
    aufrufe: list = []
    monkeypatch.setitem(sys.modules, "whisperx", _vierpass_platzhalter(
        aufrufe,
        [
            {"word": "eins", "start": 0.5, "end": 1.0, "score": 0.3},
            {"word": "zwei", "start": 1.1, "end": 1.6, "score": 0.3},
        ],
    ))
    woerter = align(Path("egal.wav"), ["eins zwei"], "de", tmp_path, "hashL", "cpu",
                    [], [None, None])
    assert [w.quelle for w in woerter] == ["realign", "realign"]
    assert aufrufe[0][0]["start"] == 0.0
    assert aufrufe[0][0]["end"] == pytest.approx(30.0)
