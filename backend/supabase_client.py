import os
import urllib.request
import urllib.error
import json
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

def get_student_profile(student_id: str):
    """
    ดึงข้อมูลนักศึกษาจากตาราง profiles ผ่าน Supabase REST API
    โดยไม่ต้องติดตั้งไลบรารี supabase (เพื่อเลี่ยงปัญหา Build Error)
    """
    if not SUPABASE_URL or SUPABASE_URL == "YOUR_SUPABASE_URL":
        raise Exception("ยังไม่ได้กำหนดค่า SUPABASE_URL ในไฟล์ .env")
    if not SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_KEY == "YOUR_SUPABASE_SERVICE_ROLE_KEY":
        raise Exception("ยังไม่ได้กำหนดค่า SUPABASE_SERVICE_KEY ในไฟล์ .env")
        
    # ลบ slash ตัวสุดท้ายออกถ้ามี
    base_url = SUPABASE_URL.rstrip('/')
    
    # Query: SELECT student_id, full_name FROM profiles WHERE student_id = 'xxx' LIMIT 1
    # การใช้ eq. คือ equals
    url = f"{base_url}/rest/v1/profiles?student_id=eq.{student_id}&select=student_id,full_name&limit=1"
    
    req = urllib.request.Request(url)
    req.add_header('apikey', SUPABASE_SERVICE_KEY)
    req.add_header('Authorization', f'Bearer {SUPABASE_SERVICE_KEY}')
    req.add_header('Accept', 'application/json')
    
    try:
        response = urllib.request.urlopen(req)
        data = json.loads(response.read().decode('utf-8'))
        
        # data จะเป็น list เช่น [{"student_id": "123", "full_name": "John"}]
        if data and len(data) > 0:
            return data[0]
        return None
        
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')
        print(f"Supabase HTTPError: {e.code} - {error_msg}")
        raise Exception("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล")
    except Exception as e:
        print(f"Supabase Error: {e}")
        raise Exception("ไม่สามารถตรวจสอบข้อมูลกับระบบได้")
