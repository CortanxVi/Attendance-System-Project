"""Measured values for liveness failures, shown only in test mode.

Every Backend check that rejects a scan has its own short code. In test mode the rejection
message ends with ``[รหัส <code> · <measured value> (เกณฑ์ <limit>) · ...]`` so the failure
table (``face_checkin_attempts``) shows which condition failed and by how much. In normal mode
the suffix is empty: users only see the plain Thai instruction.

The suffix carries numbers only (scores, ratios, angles proxies, counts). It never contains
images, embeddings, names, e-mail addresses or student ids.
"""

from __future__ import annotations

import re

from core.config import ATTENDANCE_TEST_MODE

MAX_REASON_CHARS = 500
_CODE_PATTERN = re.compile(r"\[รหัส ([a-z0-9_]{1,36})")


def diagnostic(code: str, *measurements: str) -> str:
    """Return the test-mode suffix for a failed check, or an empty string outside test mode."""

    if not ATTENDANCE_TEST_MODE:
        return ""
    parts = " · ".join(measurements)
    return f" [รหัส {code}" + (f" · {parts}" if parts else "") + "]"


def failure_code(text: str | None) -> str | None:
    """Read the check code back from a test-mode message, if it carries one."""

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
