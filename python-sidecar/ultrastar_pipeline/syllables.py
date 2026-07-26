"""Silbentrennung mit Rueckfall.

Fehlt fuer eine Sprache das pyphen-Woerterbuch, wird das ganze Wort als
eine Silbe behandelt. Das ist schlechter singbar, aber immer noch
spielbar — und wird als Warnung nach meta gemeldet.
"""

from functools import lru_cache

try:  # pyphen ist optional, damit reine Tests ohne Modell-Extras laufen
    import pyphen
except ImportError:  # pragma: no cover
    pyphen = None  # type: ignore[assignment]


@lru_cache(maxsize=32)
def _woerterbuch(language: str):
    if pyphen is None:
        return None
    try:
        if not pyphen.language_fallback(language):
            return None
        return pyphen.Pyphen(lang=language)
    except Exception:
        return None


def has_dictionary(language: str) -> bool:
    """Gibt es fuer diese Sprache eine echte Silbentrennung?"""
    return _woerterbuch(language) is not None


def split_syllables(word: str, language: str) -> list[str]:
    """Wort in Silben zerlegen. Die Teile ergeben verlustfrei das Wort."""
    if not word:
        return []
    wb = _woerterbuch(language)
    if wb is None:
        return [word]
    # \x00 als Trennmarke: kommt in Liedtexten nicht vor.
    teile = [t for t in wb.inserted(word, hyphen="\x00").split("\x00") if t]
    return teile or [word]
