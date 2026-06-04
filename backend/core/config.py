import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Config สำหรับการเชื่อมต่อ Supabase (ให้ขอ key กับ team lead ja)
load_dotenv("backend/.env")
supabase_url = os.getenv("SUPABASE_URL")
supabase_rkey = os.getenv("SUPABASE_KEY")

# สร้างตัวเชื่อมต่อ Supabase
supabase_db: Client = create_client(supabase_url, supabase_rkey)