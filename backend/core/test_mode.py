"""Opt-in testing shortcut: skip the dynamic QR step and its timers for listed test courses.

This exists only so the face, liveness and PAD models can be exercised repeatedly
during experiments. It is OFF unless every condition below is met, and the
backend refuses to start (fail closed) when the settings are inconsistent:

* ATTENDANCE_TEST_MODE is a true value, and
* ATTENDANCE_TEST_MODE_ACK equals TEST_MODE_ACK_PHRASE exactly, and
* ATTENDANCE_TEST_COURSE_IDS lists at least one course UUID.

The shortcut is limited to the listed courses and never replaces authentication,
role checks, course membership checks, liveness or the face comparison.
Production deployment files must never set these variables (see
scripts/production_preflight.py and backend/tests/test_attendance_test_mode.py).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

# Typed on purpose: switching the mode on has to be a deliberate act.
TEST_MODE_ACK_PHRASE = "REMOVE-QR-AND-TIMERS-FOR-LISTED-TEST-COURSES-ONLY"
# The challenge lives long enough for a whole experiment session; the database
# only requires expires_at to be later than created_at.
TEST_CHALLENGE_SECONDS = 4 * 60 * 60
MAX_TEST_COURSES = 20

_ON_VALUES = frozenset({"1", "true", "yes", "on"})
_OFF_VALUES = frozenset({"", "0", "false", "no", "off"})


@dataclass(frozen=True)
class QrTimerBypassSettings:
    enabled: bool
    course_ids: frozenset[str]


def _parse_course_ids(raw: str) -> frozenset[str]:
    parts = [part.strip() for part in raw.replace(";", ",").split(",") if part.strip()]
    if len(parts) > MAX_TEST_COURSES:
        raise RuntimeError(f"ATTENDANCE_TEST_COURSE_IDS may list at most {MAX_TEST_COURSES} courses")
    course_ids: set[str] = set()
    for part in parts:
        try:
            course_ids.add(str(UUID(part)))
        except ValueError as exc:
            raise RuntimeError("ATTENDANCE_TEST_COURSE_IDS must contain course UUIDs only") from exc
    return frozenset(course_ids)


def load_test_mode_settings(environ: Mapping[str, str]) -> QrTimerBypassSettings:
    mode = (environ.get("ATTENDANCE_TEST_MODE") or "").strip().lower()
    if mode in _OFF_VALUES:
        return QrTimerBypassSettings(enabled=False, course_ids=frozenset())
    if mode not in _ON_VALUES:
        raise RuntimeError("ATTENDANCE_TEST_MODE must be 1 or 0")
    if (environ.get("ATTENDANCE_TEST_MODE_ACK") or "").strip() != TEST_MODE_ACK_PHRASE:
        raise RuntimeError(
            "ATTENDANCE_TEST_MODE needs ATTENDANCE_TEST_MODE_ACK with the exact acknowledgement phrase"
        )
    course_ids = _parse_course_ids(environ.get("ATTENDANCE_TEST_COURSE_IDS") or "")
    if not course_ids:
        raise RuntimeError("ATTENDANCE_TEST_MODE needs at least one course UUID in ATTENDANCE_TEST_COURSE_IDS")
    return QrTimerBypassSettings(enabled=True, course_ids=course_ids)
