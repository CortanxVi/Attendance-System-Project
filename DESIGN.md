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
  live-feed: {}
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

หน้า dashboard จำกัดความกว้างตามพื้นที่ใช้งานเดิมและใช้จังหวะ 1.5rem ระหว่าง section. นักศึกษาใช้ single-column mobile-first; teacher/admin เปลี่ยน sidebar เป็น navigation มือถือ. Upload และ action สำคัญต้องอยู่เหนือ fold โดยไม่ล็อกความสูงหน้าฟอร์ม

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

### Forms and overlays

ฟอร์มเป็น app-owned validation พร้อม `noValidate`. รูปบัตรรับ JPEG/PNG แล้วปรับอัตโนมัติภายในกรอบ 1920×1920 px โดยคงสัดส่วน ไม่ตัดภาพ และเข้ารหัส JPEG คุณภาพ 94%; ไฟล์ผลลัพธ์ต้องไม่เกิน 8 MB ก่อนส่ง. Toast กลางอยู่ขวาบน, deduplicate 2 วินาที, success 5 วินาที, error คงอยู่จนปิด

ฟอร์ม PIN ใช้ช่อง masked, numeric input 6 หลัก, ปุ่มแสดง/ซ่อนที่มี accessible label และไม่ persist ค่าไว้ใน password/local storage. หน้าสิทธิ์ชั่วคราวต้องมีแถบเตือนสี amber พร้อมเวลาหมดอายุและปุ่มกลับสู่สิทธิ์อาจารย์ที่มองเห็นได้ใน Admin layout

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
