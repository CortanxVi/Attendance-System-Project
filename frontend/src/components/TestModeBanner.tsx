import { FlaskConical } from 'lucide-react';
import { TEST_MODE } from '../config/testMode';

/** Always-visible warning on test builds, so they cannot be mistaken for the real portal. */
export default function TestModeBanner() {
  if (!TEST_MODE) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-[9999] flex items-center justify-center gap-2 bg-red-600 px-3 py-1.5 text-center text-xs font-bold text-white"
    >
      <FlaskConical size={14} aria-hidden="true" />
      โหมดทดสอบ: ไม่ต้องสแกน QR และไม่มีตัวจับเวลา ห้ามใช้กับวิชาจริง
    </div>
  );
}
