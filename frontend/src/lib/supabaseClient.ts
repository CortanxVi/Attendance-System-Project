// ตัวเชื่อมต่อตัวแปรหลักไปยัง Supabase
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('กรุณาตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ใน .env.local\n ติดต่อ Team Lead ในการขอ API Keys');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);