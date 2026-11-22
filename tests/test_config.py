from datetime import date

from pipeline.config import window


def test_window():
    assert window(date(2026, 11, 22)) == (
        date(2026, 5, 16),
        date(2026, 5, 26),
        date(2026, 11, 21),
    )
