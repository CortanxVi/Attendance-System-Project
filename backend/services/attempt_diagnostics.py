"""Numbers-only measurements of one face check-in attempt, collected in test mode only.

Phase 2 of TuningModelLog.md needs the measured values of EVERY attempt (passed or failed) so
the thresholds can later be checked against real data (PAD scores, pose deltas, blink ratios,
timing). The checks themselves do not change: they only report what they measured.

How it works
------------
* The attendance endpoint calls ``begin()`` once per request. Outside test mode it returns
  ``None`` and every ``record()`` call is a no-op, so production behaviour is unchanged.
* The checks call ``record(section, values)`` with plain numbers. The collector lives in a
  ``ContextVar``; FastAPI's ``run_in_threadpool`` copies the context into the worker thread, so
  the same (mutable) collector object is reached from the thread that runs the checks, and
  concurrent requests never share one.
* ``snapshot()`` returns a sanitised, size-bounded dict for the ``diagnostics`` jsonb column.

Privacy: only finite numbers, booleans and short lowercase identifiers (``^[a-z0-9_]{1,32}$``)
survive sanitising. Images, embeddings, names, e-mail addresses and ids can never be stored:
free text is dropped, long lists are cut and arrays of embeddings are rejected by the list limit.
"""

from __future__ import annotations

import contextvars
import json
import math
import re
from typing import Any

from core.config import ATTENDANCE_TEST_MODE

SCHEMA_VERSION = 1
# The database check is pg_column_size(diagnostics) <= 4000. Uncompressed jsonb can be up to
# about 1.7x the compact JSON text for arrays of small numbers (a 4-byte entry header plus a
# numeric per value), so the Python bound is half the database limit.
MAX_JSON_BYTES = 2000
MAX_LIST_ITEMS = 8
MAX_DEPTH = 3
MAX_KEYS = 24
_IDENTIFIER = re.compile(r"^[a-z0-9_]{1,32}$")
# Sections dropped first (in this order) when the snapshot would be too large.
_DROP_ORDER = (
    "frame_similarity", "frame_diff", "detect", "client", "pose", "timing", "blink", "move_closer", "pad",
)

_current: contextvars.ContextVar["AttemptDiagnostics | None"] = contextvars.ContextVar(
    "attempt_diagnostics", default=None
)


class AttemptDiagnostics:
    """Mutable per-request store: ``{section: value}``. Not thread-shared across requests."""

    def __init__(self) -> None:
        self.sections: dict[str, Any] = {}

    def record(self, section: str, values: Any) -> None:
        if not _IDENTIFIER.match(section):
            return
        if isinstance(values, dict) and isinstance(self.sections.get(section), dict):
            self.sections[section].update(values)
        else:
            self.sections[section] = values

    def append(self, section: str, item: Any) -> None:
        if not _IDENTIFIER.match(section):
            return
        bucket = self.sections.setdefault(section, [])
        if isinstance(bucket, list) and len(bucket) < MAX_LIST_ITEMS:
            bucket.append(item)

    def snapshot(self) -> dict[str, Any] | None:
        clean = {key: sanitise(value, 1) for key, value in self.sections.items()}
        clean = {key: value for key, value in clean.items() if value is not None}
        if not clean:
            return None
        result: dict[str, Any] = {"v": SCHEMA_VERSION, **clean}
        for section in _DROP_ORDER:
            if json_size(result) <= MAX_JSON_BYTES:
                break
            if section in result:
                result.pop(section)
                result["truncated"] = True
        if json_size(result) > MAX_JSON_BYTES:
            return {"v": SCHEMA_VERSION, "truncated": True}
        return result


def begin() -> AttemptDiagnostics | None:
    """Start a collector for this request (test mode only). Returns it, or None."""

    if not ATTENDANCE_TEST_MODE:
        _current.set(None)
        return None
    collector = AttemptDiagnostics()
    _current.set(collector)
    return collector


def end() -> None:
    _current.set(None)


def current() -> AttemptDiagnostics | None:
    return _current.get()


def record(section: str, values: Any) -> None:
    collector = _current.get()
    if collector is not None:
        collector.record(section, values)


def append(section: str, item: Any) -> None:
    collector = _current.get()
    if collector is not None:
        collector.append(section, item)


def number(value: Any, digits: int = 4) -> float | None:
    """Round a measurement for storage; None for anything that is not a finite number."""

    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return round(result, digits)


def sanitise(value: Any, depth: int) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if abs(value) < 10**12 else None
    if isinstance(value, float):
        return number(value)
    if hasattr(value, "item") and callable(value.item) and getattr(value, "ndim", 1) == 0:
        return sanitise(value.item(), depth)  # numpy scalar
    if isinstance(value, str):
        return value if _IDENTIFIER.match(value) else None
    if depth > MAX_DEPTH:
        return None
    if isinstance(value, (list, tuple)):
        items = [sanitise(item, depth + 1) for item in list(value)[:MAX_LIST_ITEMS]]
        return [item for item in items if item is not None] or None
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in list(value.items())[:MAX_KEYS]:
            if not isinstance(key, str) or not _IDENTIFIER.match(key):
                continue
            clean = sanitise(item, depth + 1)
            if clean is not None:
                out[key] = clean
        return out or None
    return None


def json_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))


def pose_delta(label: str, reference: Any, candidate: Any) -> dict[str, Any]:
    """Pose of `candidate` relative to `reference` (FaceObservation-like), numbers only."""

    return {
        "frame": label,
        "yaw": number(candidate.yaw_proxy - reference.yaw_proxy),
        "pitch": number(candidate.pitch_proxy - reference.pitch_proxy),
        "roll": number(candidate.roll_proxy - reference.roll_proxy),
        "scale": number(candidate.face_width_ratio / max(reference.face_width_ratio, 0.001) - 1),
        "center": number(candidate.center_offset),
        "det": number(candidate.detection_score, 3),
    }


# ---------------------------------------------------------------- client (browser) diagnostics
# The web scanner sends, in test mode only, a small object describing the device it ran on, as
# the optional multipart form field ``client_diagnostics`` (JSON text). Contract:
#   platform: android|ios|desktop|other      browser: chrome|safari|samsung|firefox|edge|inapp|other
#   delegate: gpu|cpu|main|unknown           camera_w, camera_h, frame_errors, warmup_ms: int
#   analysis_fps: number                     luma, sharpness: number or null
#   web_build: int (Unix seconds)            web_commit: int (first 7 hex digits of the commit)
# Outside test mode the field is never parsed. In test mode it is validated strictly: enum values
# outside the whitelist become "other"/"unknown", numbers must be finite (booleans and text are
# dropped) and are clamped to the ranges below, unknown keys are dropped, and the raw text is
# refused above MAX_CLIENT_JSON_BYTES. Nothing here can carry an id, a name or free text.
MAX_CLIENT_JSON_BYTES = 1024
CLIENT_ENUMS: dict[str, tuple[frozenset[str], str]] = {
    "platform": (frozenset({"android", "ios", "desktop", "other"}), "other"),
    "browser": (frozenset({"chrome", "safari", "samsung", "firefox", "edge", "inapp", "other"}), "other"),
    "delegate": (frozenset({"gpu", "cpu", "main", "unknown"}), "unknown"),
}
# key: (low, high, integer?)
CLIENT_NUMBERS: dict[str, tuple[float, float, bool]] = {
    "camera_w": (0, 8192, True),
    "camera_h": (0, 8192, True),
    "analysis_fps": (0, 120, False),
    "luma": (0, 255, False),
    "sharpness": (0, 100000, False),
    "frame_errors": (0, 100000, True),
    "warmup_ms": (0, 600000, True),
    # Which web build sent the attempt: build time (Unix seconds, up to 2100-01-01) and the
    # first 7 hex digits of the git commit as an integer (0..0xFFFFFFF). Numbers only.
    "web_build": (0, 4102444800, True),
    "web_commit": (0, 268435455, True),
}


def _client_number(value: Any, low: float, high: float, integer: bool) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result):
        return None
    result = min(max(result, low), high)
    return int(round(result)) if integer else round(result, 2)


def sanitise_client(raw: Any) -> dict[str, Any] | None:
    """Strict whitelist of the client diagnostics contract (see above). None when nothing is valid."""

    if isinstance(raw, (str, bytes)):
        size = len(raw.encode("utf-8")) if isinstance(raw, str) else len(raw)
        if size > MAX_CLIENT_JSON_BYTES:
            return None
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for key, (allowed, fallback) in CLIENT_ENUMS.items():
        if key in raw:
            value = raw[key]
            out[key] = value if isinstance(value, str) and value in allowed else fallback
    for key, (low, high, integer) in CLIENT_NUMBERS.items():
        clean = _client_number(raw.get(key), low, high, integer)
        if clean is not None:
            out[key] = clean
    return out or None


def record_client(raw: Any) -> None:
    """Store the validated client diagnostics under ``client`` (no-op outside test mode)."""

    collector = _current.get()
    if collector is None or raw is None:
        return
    clean = sanitise_client(raw)
    if clean is not None:
        collector.record("client", clean)
