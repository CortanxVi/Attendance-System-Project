-- 1. เปิดการใช้งาน extension pgvector สำหรับเก็บและวิเคราะห์เวกเตอร์ใบหน้า
create extension if not exists vector;

-- 2. สร้างตารางและล้างข้อมูลเก่าถ้ามี (สำหรับรันเริ่มต้น)
drop table if exists attendance_records cascade;
drop table if exists attendance_sessions cascade;
drop table if exists face_embeddings cascade;
drop table if exists sections cascade;
drop table if exists courses cascade;
drop table if exists users cascade;

-- 3. ตารางผู้ใช้งาน (Users)
create table users (
  id uuid references auth.users on delete cascade primary key,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('student', 'lecturer', 'admin')),
  student_id text unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- เงื่อนไขความปลอดภัย: นักศึกษาต้องล็อกอินด้วยอีเมล มจพ. เท่านั้น
  constraint check_kmutnb_email check (
    (role = 'student' and email ~* '^[A-Za-z0-9._%+-]+@((email\.)?kmutnb\.ac\.th)$')
    or
    (role != 'student')
  )
);

-- 4. ตารางวิชาเรียน (Courses)
create table courses (
  id uuid default gen_random_uuid() primary key,
  code varchar(20) unique not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. ตารางตอนเรียน/เซกชัน (Sections)
create table sections (
  id uuid default gen_random_uuid() primary key,
  course_id uuid references courses(id) on delete cascade not null,
  number integer not null,
  room_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- ห้ามซ้ำวิชาเรียนและเซกชันเดียวกัน
  unique(course_id, number)
);

-- 6. ตารางจัดเก็บ Face Embedding เวกเตอร์ใบหน้าขนาด 128 มิติ
create table face_embeddings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade unique not null,
  embedding vector(128) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. ตารางคาบเรียนที่เปิดเช็คชื่อ (Attendance Sessions)
create table attendance_sessions (
  id uuid default gen_random_uuid() primary key,
  section_id uuid references sections(id) on delete cascade not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  is_active boolean default true not null,
  qr_secret text not null, -- คีย์สำหรับรหัส Dynamic QR Code (TOTP)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. ตารางบันทึกประวัติการเช็คชื่อเข้าเรียน (Attendance Records)
create table attendance_records (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references attendance_sessions(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  status text not null check (status in ('present', 'late', 'absent')),
  check_in_time timestamp with time zone default timezone('utc'::text, now()) not null,
  distance_meters double precision, -- ระยะห่างที่คำนวณได้จริงจาก GPS
  
  -- ห้ามเช็คชื่อซ้ำคาบเรียนเดียวกันสำหรับผู้เรียนแต่ละคน
  unique(session_id, user_id)
);

-- 9. สร้างฟังก์ชันและสปอตสำหรับการตรวจวัดการจับคู่ใบหน้า (Face Verification)
-- ตรวจสอบเปรียบเทียบระยะเวกเตอร์ของรหัสผู้ใช้ที่ล็อกอิน (1-to-1 Matching)
create or replace function verify_student_face(
  target_user_id uuid,
  input_embedding vector(128),
  match_threshold double precision
)
returns table (
  is_match boolean,
  distance double precision
) 
language plpgsql
as $$
declare
  calculated_distance double precision;
begin
  -- คำนวณหาค่า Cosine Distance (<=>) ระหว่างเวกเตอร์ใบหน้าที่ส่งมา กับเวกเตอร์ที่บันทึกไว้ในระบบ
  select (fe.embedding <=> input_embedding) into calculated_distance
  from face_embeddings fe
  where fe.user_id = target_user_id;

  if calculated_distance is not null and calculated_distance < match_threshold then
    return query select true, calculated_distance;
  else
    return query select false, calculated_distance;
  end if;
end;
$$;
