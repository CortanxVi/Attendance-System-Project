---
version: alpha
name: "KMUTNB Attendance"
description: "ระบบเช็คชื่อภาษาไทยที่ให้ความรู้สึกเป็นทางการ ชัดเจน และตอบสนองทันทีในห้องเรียน"
colors:
  primary: "#f97316"
  institutional: "#0f172a"
  success: "#059669"
  danger: "#dc2626"
  background: "#f8fafc"
  surface: "#ffffff"
  border: "#e5e7eb"
  text: "#1f2937"
typography:
  sans:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
spacing:
  section-gap: "1.5rem"
  page-max: "72rem"
components:
  button: {}
  card: {}
  dialog: {}
  toast: {}
  upload: {}
  support-thread: {}
  live-feed: {}
  course-management: {}
  join-code: {}
---

# KMUTNB Attendance Design System

## Overview

### Creative North Star

หน้าปัดควบคุมหน้าห้องเรียนที่เชื่อถือได้: ข้อมูลสำคัญอ่านได้จากระยะสั้น สีส้มของสถาบันใช้เป็นจุดนำสายตา และจังหวะสีเขียวของรายการเช็คชื่อใหม่เป็นลายเซ็นของระบบ

### Product context and register

- **Audience and primary job:** นักศึกษาเช็คชื่อจากมือถือ; อาจารย์เปิดคาบ แสดง Dynamic QR รับ NFC และเห็นผู้เข้าเรียนทันที; ผู้ดูแลจัดการบัญชีและรายงาน
- **Target market(s) and evidence:** มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ ตามชื่อผลิตภัณฑ์และโดเมนบัญชี `kmutnb.ac.th`
- **Locale(s) and language policy:** UI หลัก `th-TH`; คำเทคนิคสากล เช่น QR, NFC และ OCR ใช้ร่วมกับคำอธิบายภาษาไทย
- **Usage scene:** นักศึกษาใช้มือถือในห้องเรียนและมีเวลาจำกัด; อาจารย์ใช้จอเดสก์ท็อป/โปรเจกเตอร์และต้องเห็น feedback ทันที
- **Register:** product/admin; เน้นความชัดเจนและความน่าเชื่อถือเหนือการตกแต่ง
- **Memorable signature:** live attendance pulse—ชื่อ วิธีเช็คชื่อ และสถานะปรากฏพร้อม toast สีเขียวทันที
- **Restraint:** ฟอร์มสิทธิ์ การยืนยันตัวตน และ error ใช้รูปแบบคุ้นเคย ไม่ใช้ motion ที่รบกวน
- **Anti-references:** ไม่ใช้หน้าตา landing page, glassmorphism หนัก, gradient หลายสี หรือปุ่มจำลองสิทธิ์ใน production
- **Token ownership/runtime mapping:** ไฟล์นี้บันทึกค่ามาตรฐาน; runtime หลักอยู่ใน utility classes ของ `frontend/src` และตัวแปร layer ใน `frontend/src/index.css`

## Colors

สีส้ม `#f97316` เป็น primary action, slate `#0f172a` เป็น navigation/institutional, emerald `#059669` เป็นผลสำเร็จ, red `#dc2626` ใช้เฉพาะ error/destructive. พื้นหลัง `#f8fafc`, surface สีขาว, border `#e5e7eb`, และข้อความหลัก `#1f2937`. Focus ring ต้องมี contrast ชัดและไม่ใช้สีเพียงอย่างเดียวในการสื่อสถานะ

## Typography

ใช้ system stack ที่มี `Noto Sans Thai` fallback เพื่อรองรับไทย/ละตินร่วมกัน. หัวข้อใช้ 600–800, เนื้อหา 400–500, รหัสนักศึกษาและ UID ใช้ mono พร้อมตัวเลขไม่ตัดบรรทัด. ไม่ใช้ uppercase กับข้อความไทย

## Layout

หน้า Teacher/Admin ใช้พื้นที่แบบ fluid เต็มความกว้างโดยไม่กำหนดความกว้างหน้าแบบตายตัว; sidebar เป็น drawer บนมือถือ/แท็บเล็ตและคงอยู่เมื่อ viewport กว้างตั้งแต่ 1024px โดยพื้นที่เนื้อหาต้องมี `min-width: 0` และตารางเป็นเจ้าของ horizontal scroll ของตนเอง. Padding เปลี่ยนตาม viewport ตั้งแต่ 0.75rem ถึง 2rem และใช้จังหวะ 1.5rem ระหว่าง section.

Student เป็น mobile-only shell ขนาดกว้าง 100% และจำกัดเพดาน 440px เพื่อครอบคลุม iPhone ตั้งแต่รุ่นหน้าจอแคบถึง Pro Max. Shell สูงตาม `100dvh` (fallback `100svh`), รองรับ iOS safe-area และมี vertical scroll owner เพียงจุดเดียวที่ main content; bottom navigation อยู่นอก scroller และต้องมองเห็นอยู่เสมอ. Breakpoint ของ viewport ภายนอกห้ามทำให้คอนเทนต์นักศึกษาเปลี่ยนเป็น desktop layout ภายใน shell 440px. Upload และ action สำคัญต้องเข้าถึงได้โดยไม่ล็อกความสูงหน้าฟอร์ม

## Elevation & Depth

ใช้ border กับ tonal surface เป็นหลัก; shadow เล็กสำหรับ card และ shadow ชัดสำหรับ dialog/toast. ไม่ซ้อน shadow หลายชั้น. Layer runtime ใช้ตัวแปร `--z-*` ใน `frontend/src/index.css`; toast สูงสุด

## Shapes

Card และ dialog ใช้ 1rem, controls 0.75rem, icon button 0.5rem. Badge เป็น pill เฉพาะสถานะ/จำนวน ไม่ใช้ pill กับทุกองค์ประกอบ

## Components

### Foundational visual states

ทุก action มี hover, `focus-visible`, disabled ที่กดไม่ได้จริง, busy ที่คงขนาดเดิม, success/error พร้อมข้อความ. Loading indicator มาตรฐานเป็นวงหมุนที่มีพื้นที่สำรอง

### Buttons and actions

Primary ใช้ส้มในงานทั่วไป, เขียวสำหรับขั้นตอนยืนยันเช็คชื่อ, red สำหรับ destructive. ปุ่มไอคอนต้องมี accessible label; ปุ่ม busy ปิด duplicate submit

### Navigation and data display

ตารางคงรูปแบบ header slate อ่อน; มือถืออนุญาต horizontal scroll. รายการ live เรียงใหม่สุดก่อนและแสดงชื่อ รหัส วิธี และสถานะ

Scrollbar ของทุก application-owned scroll surface ใช้ baseline กลางจาก `frontend/src/index.css`: thumb slate, track โปร่งใส, รองรับทั้ง standards properties และ WebKit fallback โดยคืนให้สีระบบใน forced-colors mode

### Forms and overlays

ฟอร์มเป็น app-owned validation พร้อม `noValidate`. รูปบัตรรับ JPEG/PNG แล้วปรับอัตโนมัติภายในกรอบ 1920×1920 px โดยคงสัดส่วน ไม่ตัดภาพ และเข้ารหัส JPEG คุณภาพ 94%; ไฟล์ผลลัพธ์ต้องไม่เกิน 8 MB ก่อนส่ง. Toast กลางอยู่ขวาบน, deduplicate 2 วินาที, success 5 วินาที, error คงอยู่จนปิด

หน้าตรวจ liveness ใช้กล้อง stream เดียว แสดง native camera selector เมื่อมีกล้องหลายตัว และมี progress/instruction ที่อ่านได้โดย screen reader. หน้าเริ่มเช็คชื่อต้อง preload, compile และ warm-up Face Landmarker แบบ singleton ก่อนเปิดปุ่มสแกน QR; loading ต้องมีพื้นที่คงที่ ส่วน failure แสดงปุ่มลองใหม่และห้ามเปิด QR จนกว่าโมเดลพร้อม. หลัง QR ล่าสุดผ่าน server ออกสิทธิ์แบบผูกบัญชีและใช้ครั้งเดียวซึ่งลอง liveness ซ้ำได้รวม 7 นาที แต่กล้องแต่ละรอบต้องจบภายใน 45 วินาทีและมีปุ่มเริ่มรอบใหม่ใน error panel. Protocol v2 มาจาก server และต้องทำตามลำดับ “วางหน้าในกรอบ → เข้าใกล้กล้อง → กลับกรอบเดิม → รอคำสั่งสุ่ม → กระพริบตาทั้งสองข้าง 1–2 ครั้ง → มองตรง”; ไม่มีการหันซ้าย/ขวา. Face Landmarker ทำงานใน Web Worker และคำนวณ baseline แยกตาซ้าย/ขวา โดยรองรับกล้องแปรผันตั้งแต่ 8 FPS และ geometry noise ระดับปานกลาง; การก้ม/เงย ขยิบตาข้างเดียว ใบหน้าหลุด อัตราภาพต่ำกว่าเกณฑ์ หรือสลับบุคคลต้องไม่ทำให้ผ่าน. ระบบเก็บเฉพาะเฟรมสำคัญชั่วคราวให้ backend ตรวจการเปลี่ยนขนาดหน้า ลำดับตาปิด–เปิด บุคคลเดียวกัน ความต่อเนื่องของภาพ และ passive PAD แบบ local แล้วทิ้งโดยไม่บันทึกถาวร. สีเขียวใช้เมื่อกำลังยืนยันเช็คชื่อและ success เท่านั้น ส่วน error แสดงสาเหตุพร้อมทางเริ่มใหม่

ฟอร์ม PIN ใช้ช่อง masked, numeric input 6 หลัก, ปุ่มแสดง/ซ่อนที่มี accessible label และไม่ persist ค่าไว้ใน password/local storage. หน้าสิทธิ์ชั่วคราวต้องมีแถบเตือนสี amber พร้อมเวลาหมดอายุและปุ่มกลับสู่สิทธิ์อาจารย์ที่มองเห็นได้ใน Admin layout

โปรไฟล์นักศึกษาใช้โครง mobile card: รูปวงกลมจาก Google Account พร้อม initials fallback, ชื่อ/อีเมล/รหัส, แก้ชั้นปีแบบ inline และแสดง action ลงทะเบียนใบหน้าเฉพาะสถานะที่ยังไม่ลงทะเบียน. คำร้องเป็น navigation row ไปยังหน้ารายการและ thread แยกที่มีทางกลับสู่โปรไฟล์; นักศึกษาและอาจารย์เห็นเฉพาะคู่สนทนาของรายวิชา. ไฟล์แนบใช้ shared preview card, แสดงตัวอย่างก่อนส่งและโหลดตัวอย่างที่ได้รับเมื่อผู้ใช้กดเท่านั้น

การ์ดรายวิชาฝั่งอาจารย์มี action จัดการเพียงจุดเดียวที่มุมขวาบน และคงปุ่มเปิดเช็คชื่อเป็น primary classroom action. ศูนย์จัดการรายวิชาใช้ navigation แยกข้อมูล เกณฑ์ สมาชิก รหัสคลาส ประวัติ และพื้นที่อันตราย; desktop เป็นแถบด้านข้างและ mobile เลื่อนแนวนอนได้. รหัสคลาสใช้ monospace ขนาดใหญ่ในหัวสี slate เพื่อให้อ่านจากหน้าห้องได้ และทุกการหมุนรหัสหรืออนุมัติสมาชิกใช้ app-owned confirmation.

การนำเข้ารายชื่อใช้ upload zone เส้นประพร้อม file picker เป็นทางเลือกเสมอ รองรับ `.xlsx` และ `.csv`; หลังตรวจไฟล์ต้องแสดงสรุปผลและตารางตัวอย่างแบบแบ่งหน้าก่อนเปิดปุ่มยืนยัน. สีเขียวหมายถึงเพิ่มบัญชีที่มีอยู่, น้ำเงินหมายถึงสร้าง/ผูกคำเชิญ, เทาหมายถึงข้อมูลเดิม และแดงหมายถึงแถวที่ต้องแก้ไข โดยทุกสถานะมีข้อความกำกับ. หน้าตั้งค่าระบบเป็นรายการ navigation rows และแต่ละหัวข้อเปิด route แยกที่มีปุ่มกลับ ไม่ซ้อนฟอร์มทั้งหมดในหน้าเดียว.

หน้าจัดการรายวิชาของนักศึกษาเป็น mobile-first single column: ช่องรหัสอยู่ก่อนรายการวิชาที่เข้าร่วมและคำขอทั้งหมด. สถานะรออนุมัติ/อนุมัติ/ปฏิเสธ/ยกเลิกต้องมีทั้งข้อความและไอคอน ไม่สื่อด้วยสีอย่างเดียว.

### Iconography

ใช้ `lucide-react`, stroke มาตรฐาน 16–24px. งานสำคัญมีข้อความกำกับ ไม่ใช่ไอคอนอย่างเดียว

### Motion

ใช้เฉพาะ fade/state feedback 150–300ms. การหมุน QR แสดง countdown แต่ไม่กระพริบ. เคารพ `prefers-reduced-motion`

### Content and data visualization

ข้อความสั้น ตรง และระบุวิธีแก้. เวลาแสดง `th-TH`; ค่า backend เก็บ UTC. สถานะใช้คำ “มาเรียน”, “มาสาย”, “ขาดเรียน” สม่ำเสมอ

## Do's and Don'ts

- **Do:** แสดงชื่อและวิธีเช็คชื่อทันทีเมื่อมี record ใหม่
- **Do:** ให้ server/JWT เป็นเจ้าของสิทธิ์; UI สะท้อนสิทธิ์จริงเท่านั้น
- **Don't:** ใช้ `alert`, `confirm`, `prompt` หรือปุ่มจำลอง role ใน production
- **Don't:** แสดง token, service key, face embedding หรือ OCR raw text ใน UI/log
