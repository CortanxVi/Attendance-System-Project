from datetime import datetime
from zoneinfo import ZoneInfo


MAX_STUDY_YEAR = 8


def normalize_student_id(student_id: str | None) -> str | None:
    """Return a validated KMUTNB 13-digit student number."""
    normalized = student_id.strip() if isinstance(student_id, str) else ""
    return normalized if len(normalized) == 13 and normalized.isdigit() else None


def current_buddhist_year(*, now: datetime | None = None) -> int:
    bangkok_now = now or datetime.now(ZoneInfo("Asia/Bangkok"))
    return bangkok_now.year + 543


def derive_admission_year(
    student_id: str | None,
    *,
    buddhist_year: int | None = None,
    now: datetime | None = None,
) -> int | None:
    """Expand the two-digit admission year in a KMUTNB student number."""
    normalized = normalize_student_id(student_id)
    if normalized is None:
        return None
    reference_year = buddhist_year or current_buddhist_year(now=now)
    admission_year = (reference_year // 100) * 100 + int(normalized[:2])
    if admission_year > reference_year:
        admission_year -= 100
    return admission_year


def derive_study_year(
    student_id: str | None,
    *,
    buddhist_year: int | None = None,
    now: datetime | None = None,
) -> int | None:
    """Derive the current study year from a KMUTNB admission-year prefix."""
    reference_year = buddhist_year or current_buddhist_year(now=now)
    admission_year = derive_admission_year(
        student_id,
        buddhist_year=reference_year,
        now=now,
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
    )
    result["admission_year"] = derive_admission_year(
        result.get("student_id"),
        buddhist_year=buddhist_year,
        now=now,
    )
    result["academic_year_source"] = "student_id"
    return result
