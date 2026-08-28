import { useState, useRef } from 'react';
import axios from 'axios';
import { Camera, CreditCard, UserPlus, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';

export default function RegistrationManagement() {
  const [activeTab, setActiveTab] = useState<'face' | 'nfc'>('face');

  // State สำหรับลงทะเบียนใบหน้า
  const [faceStudentId, setFaceStudentId] = useState('');
  const [faceImage, setFaceImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [faceMessage, setFaceMessage] = useState({ text: '', type: '' });
  const [isFaceLoading, setIsFaceLoading] = useState(false);

  // State สำหรับลงทะเบียน NFC
  const [nfcStudentId, setNfcStudentId] = useState('');
  const [nfcUid, setNfcUid] = useState('');
  const [nfcMessage, setNfcMessage] = useState({ text: '', type: '' });
  const [isNfcLoading, setIsNfcLoading] = useState(false);
  const nfcInputRef = useRef<HTMLInputElement>(null);

  // 📸 ฟังก์ชันจัดการลงทะเบียนใบหน้า
  const handleFaceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFaceImage(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleFaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faceStudentId || !faceImage) return;

    try {
      setIsFaceLoading(true);
      setFaceMessage({ text: 'กำลังประมวลผลและสกัดใบหน้า...', type: 'loading' });

      // การส่งไฟล์ภาพต้องใช้ FormData
      const formData = new FormData();
      formData.append('student_id', faceStudentId);
      formData.append('face_image', faceImage);

      const response = await axios.post('/api/v1/enrollment/register-face', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setFaceMessage({ text: `✅ ${response.data.message}`, type: 'success' });
      setFaceStudentId('');
      setFaceImage(null);
      setImagePreview(null);
    } catch (err: any) {
      setFaceMessage({ text: `❌ ${err.response?.data?.detail || 'เกิดข้อผิดพลาดในการลงทะเบียนใบหน้า'}`, type: 'error' });
    } finally {
      setIsFaceLoading(false);
    }
  };

  // 💳 ฟังก์ชันจัดการลงทะเบียน NFC
  const handleNfcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUid = nfcUid.trim();
    if (!nfcStudentId || !cleanUid) return;

    if (cleanUid.length !== 10) {
      setNfcMessage({ text: `❌ รหัส UID ต้องมี 10 หลัก (อ่านได้ ${cleanUid.length})`, type: 'error' });
      setNfcUid('');
      setTimeout(() => nfcInputRef.current?.focus(), 50);
      return;
    }

    try {
      setIsNfcLoading(true);
      setNfcMessage({ text: 'กำลังบันทึกข้อมูล...', type: 'loading' });
      const response = await axios.post('/api/v1/nfc/register', {
        student_id: nfcStudentId,
        nfc_uid: cleanUid
      });

      if (response.data.status === 'success') {
        setNfcMessage({ text: `✅ ผูกบัตรกับรหัส ${nfcStudentId} สำเร็จ!`, type: 'success' });
        setNfcStudentId('');
        setNfcUid('');
      }
    } catch (err: any) {
      setNfcMessage({ text: `❌ ${err.response?.data?.detail || 'เกิดข้อผิดพลาด'}`, type: 'error' });
      setNfcUid('');
    } finally {
      setIsNfcLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-red-100 text-red-600 rounded-xl"><UserPlus size={28} /></div>
        <div>
          <h2 className="text-2xl font-bold text-gray-800">ระบบลงทะเบียน (Enrollment)</h2>
          <p className="text-sm text-gray-500">จัดการผูกข้อมูลอัตลักษณ์และคีย์การ์ดเข้ากับบัญชีผู้ใช้</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* แถบ Tabs */}
        <div className="flex border-b border-gray-100">
          <button 
            onClick={() => setActiveTab('face')}
            className={`flex-1 py-4 text-sm font-bold flex justify-center items-center gap-2 transition-colors ${activeTab === 'face' ? 'bg-red-50 text-red-600 border-b-2 border-red-500' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <Camera size={18} /> ลงทะเบียนใบหน้า (Face)
          </button>
          <button 
            onClick={() => setActiveTab('nfc')}
            className={`flex-1 py-4 text-sm font-bold flex justify-center items-center gap-2 transition-colors ${activeTab === 'nfc' ? 'bg-red-50 text-red-600 border-b-2 border-red-500' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <CreditCard size={18} /> ผูกบัตรคีย์การ์ด (NFC)
          </button>
        </div>

        <div className="p-8">
          {/* 📸 TAB 1: FACE REGISTRATION */}
          {activeTab === 'face' && (
            <form onSubmit={handleFaceSubmit} noValidate className="space-y-6 animate-fade-in">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">1. รหัสนักศึกษา / พนักงาน</label>
                <input 
                  type="text" 
                  value={faceStudentId} onChange={(e) => setFaceStudentId(e.target.value)}
                  placeholder="เช่น 66xxxxxxxxxxx"
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">2. อัปโหลดภาพถ่ายหน้าตรง</label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors overflow-hidden">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <ImageIcon className="w-10 h-10 text-gray-400 mb-3" />
                        <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">คลิกเพื่ออัปโหลด</span> หรือลากไฟล์มาวาง</p>
                        <p className="text-xs text-gray-500">รองรับ JPG, PNG (แนะนำให้ถอดแว่นและหน้ากาก)</p>
                      </div>
                    )}
                    <input type="file" accept="image/*" onChange={handleFaceImageChange} className="hidden" required />
                  </label>
                </div>
              </div>

              <button type="submit" disabled={isFaceLoading || !faceImage || !faceStudentId} className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-bold py-3.5 rounded-xl transition-colors flex justify-center items-center gap-2">
                {isFaceLoading ? 'กำลังดำเนินการ...' : <><Camera size={18} /> ยืนยันการลงทะเบียนใบหน้า</>}
              </button>

              {faceMessage.text && (
                <div className={`p-4 rounded-xl text-sm font-medium text-center flex items-center justify-center gap-2 ${faceMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : faceMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700'}`}>
                  {faceMessage.type === 'success' ? <CheckCircle size={18}/> : faceMessage.type === 'error' ? <AlertCircle size={18}/> : null}
                  {faceMessage.text}
                </div>
              )}
            </form>
          )}

          {/* 💳 TAB 2: NFC REGISTRATION */}
          {activeTab === 'nfc' && (
            <form onSubmit={handleNfcSubmit} noValidate className="space-y-6 animate-fade-in">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">1. รหัสนักศึกษา / พนักงาน</label>
                <input 
                  type="text" 
                  value={nfcStudentId} onChange={(e) => setNfcStudentId(e.target.value)}
                  placeholder="เช่น 66xxxxxxxxxxx"
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>

              {nfcStudentId && (
                <div className="p-6 bg-red-50 border border-red-200 rounded-2xl space-y-4 animate-fade-in">
                  <label className="block text-sm font-bold text-red-800">2. แตะบัตรคีย์การ์ดลงบนหัวอ่าน</label>
                  <input 
                    ref={nfcInputRef}
                    type="text"
                    value={nfcUid} onChange={(e) => setNfcUid(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNfcSubmit(e); } }}
                    placeholder="รหัส UID ของบัตรจะแสดงที่นี่..."
                    className="w-full text-center font-mono text-xl bg-white border border-red-300 rounded-xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-red-500 shadow-inner"
                    autoComplete="off"
                    required
                  />
                  <button type="submit" disabled={isNfcLoading || !nfcUid} className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-bold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                     {isNfcLoading ? 'กำลังดำเนินการ...' : <><CreditCard size={20} /> ยืนยันการผูกบัตร</>}
                  </button>
                </div>
              )}

              {nfcMessage.text && (
                 <div className={`p-4 rounded-xl text-sm font-medium text-center flex items-center justify-center gap-2 ${nfcMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : nfcMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700'}`}>
                   {nfcMessage.type === 'success' ? <CheckCircle size={18}/> : nfcMessage.type === 'error' ? <AlertCircle size={18}/> : null}
                   {nfcMessage.text}
                 </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
