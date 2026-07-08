import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabaseClient';
import { Clock, Users, XCircle, AlertTriangle } from 'lucide-react';

// 🌟 1. อัปเดต Interface มารับ activeSessionId จากคอมโพเนนต์แม่ (TeacherDashboard)
interface LiveAttendanceProps {
  courseCode?: string;
  activeSessionId: string; // รหัส Session จริงจากตาราง attendance_sessions
  teacherId: string; // 🌟 [เพิ่มใหม่] ต้องส่งมาด้วย เพื่อให้ backend ยืนยันว่าเป็นเจ้าของคาบเรียนนี้ตอนหมุน QR
  onClose?: () => void;
}

export default function LiveAttendance({ courseCode = "CS301", activeSessionId, teacherId, onClose }: LiveAttendanceProps) {
  const [token, setToken] = useState<string>(''); 
  const [countdown, setCountdown] = useState<number>(60);
  const [tokenError, setTokenError] = useState<string | null>(null);
  
  // 🌟 เพิ่ม State สำหรับนับจำนวนนักศึกษาที่เช็คชื่อแล้วแบบ Real-time
  const [attendanceCount, setAttendanceCount] = useState<number>(0);

  // 🌟 2. [แก้ใหม่] เดิมฟังก์ชันนี้สุ่ม token เองฝั่ง browser แล้วเขียนตรงเข้า Supabase ลงคอลัมน์
  // current_token/expires_at ที่ไม่มีอยู่จริงในตาราง (บั๊กเดิม) — ตอนนี้เปลี่ยนไปให้ backend
  // เป็นคนสร้าง token และอัปเดตคอลัมน์ qr_token ที่ถูกต้องแทน ผ่าน endpoint ที่สร้างไว้ใน Step ก่อนหน้า
  const rotateToken = async () => {
    try {
      const res = await axios.post(
        `/api/v1/sessions/${activeSessionId}/rotate-token`,
        null,
        { params: { teacher_id: teacherId } }
      );
      setToken(res.data.qr_token);
      setTokenError(null);
    } catch (err: any) {
      // ถ้าหมุนไม่สำเร็จ (เช่น คาบถูกปิดไปแล้ว) ต้องแจ้งเตือนทันที ไม่ปล่อยให้ QR ค้างเป็นค่าเก่าเงียบๆ
      // เพราะ QR เก่าจะใช้เช็คชื่อไม่ได้แล้วจริงๆ (ตรวจกับ backend ตรงๆ)
      setTokenError(err.response?.data?.detail || 'ไม่สามารถหมุน QR Code ใหม่ได้ กรุณาลองใหม่');
    }
  };

  // 🌟 3. ฟังก์ชันดึงยอดนักศึกษาล่าสุด และดักจับความเปลี่ยนแปลงแบบเรียลไทม์ (Supabase Realtime)
  useEffect(() => {
    // ดึงข้อมูลจำนวนคนที่เช็คชื่อเข้าเรียนแล้วตอนเปิดหน้าจอครั้งแรก
    const fetchInitialCount = async () => {
      const { count, error } = await supabase
        .from('attendance_records')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', activeSessionId);
      
      if (!error && count !== null) {
        setAttendanceCount(count);
      }
    };

    fetchInitialCount();

    // เปิดระบบ Listen คอยฟังเสียงสัญญาณเมื่อมีนักศึกษาเพิ่มข้อมูลเข้าตาราง attendance_records
    const channel = supabase
      .channel('live-attendance-changes')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'attendance_records',
          filter: `session_id=eq.${activeSessionId}` // กรองเอาเฉพาะข้อมูลคลาสนี้เท่านั้น
        },
        () => {
          // มีนักศึกษาเช็คชื่อเข้ามาใหม่ (ไม่ว่าจะผ่าน QR หรือ NFC) -> บวกยอดเพิ่ม 1 ทันที
          setAttendanceCount((prev) => prev + 1);
        }
      )
      .subscribe();

    // เคลียร์การเชื่อมต่อ Realtime เมื่อปิดหน้าจอ
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSessionId]);

  // 🌟 4. ลูปควบคุมเวลาและหมุน Token ตัว QR Code ผ่าน backend
  useEffect(() => {
    let timer: number;

    // หมุน Token ครั้งแรกทันทีตอนเปิดหน้าจอ
    rotateToken();

    // ตั้งรอบการทำงานนับถอยหลังทุกๆ 1 วินาที
    timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          rotateToken(); // หมุน Token ชุดใหม่ผ่าน backend
          return 60; // รีเซ็ตตัวเลขกลับไปที่ 60 วินาที
        }
        return prev - 1;
      });
    }, 1000);

    // 🌟 ในระบบ Production: ย้ายอำนาจการลบข้อมูล (Delete) ออกไปให้สิทธิ์ขาดอยู่ที่หน้า Dashboard 
    // ตัวกล่อง LiveAttendance มีหน้าที่เพียงแค่เคลียร์ Interval เวลาปิดหน้าจอเท่านั้น
    return () => {
      clearInterval(timer);
    };
  }, [activeSessionId, teacherId]);

  // ข้อมูลที่จะฝังลงไปใน QR Code
  const qrData = JSON.stringify({
    session_id: activeSessionId, // 🌟 ฝังรหัส Session จริงลงไปเพื่อให้มือถือนักศึกษานำไปประมวลผลต่อได้ถูกต้อง
    token: token
  });

  return (
    <div className="fixed inset-0 bg-slate-900/95 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row animate-fade-in">
        
        {/* ฝั่งซ้าย: แสดง QR Code */}
        <div className="flex-1 p-8 flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">เช็คชื่อวิชา {courseCode}</h2>
          <p className="text-gray-500 mb-8 text-sm">ให้นักศึกษาสแกนเพื่อยืนยันตัวตนในชั้นเรียน</p>
          
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 relative">
             <QRCodeSVG value={qrData} size={250} level={"H"} />
             {/* ตัวเลขเวลานับถอยหลังทับตรงกลางวงกลม */}
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl text-orange-500 shadow-md border border-gray-100">
                {countdown}
             </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm font-medium text-orange-600 bg-orange-50 px-4 py-2 rounded-full border border-orange-200">
            <Clock size={16} />
            QR Code อัปเดตความปลอดภัยทุกๆ 60 วินาที
          </div>

          {/* 🌟 [เพิ่มใหม่] แจ้งเตือนถ้าหมุน QR ไม่สำเร็จ เช่น เซสชันถูกปิดไปแล้วจากอีกหน้าจอ */}
          {tokenError && (
            <div className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-50 px-4 py-2 rounded-full border border-red-200 mt-3">
              <AlertTriangle size={16} />
              {tokenError}
            </div>
          )}
        </div>

        {/* ฝั่งขวา: แผงควบคุมยอดนักศึกษา */}
        <div className="w-full md:w-64 p-6 bg-white flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Users size={18} /> สถานะปัจจุบัน
            </h3>
            <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100">
              <p className="text-sm text-emerald-700 font-medium">เข้าเรียนแล้ว</p>
              {/* 🌟 ตัวเลขนับจำนวนนักศึกษาแบบ Real-time */}
              <p className="text-4xl font-black text-emerald-600 mt-1 animate-pulse">
                {attendanceCount} <span className="text-base font-normal text-gray-400">คน</span>
              </p>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="w-full mt-8 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <XCircle size={18} />
            ซ่อนหน้าจอ QR Code
          </button>
        </div>

      </div>
    </div>
  );
}