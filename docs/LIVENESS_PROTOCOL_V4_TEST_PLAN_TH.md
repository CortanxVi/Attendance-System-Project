# แผนทดสอบ Liveness Protocol v4 บน branch `livenessFeature`

## 1. วัตถุประสงค์

Protocol v4 เป็นระบบทดลองสำหรับขั้นตอนเช็กชื่อด้วยใบหน้า มีเป้าหมายเพิ่มการป้องกันภัย 5 กลุ่ม โดยรักษาการใช้งานให้สั้นและเข้าใจง่าย:

1. รูปถ่ายบนกระดาษ
2. รูปบนหน้าจอโทรศัพท์หรือแท็บเล็ต
3. วิดีโอ Replay ที่เตรียมไว้ล่วงหน้า
4. การส่ง Request ซ้ำหรือพร้อมกัน
5. การนำ Challenge ของผู้ใช้อื่นมาใช้

การลงทะเบียนใบหน้ายังคงใช้ Protocol v3 แบบ Passive ส่วน Protocol v4 ใช้เฉพาะการเช็กชื่อใน branch ทดลองนี้ เพื่อจำกัดผลกระทบและทำให้เปรียบเทียบกับระบบเดิมได้

## 2. Threat Model และขอบเขตการรับประกัน

| ภัย | กลไกป้องกัน | ผลที่คาดหวัง |
|---|---|---|
| ภาพพิมพ์ | MiniFAS Passive PAD 3 เฟรม, ตรวจเฟรมซ้ำ, คำสั่งสุ่ม | ปฏิเสธภาพพิมพ์ทั่วไปและภาพพิมพ์ที่ขยับหน้ากล้อง |
| ภาพบนหน้าจอ | Passive PAD, หลายเฟรม, คำสั่งสุ่มและ Recovery | ปฏิเสธภาพนิ่งบนโทรศัพท์/แท็บเล็ตและเพิ่มต้นทุนการโจมตีด้วยหน้าจอ |
| วิดีโอ Replay | Backend สุ่ม `blink` หรือ `move_closer`, สุ่มเวลาหน่วง, ตรวจภาพ Action/Recovery ใหม่ | ปฏิเสธวิดีโอทั่วไปที่ไม่ตรงกับคำสั่งและจังหวะของ Challenge |
| Request ซ้ำ | Supabase Claim lease, Processing token, Unique attendance, Atomic finalize และ Consumed timestamp | ประมวลผล Challenge เดียวได้ครั้งเดียวและไม่สร้าง Attendance ซ้ำ |
| Challenge ของผู้อื่น | HMAC token ผูก Challenge ID, Account ID และ Session ID; Backend query ด้วยผู้ใช้ที่ยืนยันจาก JWT | ผู้ใช้หรือห้องเรียนที่ไม่ตรงกันได้รับ HTTP 403 |

ระบบนี้ใช้กล้อง RGB ผ่าน Browser จึงไม่รับประกันการป้องกัน Deepfake แบบตอบสนองทันที, Virtual Camera, การฉีดวิดีโอเข้า Browser หรือหน้ากากสามมิติระดับสูง การทดสอบต้องรายงานเป็นอัตราการตรวจจับจริง ห้ามอธิบายว่า “ป้องกันได้ 100%” หรือ “ผ่าน ISO/IEC 30107” โดยไม่มีผลทดสอบตามมาตรฐาน

## 3. ลำดับการทำงาน

1. นักศึกษาสแกน Dynamic QR ล่าสุด
2. Backend ตรวจ Session, QR, การลงทะเบียนรายวิชา และรายการเช็กชื่อเดิม
3. Backend สร้างแถว `attendance_checkin_challenges`
4. Backend สร้าง HMAC token รุ่น 4 ซึ่งมี:
   - Challenge ID
   - Account ID
   - Attendance Session ID
   - เวลาสร้างและหมดอายุ
   - Nonce สุ่ม
   - คำสั่ง `blink` หรือ `move_closer`
   - เวลาหน่วง 500–1,400 มิลลิวินาที
5. Browser ใช้ MediaPipe Face Landmarker ใน Web Worker ตรวจหนึ่งใบหน้า ตำแหน่ง ขนาด ดวงตา และมุมใบหน้า
6. Browser เก็บ Passive frame 3 เฟรม ห่างกันประมาณ 450 มิลลิวินาที
7. หลังเวลาหน่วง Browser แสดงคำสั่งภาษาไทยเพียงหนึ่งคำสั่ง
8. Browser เก็บภาพขณะทำคำสั่งและภาพ Recovery หลังกลับสู่ท่าปกติ
9. ผู้ใช้กดยืนยัน แล้ว Frontend ส่งภาพรวม 5 เฟรมและ Evidence JSON ไป Backend
10. Backend ตรวจ Token/Evidence ก่อน Claim เพื่อไม่ใช้ทรัพยากร Face/PAD กับคำขอที่ผิดรูปแบบ
11. Backend Claim Challenge ด้วย Processing token เพื่อกันคำขอพร้อมกัน
12. Backend ถอดรหัสภาพ ตรวจหนึ่งใบหน้า บุคคลเดิม Passive PAD รูปทรง Action และ Recovery ใหม่ทั้งหมด
13. Backend เปรียบเทียบ Embedding กับใบหน้าที่ลงทะเบียน
14. Supabase RPC สร้าง Attendance และ Consume Challenge ใน Transaction เดียว
15. ภาพทั้ง 5 เฟรมอยู่ในหน่วยความจำระหว่าง Request และไม่ถูกบันทึกเป็น Attendance photo

## 4. เกณฑ์การตรวจคำสั่ง

### กะพริบตา

- ต้องปิดตาทั้งสองข้าง ไม่ยอมรับการขยิบตาข้างเดียว
- ใช้ทั้ง EAR และ MediaPipe Blink Blendshape ที่ Browser
- Backend ใช้ Eye aperture จากภาพจริง ไม่เชื่อค่า Browser
- มุมก้มเงยและหันหน้าต้องอยู่ในขอบเขต
- หลังจากนั้นต้องมี Recovery frame ที่ลืมตาและมองตรง

### ขยับเข้าใกล้

- ใบหน้าต้องขยายอย่างน้อยประมาณ 8% และไม่เกินขอบเขตที่กำหนด
- ต้องเป็นบุคคลเดียวกัน
- ต้องไม่หันหน้าหรือก้มเงยมากเพื่อหลอกขนาดใบหน้า
- Recovery frame ต้องกลับมาใกล้ขนาดและตำแหน่งเดิม

Threshold เหล่านี้เป็นค่าทดลอง ห้ามลดจากผลของผู้ใช้หรืออุปกรณ์เพียงหนึ่งครั้ง ต้องปรับจากชุด Calibration และวัด False Accept/False Reject แยกกัน

## 5. ชุดทดสอบที่ต้องเตรียม

ห้ามใช้ข้อมูลนักศึกษาจริงโดยไม่มีความยินยอม ให้ใช้ผู้ทดสอบที่ยินยอมและเก็บผลแบบไม่ระบุตัวบุคคล

### Genuine attempts

- iPhone Safari และ PWA
- Android Chrome และ PWA
- Notebook webcam
- โทรศัพท์ระดับล่าง กลาง และสูง
- แสงห้องปกติ แสงน้อย แสงย้อน และกลางแจ้ง
- ผู้ใส่แว่นและไม่ใส่แว่น
- อินเทอร์เน็ตปกติ ช้า และมี Packet loss

### ภาพพิมพ์

- กระดาษธรรมดาและกระดาษมัน
- สีและขาวดำ
- ภาพขนาด A4 และภาพตัดเฉพาะใบหน้า
- ถือภาพนิ่ง ขยับเข้าใกล้ และงอกระดาษเพื่อสร้างการเคลื่อนไหว

### ภาพบนหน้าจอ

- โทรศัพท์และแท็บเล็ต
- ความสว่างต่ำ กลาง และสูง
- ภาพเต็มจอและซูมเฉพาะใบหน้า
- ขยับอุปกรณ์เข้าใกล้ตามคำสั่ง

### วิดีโอ Replay

- วิดีโอมองตรงอย่างเดียว
- วิดีโอกะพริบตา
- วิดีโอขยับเข้าใกล้
- วิดีโอที่มีทั้งสองท่าแต่ลำดับไม่ตรง Challenge
- เริ่มเล่นก่อนและหลังคำสั่งปรากฏ
- Replay บนจอที่ความสว่างและ Refresh rate ต่างกัน

### Request และ Challenge

- ส่ง Request เดิมซ้ำหลังสำเร็จ
- ส่ง Request เดียวกันพร้อมกัน 2–10 คำขอ
- เปลี่ยน Challenge ID โดยคง Token เดิม
- เปลี่ยน Session ID
- ใช้ Token ของบัญชี A กับ JWT ของบัญชี B
- แก้ Action, Prompt delay, Timestamp และจำนวนเฟรมใน Evidence
- ใช้ Token หมดอายุ
- ส่ง Protocol v3 เข้า Endpoint v4

## 6. ผลลัพธ์ที่ต้องบันทึก

เก็บเฉพาะข้อมูลเชิงเทคนิคที่ไม่ระบุตัวบุคคล:

- รหัสชุดทดสอบแบบสุ่ม
- กลุ่มอุปกรณ์และ Browser
- ประเภทแสง
- ประเภทการทดสอบ Genuine/Print/Screen/Replay
- Action ที่ระบบสุ่ม
- ผ่านหรือไม่ผ่าน
- รหัสสาเหตุที่ผ่านการทำให้ปลอดภัย เช่น `PAD_REJECT`, `ACTION_MISMATCH`, `TOKEN_OWNER_MISMATCH`
- เวลารวมและ Backend latency
- จำนวนครั้งที่ลอง

ห้ามบันทึกภาพใบหน้า, Face embedding, Access token, QR token, HMAC token, ชื่อ, รหัสนักศึกษา หรือ URL ภายในลงใน Spreadsheet/Log สำหรับ Calibration

## 7. ตัวชี้วัด

- Genuine first-attempt success rate
- Genuine success rate หลังลองใหม่หนึ่งครั้ง
- BPCER: คนจริงถูกปฏิเสธ
- APCER แยก Print, Screen และ Replay
- Median และ p95 completion time
- Backend p95 latency
- CPU/RAM ของ Mini PC
- อัตรา Request ซ้ำที่สร้าง Attendance มากกว่าหนึ่งแถว ซึ่งต้องเท่ากับศูนย์
- อัตรา Cross-account Challenge ที่ผ่าน ซึ่งต้องเท่ากับศูนย์

เป้าหมายเบื้องต้นสำหรับ Pilot:

- คนจริงผ่านครั้งแรกอย่างน้อย 95%
- ผ่านหลังลองใหม่หนึ่งครั้งอย่างน้อย 98%
- Median ไม่เกิน 4 วินาที และ p95 ไม่เกิน 8 วินาที
- Request ซ้ำไม่สร้าง Attendance ซ้ำ
- Challenge ข้ามบัญชี/Session ไม่ผ่านทุกกรณี

ยังไม่กำหนดเป้าหมาย APCER เป็นตัวเลขจนกว่าจะทราบจำนวนตัวอย่างและชนิดอุปกรณ์โจมตี เพราะการกำหนดค่าจากความรู้สึกจะทำให้ผลทดสอบไม่มีความหมาย

## 8. วิธีรันการตรวจอัตโนมัติ

ใช้ Python virtual environment ของ Backend และ Node.js 22.12 ขึ้นไป:

```bash
cd backend
./.venv/bin/python -m unittest tests.test_liveness_security tests.test_liveness_frames

cd ../frontend
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npm run lint
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npm run test:liveness
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npm run build
```

หากตำแหน่ง Node.js ต่างจากตัวอย่าง ให้ใช้ `nvm use 22` แล้วรัน `npm` ตามปกติ ไม่ควร hard-code path นี้ใน Production script

## 9. การนำไปทดสอบ Preview

- Deploy Frontend จาก branch `livenessFeature`
- Build/รัน Backend จาก commit เดียวกัน เพราะ Frontend v4 ส่งฟิลด์เพิ่มจาก v3
- ไม่ต้องใช้ Supabase migration ใหม่ เนื่องจากใช้ตารางและ RPC ป้องกัน Replay ที่มีอยู่แล้ว
- ห้ามนำ Frontend v4 ไปใช้กับ Backend v3 หรือ Frontend v3 ไปใช้กับ Backend v4
- ทดสอบด้วย Supabase project/environment สำหรับ Preview ถ้ามี เพื่อไม่ให้ Attendance ทดลองปะปน Production
- หากจำเป็นต้องใช้ฐานข้อมูลเดียวกัน ให้ใช้รายวิชา Session และบัญชีทดสอบโดยเฉพาะ และลบข้อมูลตามกระบวนการที่ผู้ดูแลอนุมัติ

## 10. เงื่อนไขก่อนรวมเข้า `main`

1. Automated tests ทั้ง Frontend และ Backend ผ่าน
2. ทดสอบโทรศัพท์จริงตาม Device matrix
3. ทดสอบ Print, Screen และ Replay ตามตาราง
4. ทดสอบ Request พร้อมกันและ Challenge ข้ามบัญชี
5. วัด BPCER/APCER และยืนยัน Threshold จากข้อมูล
6. ตรวจ CPU/RAM/Latency บน Mini PC
7. มีขั้นตอน Manual fallback พร้อม Audit Log สำหรับผู้ใช้ที่ตรวจไม่ผ่าน
8. ผู้ดูแลยอมรับความเสี่ยงคงเหลือเรื่อง Adaptive replay, Deepfake และ Virtual Camera
9. Deploy Frontend และ Backend จาก commit เดียวกัน
10. Merge ผ่าน Pull Request จาก `livenessFeature` เข้า `main` หลังอนุมัติเท่านั้น
