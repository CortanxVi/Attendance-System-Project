from dataclasses import dataclass
import io
import warnings

import httpx
from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from core.config import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_HEIGHT,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_WIDTH,
    OCR_SERVICE_TOKEN,
    OCR_SERVICE_URL,
    OCR_TIMEOUT_SECONDS,
)


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


@dataclass(frozen=True)
class UploadedImage:
    content: bytes
    filename: str
    content_type: str


async def read_validated_image(upload: UploadFile, label: str) -> UploadedImage:
    content_type = (upload.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"{label} ต้องเป็นไฟล์ JPEG หรือ PNG เท่านั้น",
        )

    content = await upload.read(MAX_IMAGE_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail=f"{label} เป็นไฟล์ว่าง")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} มีขนาดเกิน 8 MB")

    try:
        # Reject dangerous dimensions before any RGB/NumPy materialization.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                detected_format = image.format
                width, height = image.size
                if (
                    width > MAX_IMAGE_WIDTH
                    or height > MAX_IMAGE_HEIGHT
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=(
                            f"{label}มีความละเอียดสูงเกินกำหนด "
                            f"(สูงสุด {MAX_IMAGE_WIDTH}x{MAX_IMAGE_HEIGHT} และ "
                            f"{MAX_IMAGE_PIXELS:,} พิกเซล)"
                        ),
                    )
                image.verify()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"{label}มีความละเอียดสูงเกินกำหนด",
        ) from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail=f"{label} ไม่ใช่ไฟล์ภาพที่ถูกต้อง") from exc
    expected_format = {"image/jpeg": "JPEG", "image/png": "PNG"}[content_type]
    if detected_format != expected_format:
        raise HTTPException(status_code=415, detail=f"ชนิดข้อมูลจริงของ{label}ไม่ตรงกับ Content-Type")

    return UploadedImage(
        content=content,
        filename=upload.filename or "image.jpg",
        content_type=content_type,
    )


async def extract_student_id(image: UploadedImage) -> str:
    """Read a 13-digit student ID using the Node.js Light OCR service only."""

    try:
        async with httpx.AsyncClient(timeout=OCR_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{OCR_SERVICE_URL}/ocr",
                headers={"X-OCR-Service-Token": OCR_SERVICE_TOKEN} if OCR_SERVICE_TOKEN else None,
                files={
                    "image": (
                        image.filename,
                        image.content,
                        image.content_type,
                    )
                },
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ระบบ Light OCR ยังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ",
        ) from exc

    if response.status_code == 413:
        raise HTTPException(status_code=413, detail="ภาพบัตรมีขนาดเกินขีดจำกัดของ Light OCR")
    if response.status_code == 415:
        raise HTTPException(status_code=415, detail="Light OCR ไม่รองรับชนิดไฟล์ภาพนี้")
    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Light OCR ประมวลผลภาพบัตรไม่สำเร็จ กรุณาถ่ายภาพใหม่",
        )

    payload = response.json()
    student_id = payload.get("foundId")
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Light OCR อ่านรหัสนักศึกษา 13 หลักจากบัตรไม่ได้ กรุณาถ่ายให้ชัดและไม่มีแสงสะท้อน",
        )
    return str(student_id)
