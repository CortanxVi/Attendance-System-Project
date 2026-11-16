"""Measured values for liveness failures (developer aid, OFF in every deployment).

Every Backend check that rejects a scan has its own short code. When ``SHOW_MEASUREMENTS`` is
True the rejection message ends with ``[รหัส <code> · <measured value> (เกณฑ์ <limit>) · ...]``.
It is a code constant, not a setting: deployments cannot switch it on, and users only see the
plain Thai instruction. Unit tests patch it to check the measured values.

The suffix carries numbers only (scores, ratios, angles proxies, counts). It never contains
images, embeddings, names, e-mail addresses or student ids.
"""

from __future__ import annotations

import re


# Never True in a release; unit tests patch it (see tests/test_failure_diagnostics.py).
SHOW_MEASUREMENTS = False
MAX_REASON_CHARS = 500
_CODE_PATTERN = re.compile(r"\[รหัส ([a-z0-9_]{1,36})")


def diagnostic(code: str, *measurements: str) -> str:
    """Return the measurement suffix for a failed check, or an empty string (always in releases)."""

    if not SHOW_MEASUREMENTS:
        return ""
    parts = " · ".join(measurements)
    return f" [รหัส {code}" + (f" · {parts}" if parts else "") + "]"


def failure_code(text: str | None) -> str | None:
    """Read the check code back from a message that carries a measurement suffix."""

    match = _CODE_PATTERN.search(text or "")
    return match.group(1) if match else None


def limit(value: float, low: float | None = None, high: float | None = None, *, signed: bool = False) -> str:
    """Format `value (เกณฑ์ ...)` consistently, e.g. `1.06 (เกณฑ์ 1.08–1.70)`."""

    shown = f"{value:+.2f}" if signed else f"{value:.2f}"
    if low is not None and high is not None:
        return f"{shown} (เกณฑ์ {low:.2f}–{high:.2f})"
    if high is not None:
        return f"{shown} (เกณฑ์ ≤{high:.2f})"
    if low is not None:
        return f"{shown} (เกณฑ์ ≥{low:.2f})"
    return shown
