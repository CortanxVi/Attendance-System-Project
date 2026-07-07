import pyotp

def generate_totp_secret() -> str:
    """
    สร้างคีย์ลับสุ่ม (Base32) สำหรับใช้ตั้งค่าเซสชัน TOTP
    """
    return pyotp.random_base32()

def generate_current_totp_token(secret: str) -> str:
    """
    สร้างรหัสผ่านใช้ครั้งเดียวตามเวลา (TOTP Token) ปัจจุบันจากคีย์ลับ
    ใช้ฝั่งอาจารย์เพื่อสร้าง Token ใส่ลงใน QR Code
    """
    totp = pyotp.TOTP(secret)
    return totp.now()

def verify_totp_token(secret: str, token: str) -> bool:
    """
    ตรวจสอบความถูกต้องของ Token ที่นักศึกษาส่งมาเทียบกับคีย์ลับของเซสชัน
    อนุญาตให้มีความต่างของเวลาก่อน/หลังได้ 1 คาบเวลา (30 วินาที) เพื่อลดความคลาดเคลื่อนของเวลาของมือถือ
    """
    totp = pyotp.TOTP(secret)
    # valid_window=1 อนุญาตให้อ่านโค้ดย้อนหลังได้ 1 คาบเวลา (30วิ) หรือล่วงหน้าได้ 1 คาบเวลา
    return totp.verify(token, valid_window=1)
