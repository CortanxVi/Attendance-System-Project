import { Smartphone } from 'lucide-react';
import { MIN_ANDROID_MAJOR } from '../utils/deviceSupport';

interface UnsupportedDeviceNoticeProps {
  androidMajor: number;
  onClose?: () => void;
}

/** Explains that the scan needs Android 11 or newer, with the ways forward. */
export default function UnsupportedDeviceNotice({ androidMajor, onClose }: UnsupportedDeviceNoticeProps) {
  return (
    <section
      role="alert"
      className="w-full max-w-sm rounded-3xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-950 shadow-xl"
    >
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Smartphone aria-hidden="true" size={24} />
      </div>
      <h2 className="text-base font-bold">อุปกรณ์นี้ยังไม่รองรับการสแกนใบหน้า</h2>
      <p className="mt-2 leading-6">
        โทรศัพท์เครื่องนี้ใช้ Android {androidMajor} ระบบรองรับ Android {MIN_ANDROID_MAJOR} ขึ้นไป
        เพราะเครื่องรุ่นเก่าประมวลผลภาพใบหน้าได้ช้าเกินกว่าที่ระบบตรวจบุคคลจริงต้องการ
      </p>
      <ul className="mt-3 space-y-1 text-left leading-6">
        <li>• อัปเดต Android เป็นเวอร์ชัน {MIN_ANDROID_MAJOR} ขึ้นไป (ถ้าเครื่องรองรับ)</li>
        <li>• หรือใช้โทรศัพท์ Android {MIN_ANDROID_MAJOR}+ หรือ iPhone เครื่องอื่น</li>
        <li>• หรือใช้คอมพิวเตอร์ที่มีกล้องหน้า</li>
      </ul>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-11 cursor-pointer rounded-xl bg-amber-600 px-5 font-bold text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
        >
          กลับ
        </button>
      )}
    </section>
  );
}
