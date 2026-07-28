"""Einmalige Probe: liefert ASR auf einer Gesangsspur genug Anker?

Kein Produktionscode. Die Matching-Logik hier ist absichtlich naiv — sie
beantwortet nur die Frage, ob der Entwurf tragfaehig ist.
"""

import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


def normalisiere(wort: str) -> str:
    """Kleinschreibung, Diakritika und Satzzeichen weg — nur fuer Vergleiche."""
    zerlegt = unicodedata.normalize("NFKD", wort.casefold())
    ohne_marken = "".join(z for z in zerlegt if not unicodedata.combining(z))
    return "".join(z for z in ohne_marken if z.isalnum())


def waehle_geraet() -> tuple[str, str]:
    """CUDA nutzen, wenn vorhanden, sonst CPU — beide Pfade gueltig fuer die Probe.

    Die Produktionsstufe wird dieselbe Abfrage treffen; hier vorgezogen, weil
    unbelegt ist, ob diese Maschine eine GPU hat.
    """
    import torch

    if torch.cuda.is_available():
        return "cuda", "float16"
    return "cpu", "int8"


def main() -> int:
    if len(sys.argv) != 4:
        print("Aufruf: probe-ankerausbeute.py <vocals.wav> <lyrics.txt> <sprache>")
        return 2
    vocals, lyrics_pfad, sprache = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

    bekannte = [
        w
        for zeile in lyrics_pfad.read_text(encoding="utf8").splitlines()
        if zeile.strip()
        for w in zeile.split()
    ]

    import whisperx

    geraet, compute_type = waehle_geraet()
    print(f"Geraet:             {geraet} (compute_type={compute_type})")

    modell = whisperx.load_model("large-v2", geraet, compute_type=compute_type)
    ergebnis = modell.transcribe(str(vocals), language=sprache)
    gehoerte = [
        w
        for segment in ergebnis.get("segments", [])
        for w in str(segment.get("text", "")).split()
    ]

    a = [normalisiere(w) for w in bekannte]
    b = [normalisiere(w) for w in gehoerte]
    treffer = sum(
        block.size
        for block in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks()
    )

    print(f"bekannte Woerter:   {len(bekannte)}")
    print(f"gehoerte Woerter:   {len(gehoerte)}")
    print(f"Anker (Teilfolge):  {treffer}")
    print(f"Ausbeute:           {treffer / max(1, len(bekannte)) * 100:.0f}%")
    print(f"Segmente:           {len(ergebnis.get('segments', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
