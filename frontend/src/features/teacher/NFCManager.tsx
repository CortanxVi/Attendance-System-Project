import React, { useState, useRef, useEffect } from "react";
import {
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  UserPlus,
  ClipboardCheck,
  X,
} from "lucide-react";
import axios from "axios";

interface NFCManagerProps {
  onClose: () => void;
  defaultCourseCode?: string;
}

export default function NFCManager({
  onClose,
  defaultCourseCode = "CS301",
}: NFCManagerProps) {
  const [isNfcSystemEnabled, setIsNfcSystemEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<"checkin" | "register">("checkin");

  // State สำหรับการลงทะเบียนบัตรใหม่ (Registration)
  const [studentId, setStudentId] = useState("");
  const [registerNfcUid, setRegisterNfcUid] = useState("");

  // State สำหรับการสแกนเช็คชื่อ (Attendance Check-in)
  const [checkInNfcUid, setCheckInNfcUid] = useState("");
  const [mockSessionId, setMockSessionId] = useState(
    "88888888-8888-8888-8888-888888888888",
  ); // สมมติรหัส Session คลาสเรียน

  // State สำหรับแสดงผลลัพธ์ข้อมูล
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [scannedStudentInfo, setScannedStudentInfo] = useState<any>(null);

  // References สำหรับควบคุมจุดโฟกัสของสแกนเนอร์
  const checkInInputRef = useRef<HTMLInputElement>(null);
  const registerInputRef = useRef<HTMLInputElement>(null);

  // คอยบังคับโฟกัสไปที่ Input ของเครื่องสแกนอัตโนมัติเมื่อเปิดระบบ
  useEffect(() => {
    if (isNfcSystemEnabled) {
      autoFocusScanner();
    }
  }, [isNfcSystemEnabled, activeTab]);

  const autoFocusScanner = () => {
    setTimeout(() => {
      if (activeTab === "checkin" && checkInInputRef.current) {
        checkInInputRef.current.focus();
      } else if (
        activeTab === "register" &&
        registerInputRef.current &&
        studentId
      ) {
        registerInputRef.current.focus();
      }
    }, 50);
  };

 // 1. ฟังก์ชันส่งข้อมูล "ลงทะเบียนผูกบัตรนักศึกษา"
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !registerNfcUid) return;

    const cleanUid = registerNfcUid.trim();

    // 🌟 เพิ่มการตรวจสอบความยาวฝั่งหน้าบ้าน
    if (cleanUid.length !== 10) {
      setSuccessMessage(''); // ล้างสถานะความสำเร็จเดิม
      setErrorMessage(`❌ ไม่ผ่านเงื่อนไข: รหัส UID ของบัตรต้องมีขนาด 10 ตัวอักษรเท่านั้น (ปัจจุบันเครื่องอ่านอ่านได้ ${cleanUid.length} ตัว)`);
      setRegisterNfcUid(''); // ล้างค่าในช่องกรอกเพื่อให้แตะบัตรใหม่ได้
      
      // บังคับโฟกัสไปที่ช่องใส่ UID อีกครั้งเพื่อให้แตะซ้ำได้ทันที
      setTimeout(() => registerInputRef.current?.focus(), 50);
      return;
    }

    try {
      setErrorMessage('');
      setSuccessMessage('');
      
      const response = await axios.post('/api/v1/nfc/register', {
        student_id: studentId,
        nfc_uid: cleanUid
      });

      if (response.data.status === 'success') {
        setSuccessMessage(`ผูกบัตรประจำตัวเรียบร้อย: ${studentId}`);
        setStudentId('');
        setRegisterNfcUid('');
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.detail || 'ไม่สามารถลงทะเบียนบัตรได้');
      setRegisterNfcUid('');
    }
  };

  // 2. ฟังก์ชันส่งข้อมูล "แตะบัตรเช็คชื่อนักศึกษา"
  const handleCheckInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkInNfcUid) return;

    try {
      setErrorMessage("");
      setScannedStudentInfo(null);

      const response = await axios.post("/api/v1/nfc/checkin", {
        nfc_uid: checkInNfcUid.trim(),
        session_id: mockSessionId,
      });

      if (response.data.status === "success") {
        setScannedStudentInfo(response.data.student_info);
        // ล้างค่าเพื่อให้พร้อมสำหรับรับบัตรคิวถัดไปทันที
        setCheckInNfcUid("");
        autoFocusScanner();
      }
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.detail || "เกิดข้อผิดพลาดในการตรวจสอบบัตร",
      );
      setCheckInNfcUid("");
      autoFocusScanner();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-50 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header ส่วนบน */}
        <div className="bg-slate-900 text-white p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500 p-2 rounded-lg text-white">
              <CreditCard size={24} />
            </div>
            <div>
              <h3 className="font-bold text-xl">NFC Management Center</h3>
              <p className="text-slate-400 text-xs">
                ควบคุมฮาร์ดแวร์และลงทะเบียนบัตรประจำตู้คีย์ออส
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-slate-800"
          >
            <X size={24} />
          </button>
        </div>

        {/* ส่วนเปิด-ปิด ระบบของอาจารย์ */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-gray-700">
            สวิตช์ควบคุมฮาร์ดแวร์เครื่องสแกน USB-A
          </span>
          <button
            onClick={() => setIsNfcSystemEnabled(!isNfcSystemEnabled)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              isNfcSystemEnabled
                ? "bg-green-100 text-green-700 border border-green-300"
                : "bg-gray-100 text-gray-500 border border-gray-300"
            }`}
          >
            {isNfcSystemEnabled ? (
              <>
                {" "}
                <ToggleRight size={24} className="text-green-600" /> ระบบ NFC:
                เปิดอยู่{" "}
              </>
            ) : (
              <>
                {" "}
                <ToggleLeft size={24} className="text-gray-400" /> ระบบ NFC:
                ปิดอยู่{" "}
              </>
            )}
          </button>
        </div>

        {/* ถ้าอาจารย์ยังไม่เปิดสวิตช์ระบบ จะโชว์หน้าจอปิดระบบไว้ */}
        {!isNfcSystemEnabled ? (
          <div className="p-12 text-center flex-1 flex flex-col items-center justify-center bg-gray-50">
            <CreditCard
              size={64}
              className="text-gray-300 mb-4 animate-pulse"
            />
            <h4 className="text-lg font-bold text-gray-700 mb-1">
              ระบบ NFC ยังไม่เปิดทำงาน
            </h4>
            <p className="text-gray-500 text-sm max-w-md">
              กรุณาเปิดสวิตช์ระบบด้านบนเพื่อเริ่มเชื่อมต่อเครื่องสแกนที่เสียบอยู่กับคอมพิวเตอร์ของอาจารย์
            </p>
          </div>
        ) : (
          <>
            {/* เมนูแท็บสลับโหมดการทำงาน */}
            <div className="flex bg-gray-100 p-1.5 m-6 mb-2 rounded-xl">
              <button
                onClick={() => {
                  setActiveTab("checkin");
                  setErrorMessage("");
                  setSuccessMessage("");
                }}
                className={`flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === "checkin" ? "bg-white text-blue-700 shadow-sm font-bold" : "text-gray-600 hover:text-gray-900"}`}
              >
                <ClipboardCheck size={18} />
                โหมดเช็คชื่อนักศึกษาหน้าห้อง
              </button>
              <button
                onClick={() => {
                  setActiveTab("register");
                  setErrorMessage("");
                  setSuccessMessage("");
                }}
                className={`flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === "register" ? "bg-white text-blue-700 shadow-sm font-bold" : "text-gray-600 hover:text-gray-900"}`}
              >
                <UserPlus size={18} />
                โหมดลงทะเบียนผูกบัตรใหม่
              </button>
            </div>

            {/* เนื้อหาแต่ละแท็บ */}
            <div className="p-6 flex-1 overflow-y-auto">
              {/* สัญญาณไฟแจ้งเตือน / ข้อผิดพลาด */}
              {errorMessage && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 text-sm">
                  <AlertCircle size={18} /> {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-xl flex items-center gap-2 text-sm">
                  <CheckCircle2 size={18} /> {successMessage}
                </div>
              )}

              {/* 1. แท็บเช็คชื่อ (Check-in Mode) */}
              {activeTab === "checkin" && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleCheckInSubmit}
                    className="bg-blue-50 border border-blue-200 p-6 rounded-2xl text-center space-y-4"
                  >
                    <p className="text-blue-800 text-sm font-medium">
                      กำลังเปิดคลาสวิชา:{" "}
                      <span className="font-bold underline">
                        {defaultCourseCode}
                      </span>
                    </p>
                    <h4 className="text-xl font-bold text-blue-900">
                      ให้นักศึกษาเดินมาแตะบัตรที่แท่นอ่านได้เลย
                    </h4>

                    {/* Input ตัวนี้ถูกซ่อนรูปแบบไว้แต่คอยดักจับค่าการพิมพ์ของเครื่องสแกน */}
                    <input
                      ref={checkInInputRef}
                      type="text"
                      value={checkInNfcUid}
                      onChange={(e) => setCheckInNfcUid(e.target.value)}
                      placeholder="คลิกที่นี่เพื่อให้เครื่องสแกนพร้อมทำงาน..."
                      className="mx-auto block text-center max-w-xs bg-white border border-blue-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={autoFocusScanner}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      🎯 คลิกเพื่อบังคับรีโฟกัสหัวอ่านบัตร
                    </button>
                  </form>

                  {/* แสดงข้อมูลนักศึกษาที่เพิ่งทำการแตะบัตรสำเร็จล่าสุด */}
                  {scannedStudentInfo && (
                    <div className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-6 text-center shadow-md animate-fade-in">
                      <div className="w-16 h-16 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={36} />
                      </div>
                      <h4 className="text-2xl font-bold text-emerald-900 mb-1">
                        ยินดีต้อนรับ เช็คชื่อเรียบร้อย!
                      </h4>
                      <p className="text-lg text-slate-800 font-medium">
                        {scannedStudentInfo.full_name}
                      </p>
                      <p className="text-sm text-slate-600 mb-2">
                        รหัสนักศึกษา: {scannedStudentInfo.student_id}
                      </p>
                      <span className="inline-block px-3 py-1 bg-emerald-200 text-emerald-800 text-xs font-bold rounded-full uppercase">
                        Method: {scannedStudentInfo.method}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 2. แท็บลงทะเบียนบัตรประจำตัว (Register Mode) */}
              {activeTab === "register" && (
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      1. พิมพ์รหัสนักศึกษา
                    </label>
                    <input
                      type="text"
                      placeholder="ตัวอย่างเช่น 6401012345"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>

                  {studentId && (
                    <div className="p-5 bg-orange-50 border border-orange-200 rounded-2xl space-y-3 animate-fade-in">
                      <label className="block text-sm font-bold text-orange-800">
                        2. ขั้นตอนการผูกบัตร: แตะบัตรคีย์การ์ดลงบนหัวอ่าน ณ
                        ตอนนี้
                      </label>
                      <input
                        ref={registerInputRef}
                        type="text"
                        placeholder="รหัส UID บัตรจะเด้งขึ้นตรงนี้โดยอัตโนมัติ..."
                        value={registerNfcUid}
                        onChange={(e) => setRegisterNfcUid(e.target.value)}
                        // 🌟 แก้ไขจุดที่ 1: ดักจับการกดปุ่ม Enter จากเครื่องอ่าน NFC โดยตรง
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleRegisterSubmit(e);
                          }
                        }}
                        className="w-full text-center font-mono text-lg bg-white border border-orange-300 rounded-xl px-4 py-3 focus:outline-none"
                        autoComplete="off"
                        required
                      />
                      <p className="text-xs text-orange-600 text-center">
                        หัวอ่านจำลองโหมดแป้นพิมพ์
                        จะยิงข้อมูลรหัสและบันทึกอัตโนมัติทันทีที่สัมผัส
                      </p>

                      {/* 🌟 แก้ไขจุดที่ 2: เพิ่มปุ่ม Submit เข้ามาในฟอร์ม */}
                      <button
                        type="submit"
                        className="w-full mt-2 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2"
                      >
                        <UserPlus size={18} />
                        ยืนยันการผูกบัตร
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
