from dataclasses import dataclass
from collections import defaultdict, deque
import io
from threading import Lock
from time import monotonic
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


class OcrRateLimiter:
    """Process-local fair-use limit for the optional card-reading endpoint."""

    def __init__(self, limit: int = 4, window_seconds: int = 60, max_keys: int = 4096):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, user_id: str) -> None:
        now = monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            if user_id not in self._events and len(self._events) >= self.max_keys:
                stale_keys = [
                    key for key, values in self._events.items()
                    if not values or values[-1] <= cutoff
                ]
                for key in stale_keys:
                    self._events.pop(key, None)
                if len(self._events) >= self.max_keys:
                    oldest_key = min(
                        self._events,
                        key=lambda key: self._events[key][-1] if self._events[key] else float("-inf"),
                    )
                    self._events.pop(oldest_key, None)
            events = self._events[user_id]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                retry_after = max(1, int(events[0] + self.window_seconds - now) + 1)
                raise HTTPException(
                    status_code=429,
                    detail="อ่านบัตรถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
                    headers={"Retry-After": str(retry_after)},
                )
            events.append(now)


student_card_ocr_limiter = OcrRateLimiter()


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
        timeout = httpx.Timeout(
            connect=2.0,
            read=OCR_TIMEOUT_SECONDS,
            write=10.0,
            pool=2.0,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
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
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ยังไม่ได้เปิดบริการ Light OCR กรุณาให้ผู้ดูแลตรวจสอบหน้าต่าง OCR แล้วลองใหม่",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                f"Light OCR ใช้เวลาเกิน {int(OCR_TIMEOUT_SECONDS)} วินาที "
                "กรุณาลองใหม่โดยไม่ต้องสแกน QR ซ้ำ"
            ),
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="การเชื่อมต่อ Light OCR ถูกตัด กรุณาลองใหม่โดยไม่ต้องสแกน QR ซ้ำ",
        ) from exc

    if response.status_code == 413:
        raise HTTPException(status_code=413, detail="ภาพบัตรมีขนาดเกินขีดจำกัดของ Light OCR")
    if response.status_code == 415:
        raise HTTPException(status_code=415, detail="Light OCR ไม่รองรับชนิดไฟล์ภาพนี้")
    if response.status_code == 504:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Light OCR ใช้เวลาเกินกำหนด กรุณาลองใหม่โดยไม่ต้องสแกน QR ซ้ำ",
        )
    if response.status_code == 503:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Light OCR กำลังรองรับผู้ใช้จำนวนมาก กรุณารอสักครู่แล้วลองใหม่โดยไม่ต้องสแกน QR ซ้ำ",
        )
    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Light OCR ประมวลผลภาพบัตรไม่สำเร็จ กรุณาถ่ายภาพใหม่",
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Light OCR ส่งผลลัพธ์ไม่สมบูรณ์ กรุณาลองใหม่",
        ) from exc
    student_id = payload.get("foundId")
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Light OCR อ่านรหัสนักศึกษา 13 หลักจากบัตรไม่ได้ กรุณาถ่ายให้ชัดและไม่มีแสงสะท้อน",
        )
    return str(student_id)
