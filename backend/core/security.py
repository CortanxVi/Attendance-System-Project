from collections.abc import Callable
import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from core.config import supabase_db
from services.temporary_admin_service import extract_verified_session_id, load_valid_grant


class AuthenticatedUser(BaseModel):
    """Server-verified identity and authorization data for one request."""

    id: str
    email: str | None = None
    role: str
    student_id: str | None = None
    full_name: str | None = None
    academic_year: int | None = None
    class_level: str | None = None
    base_role: str
    temporary_admin: bool = False
    temporary_admin_expires_at: str | None = None
    auth_session_id: str = Field(exclude=True)


bearer_scheme = HTTPBearer(auto_error=False)
KMUTNB_EMAIL_PATTERN = re.compile(r"^[^@]+@(?:[a-z0-9-]+\.)*kmutnb\.ac\.th$", re.IGNORECASE)


def is_allowed_kmutnb_email(email: str | None) -> bool:
    return bool(email and KMUTNB_EMAIL_PATTERN.fullmatch(email.strip()))


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    admin_grant: Annotated[str | None, Header(alias="X-Admin-Grant")] = None,
) -> AuthenticatedUser:
    """Validate a Supabase access token and load its current role server-side."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="กรุณาเข้าสู่ระบบก่อนใช้งาน",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        auth_response = await run_in_threadpool(
            supabase_db.auth.get_user,
            credentials.credentials,
        )
        auth_user = auth_response.user if auth_response else None
    except Exception:
        auth_user = None

    if auth_user is None or not auth_user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="เซสชันหมดอายุหรือ access token ไม่ถูกต้อง",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = str(auth_user.id)
    auth_email = getattr(auth_user, "email", None)
    if not is_allowed_kmutnb_email(auth_email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="อนุญาตให้ใช้งานเฉพาะบัญชี KMUTNB เท่านั้น",
        )
    try:
        profile_response = await run_in_threadpool(
            lambda: supabase_db.table("profiles")
            .select("id, student_id, full_name, role, academic_year, class_level")
            .eq("id", user_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้งานจากฐานข้อมูลได้",
        ) from exc

    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="บัญชีนี้ยังไม่มีโปรไฟล์หรือสิทธิ์ใช้งานระบบ",
        )

    profile = profile_response.data[0]
    base_role = profile.get("role")
    if base_role not in {"student", "teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="บัญชีนี้มีสิทธิ์ใช้งานไม่ถูกต้อง",
        )

    auth_session_id = extract_verified_session_id(credentials.credentials)
    effective_role = base_role
    temporary_admin = False
    temporary_admin_expires_at = None
    if base_role == "teacher" and admin_grant:
        grant = await run_in_threadpool(
            load_valid_grant,
            user_id,
            auth_session_id,
            admin_grant,
        )
        if grant:
            effective_role = "admin"
            temporary_admin = True
            temporary_admin_expires_at = grant.get("expires_at")

    return AuthenticatedUser(
        id=user_id,
        email=auth_email,
        role=effective_role,
        base_role=base_role,
        temporary_admin=temporary_admin,
        temporary_admin_expires_at=temporary_admin_expires_at,
        auth_session_id=auth_session_id,
        student_id=profile.get("student_id"),
        full_name=profile.get("full_name"),
        academic_year=profile.get("academic_year"),
        class_level=profile.get("class_level"),
    )


def require_roles(*allowed_roles: str) -> Callable[..., AuthenticatedUser]:
    """Create a FastAPI dependency that enforces one or more database roles."""

    allowed = frozenset(allowed_roles)

    async def role_guard(
        current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    ) -> AuthenticatedUser:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="คุณไม่มีสิทธิ์ดำเนินการนี้",
            )
        return current_user

    return role_guard


async def require_permanent_admin(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> AuthenticatedUser:
    if current_user.base_role != "admin" or current_user.temporary_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="รายการนี้ต้องดำเนินการโดยผู้ดูแลระบบถาวร",
        )
    return current_user
