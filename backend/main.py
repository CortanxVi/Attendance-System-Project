import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# โหลดค่าจากไฟล์ .env
load_dotenv()

# นำเข้าฟังก์ชันจาก ocr_service
from ocr_service import process_ocr
from auth_router import router as auth_router

app = FastAPI(title="Thai-Eng OCR API")

# นำเข้า auth_router
app.include_router(auth_router)

# อนุญาตให้ Frontend (CORS) เรียกใช้งาน API ได้
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ในโปรดักชันควรระบุ Domain จริงแทน "*"
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/ocr")
async def perform_ocr(file: UploadFile = File(...)):
    """
    Endpoint สำหรับรับไฟล์รูปภาพและส่งไปทำ OCR
    """
    # ตรวจสอบชนิดของไฟล์
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="ไฟล์ต้องเป็นรูปภาพเท่านั้น")
    
    try:
        # กำหนดขนาดสูงสุดของไฟล์ (10MB)
        MAX_FILE_SIZE = 10 * 1024 * 1024
        image_bytes = b""
        
        # ทยอยอ่านไฟล์ทีละ 1MB เพื่อป้องกัน RAM เต็ม (DoS Protection)
        while chunk := await file.read(1024 * 1024):
            image_bytes += chunk
            if len(image_bytes) > MAX_FILE_SIZE:
                raise HTTPException(status_code=413, detail="ขนาดไฟล์ใหญ่เกินกำหนด (สูงสุด 10MB)")
        
        # เรียกใช้บริการ OCR เพื่อสกัดข้อความ
        result = process_ocr(image_bytes)
        
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)
