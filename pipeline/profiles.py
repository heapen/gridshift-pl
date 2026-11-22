"""Industrial facility profiles: 24h base-load shape (kW) and flexibility defaults.

This module is the source of truth; ``lib/profiles.ts`` mirrors it and a
parity test checks they stay identical.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

SPRING_SKIPPED_HOUR_INDEX = 2  # local 02:00 does not exist on the spring DST day
FALL_REPEATED_HOUR_INDEX = 2  # local 02:00 occurs twice on the autumn DST day


@dataclass(frozen=True)
class Profile:
    id: str
    name: str
    description: str
    base_kw: tuple[float, ...]  # 24 hourly values, local clock hours 00..23
    flex_pct: float  # default max shiftable share of load per hour (0..1)
    window_h: int  # default max shift distance in hours
    # Contracted capacity ("moc umowna") = factor x peak base load. 1.0 means a
    # shifted schedule may never exceed the site's existing peak, since exceeding
    # contracted capacity is penalised under Polish distribution tariffs.
    capacity_factor: float = 1.0
    # Local clock hours in which load may be moved in or out (None = all hours).
    # Example: an EV fleet can only charge while vehicles are plugged in.
    available_hours: tuple[int, ...] | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["base_kw"] = list(self.base_kw)
        d["available_hours"] = list(self.available_hours) if self.available_hours else None
        return d


PROFILES: dict[str, Profile] = {
    "cold_storage": Profile(
        id="cold_storage",
        name="Cold Storage Warehouse",
        description="Refrigerated logistics hub; thermal inertia allows pre-cooling and deferral.",
        base_kw=(
            780, 770, 760, 760, 760, 770, 790, 820, 850, 880, 900, 920,
            930, 930, 920, 900, 880, 860, 840, 830, 820, 810, 800, 790,
        ),
        flex_pct=0.30,
        window_h=4,
    ),
    "cnc_plant": Profile(
        id="cnc_plant",
        name="CNC Manufacturing Plant",
        description="Two-shift machining plant (06:00-22:00); batch jobs can be re-sequenced.",
        base_kw=(
            320, 300, 300, 300, 310, 600, 1400, 1500, 1520, 1540, 1550, 1500,
            1450, 1520, 1550, 1540, 1500, 1480, 1450, 1420, 1400, 1350, 700, 380,
        ),
        flex_pct=0.20,
        window_h=3,
    ),
    "ev_fleet": Profile(
        id="ev_fleet",
        name="EV Fleet Charging Depot",
        description="Last-mile delivery fleet, plugged in 16:00-07:00; charging can be deferred within the evening and within the early-morning window.",
        base_kw=(
            650, 520, 380, 260, 180, 150, 140, 130, 120, 120, 130, 140,
            150, 160, 180, 250, 450, 800, 1100, 1200, 1200, 1150, 1000, 820,
        ),
        flex_pct=0.70,
        window_h=8,
        available_hours=(0, 1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 22, 23),
    ),
}


def _adjust_for_dst(values: list, n_hours: int) -> list:
    values = list(values)
    if n_hours == 23:
        del values[SPRING_SKIPPED_HOUR_INDEX]
    elif n_hours == 25:
        values.insert(FALL_REPEATED_HOUR_INDEX + 1, values[FALL_REPEATED_HOUR_INDEX])
    elif n_hours != 24:
        raise ValueError(f"Unsupported day length: {n_hours} hours")
    return values


def available_for_day(profile: Profile, n_hours: int) -> np.ndarray:
    """Boolean mask of hours in which load may move, for a 23/24/25-hour day."""
    hours = set(profile.available_hours) if profile.available_hours else set(range(24))
    return np.asarray(_adjust_for_dst([h in hours for h in range(24)], n_hours), dtype=bool)


def base_for_day(profile: Profile, n_hours: int, scale: float = 1.0) -> np.ndarray:
    """Base load for a local day with ``n_hours`` (23, 24 or 25) hours, in kW."""
    return np.asarray(_adjust_for_dst(profile.base_kw, n_hours), dtype=float) * scale
