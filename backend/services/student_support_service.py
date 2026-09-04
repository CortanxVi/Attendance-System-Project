import io
import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from core.config import (
    MAX_IMAGE_HEIGHT,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_WIDTH,
    SUPPORT_ATTACHMENT_MAX_BYTES,
    supabase_db as supabase,
)


ALLOWED_IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
}
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}
PDF_ACTIVE_CONTENT_MARKERS = (
    b"/JavaScript",
    b"/JS",
    b"/Launch",
    b"/EmbeddedFile",
    b"/RichMedia",
)


@dataclass(frozen=True)
class ValidatedSupportAttachment:
    content: bytes
    content_type: str
    extension: str
    original_name: str


def safe_original_name(filename: str | None) -> str:
    cleaned = Path((filename or "attachment").replace("\\", "/")).name
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", cleaned).strip()
    return (cleaned or "attachment")[:255]


def inline_content_disposition(filename: str | None) -> str:
    """Build a header-safe disposition while preserving UTF-8 display names."""
    original = safe_original_name(filename)
    fallback = re.sub(r"[^A-Za-z0-9._-]", "_", original).strip("._") or "attachment"
    return f"inline; filename=\"{fallback[:120]}\"; filename*=UTF-8''{quote(original, safe='')}"


async def read_validated_support_attachment(
    upload: UploadFile,
) -> ValidatedSupportAttachment:
    claimed_type = (upload.content_type or "").lower()
    if claimed_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="รองรับเฉพาะไฟล์ JPEG, PNG, WebP และ PDF",
        )

    content = await upload.read(SUPPORT_ATTACHMENT_MAX_BYTES + 1)
    await upload.close()
    if not content:
        raise HTTPException(status_code=400, detail="ไฟล์แนบว่างเปล่า")
    if len(content) > SUPPORT_ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="ไฟล์แนบต้องมีขนาดไม่เกิน 10 MB")

    if claimed_type == "application/pdf":
        if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
            raise HTTPException(status_code=400, detail="ไฟล์ PDF เสียหรือรูปแบบไม่ถูกต้อง")
        if any(marker in content for marker in PDF_ACTIVE_CONTENT_MARKERS):
            raise HTTPException(
                status_code=400,
                detail="ไม่รองรับ PDF ที่มีสคริปต์ ไฟล์ฝัง หรือคำสั่งเปิดโปรแกรม",
            )
        detected_type, extension = "application/pdf", ".pdf"
    else:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as image:
                    width, height = image.size
                    if (
                        width > MAX_IMAGE_WIDTH
                        or height > MAX_IMAGE_HEIGHT
                        or width * height > MAX_IMAGE_PIXELS
                    ):
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                "รูปภาพมีความละเอียดสูงเกินกำหนด "
                                f"(สูงสุด {MAX_IMAGE_WIDTH}x{MAX_IMAGE_HEIGHT} และ "
                                f"{MAX_IMAGE_PIXELS:,} พิกเซล)"
                            ),
                        )
                    image.verify()
                    detected = ALLOWED_IMAGE_FORMATS.get(image.format or "")
        except HTTPException:
            raise
        except (
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            UnidentifiedImageError,
            OSError,
            ValueError,
        ):
            detected = None
        if detected is None:
            raise HTTPException(status_code=400, detail="ไฟล์รูปภาพเสียหรือรูปแบบไม่ถูกต้อง")
        detected_type, extension = detected
        if claimed_type != detected_type:
            raise HTTPException(status_code=400, detail="ชนิดไฟล์ไม่ตรงกับข้อมูลจริงภายในไฟล์")

    return ValidatedSupportAttachment(
        content=content,
        content_type=detected_type,
        extension=extension,
        original_name=safe_original_name(upload.filename),
    )


def collect_support_storage_paths(*, course_id: str | None = None, user_id: str | None = None) -> list[str]:
    """Capture private object paths before a parent row is cascade-deleted."""
    if bool(course_id) == bool(user_id):
        return []

    def fetch_pages(query_factory, page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        offset = 0
        while True:
            page = query_factory().range(offset, offset + page_size - 1).execute().data or []
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += page_size

    def request_query():
        query = supabase.table("student_support_requests").select("id").order("id")
        if course_id:
            return query.eq("course_id", course_id)
        return query.or_(f"student_id.eq.{user_id},teacher_id.eq.{user_id}")

    request_ids = [row["id"] for row in fetch_pages(request_query)]
    if not request_ids:
        return []

    message_ids: list[str] = []
    for chunk_offset in range(0, len(request_ids), 100):
        request_chunk = request_ids[chunk_offset:chunk_offset + 100]
        rows = fetch_pages(
            lambda chunk=request_chunk: supabase.table("student_support_messages")
            .select("id")
            .in_("request_id", chunk)
            .order("id")
        )
        message_ids.extend(row["id"] for row in rows)
    if not message_ids:
        return []

    paths: list[str] = []
    for chunk_offset in range(0, len(message_ids), 100):
        message_chunk = message_ids[chunk_offset:chunk_offset + 100]
        rows = fetch_pages(
            lambda chunk=message_chunk: supabase.table("student_support_attachments")
            .select("storage_path")
            .in_("message_id", chunk)
            .order("id")
        )
        paths.extend(row["storage_path"] for row in rows)
    return paths


def remove_support_storage_paths(paths: list[str]) -> None:
    """Remove already-detached private objects in bounded batches."""
    for offset in range(0, len(paths), 100):
        supabase.storage.from_("student-request-files").remove(paths[offset:offset + 100])
