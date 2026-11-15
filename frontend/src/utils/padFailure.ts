/**
 * After the Backend refuses an attempt as a possible photo/screen (passive PAD), the web shows a
 * short checklist before the next try. It never blocks: the retry button stays one tap away.
 * Real data (2026-11-15): PAD refusals cluster on slow phones held close and on capture quality
 * (blur, back light, exposure), all of which the person can fix.
 */
export const PAD_RETRY_CHECKLIST: readonly string[] = Object.freeze([
  'หันหน้าเข้าหาแสง อย่าให้แสงอยู่ด้านหลัง',
  'ถือโทรศัพท์ระดับสายตา ห่างประมาณ 30–40 ซม.',
  'ถือนิ่ง ๆ ระหว่างสแกน',
  'เช็ดเลนส์กล้องให้สะอาด',
  'เปิดลิงก์ด้วย Chrome หรือ Safari ไม่ใช่เบราว์เซอร์ในแอปแชต',
]);

export const PAD_RETRY_TITLE = 'ก่อนลองใหม่ ลองตรวจสิ่งเหล่านี้';

/**
 * True for the Backend's PAD refusal: its message (PAD_FAILURE_MESSAGE in
 * backend/services/passive_pad_service.py) or the test-build code "[รหัส pad ...". The face-too-small
 * and crop errors (pad_size, pad_crop) are different problems and are not matched.
 */
export function isPadFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  if (/\[รหัส pad(?=[\s·\]])/.test(message)) return true;
  return message.includes('ภาพถ่ายหรือหน้าจอ') && !/\[รหัส pad_/.test(message);
}
