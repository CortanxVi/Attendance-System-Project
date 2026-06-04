import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function Login() {
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      
      // เรียกใช้ระบบเปิดกล่องล็อกอินของ Google ผ่าน Supabase
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // กำหนดให้ Google บังคับเลือกบัญชีเพื่อความชัวร์ในการสลับเมล
          queryParams: {
            prompt: 'select_account',
          },
          // หลังล็อกอินสำเร็จให้เด้งกลับมาที่หน้าเว็บหลักของเรา
          redirectTo: window.location.origin,
        },
      });

      if (error) throw error;
    } catch (error: any) {
      setErrorMessage(error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-2xl shadow-xl border border-gray-100 text-center">
        <div>
          {/* ส่วนหัวข้อและโลโก้จำลอง */}
          <div className="mx-auto h-16 w-16 bg-orange-500 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-orange-200">
            KM
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 tracking-tight">
            ระบบบันทึกเวลาเข้าเรียน
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            สถาบันเทคโนโลยีพระจอมเกล้าพระนครเหนือ
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
            {errorMessage}
          </div>
        )}

        <div className="mt-8">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-all cursor-pointer disabled:opacity-50"
          >
            {/* ไอคอน Google จำลอง */}
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#EA4335"
                d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l3.227-3.107C18.214 2.02 15.54 1 12.24 1 6.162 1 1.24 5.922 1.24 12s4.922 11 11 11c6.344 0 10.556-4.445 10.556-10.74 0-.72-.078-1.27-.174-1.685H12.24z"
              />
            </svg>
            {loading ? 'กำลังเชื่อมต่อ...' : 'เข้าสู่ระบบด้วย Google Account มจพ.'}
          </button>
        </div>

        <div className="text-xs text-gray-500 pt-4 border-t border-gray-100 space-y-1">
          <p>นักศึกษา: @email.kmutnb.ac.th</p>
          <p>อาจารย์/เจ้าหน้าที่: @&lt;dept&gt;.kmutnb.ac.th</p>
        </div>
      </div>
    </div>
  );
}