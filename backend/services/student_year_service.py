import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

MAX_STUDY_YEAR = 8
# Thai academic year N starts on 1 June of year N (semester 1) and runs until
# 31 May of year N+1 (semester 2 starts in November, April-May is the break).
ACADEMIC_YEAR_START_MONTH = 6

# Student mailbox format: s<13-digit student id>@email.kmutnb.ac.th
STUDENT_EMAIL_PATTERN = re.compile(r"^s?([0-9]{13})@email\.kmutnb\.ac\.th$", re.IGNORECASE)


def normalize_student_id(student_id: str | None) -> str | None:
    """Return a validated KMUTNB 13-digit student number."""
    normalized = student_id.strip() if isinstance(student_id, str) else ""
    return normalized if len(normalized) == 13 and normalized.isdigit() else None


def current_buddhist_year(*, now: datetime | None = None) -> int:
    bangkok_now = now or datetime.now(ZoneInfo("Asia/Bangkok"))
    return bangkok_now.year + 543


def current_academic_year(*, now: datetime | None = None) -> int:
    """Buddhist-era academic year: January-May still belong to the previous year."""
    bangkok_now = now or datetime.now(ZoneInfo("Asia/Bangkok"))
    offset = 543 if bangkok_now.month >= ACADEMIC_YEAR_START_MONTH else 542
    return bangkok_now.year + offset


def student_id_from_email(email: str | None) -> str | None:
    """Cut the 13-digit student id out of s<ID>@email.kmutnb.ac.th (None if it does not match)."""
    match = STUDENT_EMAIL_PATTERN.fullmatch(email.strip()) if isinstance(email, str) else None
    return match.group(1) if match else None


def resolve_student_id(email: str | None, stored_student_id: str | None) -> str | None:
    """Prefer the id cut from the verified e-mail, then fall back to the stored profile id."""
    return student_id_from_email(email) or normalize_student_id(stored_student_id)


def derive_admission_year(
    student_id: str | None,
    *,
    buddhist_year: int | None = None,
    now: datetime | None = None,
    email: str | None = None,
) -> int | None:
    """Expand the two-digit admission year in a KMUTNB student number."""
    normalized = resolve_student_id(email, student_id)
    if normalized is None:
        return None
    reference_year = buddhist_year or current_academic_year(now=now)
    admission_year = (reference_year // 100) * 100 + int(normalized[:2])
    if admission_year > reference_year:
        admission_year -= 100
    return admission_year


def derive_study_year(
    student_id: str | None,
    *,
    buddhist_year: int | None = None,
    now: datetime | None = None,
    email: str | None = None,
) -> int | None:
    """Derive the current study year (1-8) from a KMUTNB admission-year prefix.

    Study year = current academic year - admission year + 1. Results outside
    1..8 return None so the UI shows "cannot calculate" instead of a guess.
    """
    reference_year = buddhist_year or current_academic_year(now=now)
    admission_year = derive_admission_year(
        student_id,
        buddhist_year=reference_year,
        now=now,
        email=email,
    )
    if admission_year is None:
        return None
    study_year = reference_year - admission_year + 1
    return study_year if 1 <= study_year <= MAX_STUDY_YEAR else None


def with_derived_study_year(
    profile: dict,
    *,
    buddhist_year: int | None = None,
    now: datetime | None = None,
) -> dict:
    """Return a response-safe profile copy with one canonical derived year."""
    result = dict(profile)
    result["academic_year"] = derive_study_year(
        result.get("student_id"),
        buddhist_year=buddhist_year,
        now=now,
        email=result.get("email"),
    )
    result["admission_year"] = derive_admission_year(
        result.get("student_id"),
        buddhist_year=buddhist_year,
        now=now,
        email=result.get("email"),
    )
    result["academic_year_source"] = "student_id"
    return result


def sync_stored_study_year(client, profile_id: str, stored_year: int | None, derived_year: int | None) -> bool:
    """Save the derived study year on the student's profile when it differs.

    Best effort: the derived value is always recomputed on read, so a failed
    write is logged and ignored instead of breaking sign-in. Returns True only
    when a write was attempted successfully.
    """
    if derived_year is None or stored_year == derived_year:
        return False
    try:
        (
            client.table("profiles")
            .update({"academic_year": derived_year})
            .eq("id", profile_id)
            .eq("role", "student")
            .execute()
        )
    except Exception:
        logger.warning("Could not store derived study year for a student profile")
        return False
    return True
