import pytest


@pytest.fixture(autouse=True)
def _fresh_observium_cache():
    """Tests stub Observium/RRD per test; never serve another test's cached rows."""
    from app.datasources import observium

    observium.clear_cache()
    yield
    observium.clear_cache()
