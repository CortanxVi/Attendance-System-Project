-- ไฟล์สำหรับนำไปรันใน SQL Editor ของ Supabase
-- เพื่อสร้างตารางบันทึกการเช็คชื่อตามรูปแบบในตัวอย่าง

CREATE TABLE attendance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    student_id UUID NOT NULL,
    status TEXT NOT NULL,
    method TEXT NOT NULL,
    similarity_score FLOAT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- การตั้งค่า RLS (Row Level Security) (ถ้าต้องการเปิดใช้งาน)
-- ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
