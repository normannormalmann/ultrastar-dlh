import pytest

from ultrastar_pipeline import modelle


@pytest.fixture(autouse=True)
def frische_modell_caches():
    """Globales autouse Fixture: leert die Modell-Caches vor jedem Test.

    Dies ist notwendig, weil die Tests Modelle via sys.modules mocken, und
    die Caches in modelle.py zwischen Tests bestehen bleiben. Ohne Clearing
    koennen Tests sich gegenseitig beeinflussen, indem sie cached Modelle
    treffen, die mit einem anderen Mock geladen wurden."""
    modelle.leere_caches()
    yield
    modelle.leere_caches()
