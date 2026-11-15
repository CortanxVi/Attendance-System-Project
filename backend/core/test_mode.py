"""Opt-in testing shortcut: skip the dynamic QR step and its timers for listed test courses.

This exists only so the face, liveness and PAD models can be exercised repeatedly
during experiments. It is OFF unless every condition below is met, and the
backend refuses to start (fail closed) when the settings are inconsistent:

* ATTENDANCE_TEST_MODE is a true value, and
* ATTENDANCE_TEST_MODE_ACK equals TEST_MODE_ACK_PHRASE exactly, and
* ATTENDANCE_TEST_COURSE_IDS lists at least one course UUID, OR
  ATTENDANCE_TEST_ALL_COURSES_ACK equals ALL_COURSES_ACK_PHRASE, which applies the
  shortcut to EVERY course the student belongs to, real classes included. That
  second form is deliberately a separate, typed acknowledgement so it can never be
  reached by leaving the list empty.

The shortcut never replaces authentication, role checks, course membership checks,
liveness or the face comparison.
Production deployment files must never set these variables (see
scripts/production_preflight.py and backend/tests/test_attendance_test_mode.py).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

# Typed on purpose: switching the mode on has to be a deliberate act.
TEST_MODE_ACK_PHRASE = "REMOVE-QR-AND-TIMERS-FOR-LISTED-TEST-COURSES-ONLY"
ALL_COURSES_ACK_PHRASE = "ALL-COURSES-INCLUDING-REAL-CLASSES-ARE-AFFECTED"
# Lets any well-formed e-mail pass the Backend login gate (the database trigger needs its
# own test_mode_flags switch). Only meaningful together with ATTENDANCE_TEST_MODE.
EXTERNAL_EMAIL_ACK_PHRASE = "ALLOW-ANY-GOOGLE-EMAIL-FOR-TESTING-ONLY"
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
    all_courses: bool = False
    external_email: bool = False


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
    external_ack = (environ.get("ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK") or "").strip()
    if external_ack and external_ack != EXTERNAL_EMAIL_ACK_PHRASE:
        raise RuntimeError("ATTENDANCE_TEST_EXTERNAL_EMAIL_ACK must be the exact acknowledgement phrase")
    external_email = bool(external_ack)
    course_ids = _parse_course_ids(environ.get("ATTENDANCE_TEST_COURSE_IDS") or "")
    all_courses_ack = (environ.get("ATTENDANCE_TEST_ALL_COURSES_ACK") or "").strip()
    if all_courses_ack:
        if all_courses_ack != ALL_COURSES_ACK_PHRASE:
            raise RuntimeError("ATTENDANCE_TEST_ALL_COURSES_ACK must be the exact acknowledgement phrase")
        if course_ids:
            raise RuntimeError(
                "Use either ATTENDANCE_TEST_COURSE_IDS or ATTENDANCE_TEST_ALL_COURSES_ACK, not both"
            )
        return QrTimerBypassSettings(
            enabled=True, course_ids=frozenset(), all_courses=True, external_email=external_email
        )
    if not course_ids:
        raise RuntimeError(
            "ATTENDANCE_TEST_MODE needs course UUIDs in ATTENDANCE_TEST_COURSE_IDS "
            "or the all-courses acknowledgement"
        )
    return QrTimerBypassSettings(enabled=True, course_ids=course_ids, external_email=external_email)
