import React, { useState, useRef } from 'react';
import { UserPlus } from 'lucide-react';
import axios from 'axios';

export default function RegisterNFC() {
  const [regStudentId, setRegStudentId] = useState('');
  const [regNfcUid, setRegNfcUid] = useState('');
  const [regMessage, setRegMessage] = useState({ text: '', type: '' });
  const registerInputRef = useRef<HTMLInputElement>(null);

  const handleRegisterNfcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUid = regNfcUid.trim();
    if (!regStudentId || !cleanUid) return;

    if (cleanUid.length !== 10) {
      setRegMessage({ text: `❌ รหัส UID ต้องมี 10 หลัก (อ่านได้ ${cleanUid.length})`, type: 'error' });
      setRegNfcUid('');
      setTimeout(() => registerInputRef.current?.focus(), 50);
      return;
    }

    try {
      setRegMessage({ text: 'กำลังบันทึกข้อมูล...', type: 'loading' });
      const response = await axios.post('/api/v1/nfc/register', {
        student_id: regStudentId,
        nfc_uid: cleanUid
      });

      if (response.data.status === 'success') {
        setRegMessage({ text: `✅ ผูกบัตรกับรหัส ${regStudentId} สำเร็จ!`, type: 'success' });
        setRegStudentId('');
        setRegNfcUid('');
      }
    } catch (err: any) {
      setRegMessage({ text: `❌ ${err.response?.data?.detail || 'เกิดข้อผิดพลาด'}`, type: 'error' });
      setRegNfcUid('');
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-6 pb-6 border-b border-gray-100">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-xl"><UserPlus size={24} /></div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800">ผูกบัตรประจำตัว</h2>
            <p className="text-sm text-gray-500">ลงทะเบียนคีย์การ์ดใหม่เข้ากับรหัสนักศึกษา</p>
          </div>
        </div>

        <form onSubmit={handleRegisterNfcSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">1. กรอกรหัสนักศึกษา</label>
            <input 
              type="text" 
              value={regStudentId} onChange={(e) => setRegStudentId(e.target.value)}
              placeholder="ตัวอย่างเช่น 6401012345"
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              required
            />
          </div>

          {regStudentId && (
            <div className="p-6 bg-orange-50 border border-orange-200 rounded-2xl space-y-4 animate-fade-in">
              <label className="block text-sm font-bold text-orange-800">2. แตะบัตรคีย์การ์ดลงบนหัวอ่าน</label>
              <input 
                ref={registerInputRef}
                type="text"
                value={regNfcUid} onChange={(e) => setRegNfcUid(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRegisterNfcSubmit(e); } }}
                placeholder="รหัส UID บัตรจะเด้งขึ้นตรงนี้โดยอัตโนมัติ..."
                className="w-full text-center font-mono text-xl bg-white border border-orange-300 rounded-xl px-4 py-4 focus:outline-none shadow-inner"
                autoComplete="off"
                required
              />
              <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                <UserPlus size={20} /> ยืนยันการผูกบัตร
              </button>
            </div>
          )}

          {regMessage.text && (
            <div className={`p-4 rounded-xl text-sm font-medium text-center ${regMessage.type === 'success' ? 'bg-green-100 text-green-700' : regMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {regMessage.text}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
