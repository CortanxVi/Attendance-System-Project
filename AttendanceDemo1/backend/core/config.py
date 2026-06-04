import os
from supabase import create_client, Client

# สามารถใส่เป็น String ตรงๆ เพื่อทดสอบ หรือดึงจาก Environment Variables ก็ได้
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://asoemgblublaozvqtupe.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzb2VtZ2JsdWJsYW96dnF0dXBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MDQ3MTUsImV4cCI6MjA5NTA4MDcxNX0.Fv-e9xxy_y7oHB4YTt1zdUHieOs6OpTvw1TJwTHtYBY")

# สร้างตัวเชื่อมต่อ Supabase
supabase_db: Client = create_client(SUPABASE_URL, SUPABASE_KEY)