"""Fehlerarten, die mehrere Stufen teilen.

Eigenes Modul statt in align.py, damit kein Importzyklus entsteht: align
wird spaeter von anchors importiert, anchors von transcribe — laege
LanguageUnsupported weiter in align.py, schluege dieser Zyklus beim Import
zur Laufzeit fehl.
"""


class LanguageUnsupported(Exception):
    """Fuer diese Sprache gibt es kein Modell der genannten Stufe."""

    def __init__(self, language: str, stufe: str = "align") -> None:
        super().__init__(f"{stufe}: {language}")
        self.language = language
        self.stufe = stufe
