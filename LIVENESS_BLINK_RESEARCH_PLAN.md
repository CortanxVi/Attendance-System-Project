# แผนปรับ Liveness เป็น “เข้าใกล้–กลับเข้ากรอบ–กะพริบตา”

วันที่: 6 กันยายน 2026  
สถานะ: แผนวิจัยก่อนแก้โค้ด

## ข้อสรุปสำหรับตัดสินใจ

สามารถเปลี่ยนคำสั่งหันซ้าย/ขวาเป็นการกะพริบตาได้ แต่ **ห้ามใช้การกะพริบตาเป็นคำตัดสิน Liveness เพียงอย่างเดียว** เพราะวิดีโอ replay และ deepfake สามารถมีการกะพริบตาที่สมจริงอยู่แล้ว

รูปแบบที่แนะนำคือ Hybrid:

1. วางหน้าในกรอบและปรับเทียบตาที่เปิด
2. ขยับเข้าใกล้และกลับเข้ากรอบ
3. ระบบจึงเปิดเผยคำสั่งให้กะพริบตา
4. ตรวจ Passive PAD พร้อมกัน
5. Backend ตรวจลำดับภาพจริงอีกครั้ง
6. ผ่านแล้วจึงเลือกเฟรมหน้าตรงไปทำ Face Recognition

ค่าเริ่มต้นควรให้กะพริบ **1 ครั้ง** เพื่อให้จบใน 3–5 วินาที ส่วน 2 ครั้งใช้เมื่อคะแนนก้ำกึ่งหรือความเสี่ยงสูง การใช้ “กะพริบหนึ่งครั้งแบบเดิมทุกครั้ง” มีรูปแบบคาดเดาได้ง่ายเกินไป

## ประเมินเอกสารที่แนบ

งาน *Liveness Detection Based on Human eye Blinking for Photo Attacks* ใช้ dlib 68 landmarks และ EAR โดยตั้ง `EAR < 0.30` ติดต่อกัน 3 เฟรมที่ 30 FPS และเฝ้าดูมากกว่า 9 ครั้งใน 30 วินาที งานแสดงกรณีคนจริงเทียบกับภาพถ่าย แต่ไม่ได้ทดสอบวิดีโอ replay, deepfake, virtual camera หรือรายงาน APCER/BPCER ดังนั้นนำแนวคิด EAR มาใช้ได้ แต่ **ห้ามคัดลอก threshold และกฎ 30 วินาทีมาใช้กับ production** [อ่านงานต้นฉบับ](https://www.researchgate.net/publication/364095713_Liveness_Detection_Based_on_Human_eye_Blinking_for_Photo_Attacks)

งานต้นฉบับของ Soukupová และ Čech แสดงว่า EAR หนึ่งเฟรมไม่พอ เพราะค่า landmark อาจสั่นหรือเกิดจากการแสดงสีหน้า จึงใช้รูปแบบ EAR ต่อเนื่องในหน้าต่าง 13 เฟรมที่ 30 FPS งานยังพบว่าจุดตัดที่เหมาะสมต่างกันมากระหว่างชุดข้อมูล จึงสนับสนุนการปรับเทียบตามบุคคล/กล้องแทน threshold ตายตัว [Real-Time Eye Blink Detection using Facial Landmarks](https://vision.fe.uni-lj.si/cvww2016/proceedings/papers/05.pdf)

## วิธีคำนวณที่แนะนำ

สำหรับจุดรอบตา 6 จุด:

```text
EAR(t) = (distance(p2,p6) + distance(p3,p5))
         / (2 × distance(p1,p4))
```

ให้คำนวณแยกตาซ้ายและขวา แล้วเก็บค่าเปิดตาปกติ 0.5–0.8 วินาที:

```text
B_left  = median(EAR_left ในช่วงลืมตา)
B_right = median(EAR_right ในช่วงลืมตา)

nEAR_left(t)  = EAR_left(t)  / B_left
nEAR_right(t) = EAR_right(t) / B_right
```

ข้อดีคือคนตาเล็ก ตาโต หรือดวงตาสองข้างไม่สมมาตรจะไม่ถูกตัดสินด้วยเลขเดียวกันทั้งหมด งาน Modified/Personalized EAR สนับสนุนว่าความแตกต่างของขนาดตาทำให้ threshold เดียวให้ผลไม่สม่ำเสมอ [Personalized 3D EAR](https://www.jstage.jst.go.jp/article/pjsai/JSAI2024/0/JSAI2024_4I3GS702/_pdf/-char/en)

## State machine ของการกะพริบ

Backend และ frontend ต้องพบลำดับครบ:

```text
OPEN_STABLE → CLOSING → CLOSED → OPENING → OPEN_STABLE
```

เกณฑ์เริ่มต้นสำหรับทดลอง—not ค่ารับรอง:

- ปิดตา: `nEAR` ของตาทั้งสองข้างลดเหลือประมาณ `0.60–0.70` หรือต่ำกว่า
- ลืมตาอีกครั้ง: ตาทั้งสองกลับถึงประมาณ `0.82–0.90`
- เวลาปิด–เปิดครบหนึ่งรอบ: เริ่มทดลองที่ `80–700 ms`
- เป้าหมายการวิเคราะห์ `15–30 FPS`; หากอัตราจริงต่ำกว่า `10 FPS` ต่อเนื่องให้หยุดและแจ้งว่ากล้อง/เครื่องไม่พร้อม
- ต้องเห็นแนวโน้มค่าลดลงก่อนปิดและเพิ่มขึ้นหลังเปิด ไม่ยอมรับเพียงเฟรมตาปิดหนึ่งภาพ
- ตาทั้งสองต้องเคลื่อนไหวสอดคล้องกัน และใบหน้าเดิมต้องอยู่ในเฟรมตลอด

ตัวเลขเหล่านี้ต้องปรับด้วยข้อมูลทดสอบจริงและกราฟ ROC/DET ไม่ใช่ hard-code เป็นมาตรฐานสากล

## จุด MediaPipe ที่ใช้

การจับคู่ด้านล่างอนุมานจาก topology อย่างเป็นทางการของ MediaPipe ไม่ใช่สูตร Blink ที่ Google รับรองโดยตรง:

- ตาขวาของใบหน้า: มุม `33,133`; คู่แนวตั้ง `(160,144)`, `(159,145)`, `(158,153)`
- ตาซ้ายของใบหน้า: มุม `263,362`; คู่แนวตั้ง `(387,373)`, `(386,374)`, `(385,380)`

ควรย้ายจากแพ็กเกจ Face Mesh รุ่นเดิมไปใช้ Face Landmarker แบบ `VIDEO` และเปิด `outputFaceBlendshapes` เพื่อใช้ `eyeBlinkLeft`/`eyeBlinkRight` ตรวจทานกับ EAR อีกชั้นหนึ่ง เอกสารทางการระบุว่า Face Landmarker ให้ 478 landmarks และ 52 blendshapes แต่การประมวลผลบนเว็บอาจบล็อก UI จึงควรรันใน Web Worker [Google Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)

อย่างไรก็ตาม Blendshape ถูกออกแบบเพื่อการแสดงสีหน้า/AR ไม่ใช่ PAD ที่ผ่านการรับรอง และค่าจะสั่นมากขึ้นเมื่อแสงไม่ดี ภาพเคลื่อนไหว หรือ landmark ไม่เสถียร [Google Blendshape Model Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)

## Challenge ที่เสนอ

1. Backend สร้าง challenge แบบสุ่มและลงลายเซ็น ผูกกับ `user + course + attendance session + QR challenge + nonce + expiry`
2. เปิดเผยคำสั่งทีละขั้น ไม่ส่งลำดับทั้งหมดให้ผู้ใช้ล่วงหน้า
3. เก็บ baseline ขณะหน้าตรงและลืมตา 0.5–0.8 วินาที
4. ให้เข้าใกล้กล้องแล้วกลับเข้ากรอบ ตรวจการเปลี่ยนขนาดอย่างต่อเนื่องและบุคคลต้องไม่เปลี่ยน
5. เมื่อกลับเข้ากรอบนิ่งแล้ว จึงสุ่มเวลาแสดง “กะพริบตา 1 ครั้ง”
6. หากคุณภาพหรือคะแนนอยู่ช่วงก้ำกึ่ง ให้ step-up เป็น “กะพริบ 2 ครั้ง” แทนการผ่านทันที
7. Challenge ใช้ครั้งเดียวและมีเวลาสั้น หากสลับหน้า ภาพค้าง เฟรมกระโดด หรือจำนวนครั้งไม่ตรงให้เริ่มใหม่

การสุ่มมีไว้ลดโอกาสเลือกวิดีโอที่ตรงคำสั่ง ไม่ควรกล่าวอ้างว่าเป็นความปลอดภัยเชิงเข้ารหัส ความปลอดภัยจริงมาจาก nonce, one-use, TTL, จำกัดจำนวนครั้ง, Backend ตรวจซ้ำ และ Passive PAD รวมกัน

## เหตุผลที่ยังต้องมี Passive PAD

- ภาพพิมพ์แบบเจาะช่องตาสามารถแสดงการกะพริบของคนที่อยู่ด้านหลังได้
- ผู้โจมตีสามารถขยับรูปหรือโทรศัพท์เข้า–ออกให้ขนาดใบหน้าเปลี่ยนตาม Challenge
- วิดีโอ replay มีลำดับเปิด–ปิด–เปิดจริงอยู่แล้ว
- Virtual camera หรือ real-time deepfake สามารถส่งเฟรมข้ามอุปกรณ์รับภาพได้

FIDO จำแนกภาพพิมพ์แบบเจาะช่อง วิดีโอที่มีการกะพริบ Deepfake และการฉีดข้อมูลเข้ากล้องเป็นคนละชนิดการโจมตี จึงไม่ควรรวมว่า “ตรวจพบ Blink = เป็นบุคคลจริง” [FIDO Biometrics Requirements v4.1](https://fidoalliance.org/specs/biometric/requirements/Biometrics-Requirements-v4.1-fd-20250106.html)

ชั้น Passive ควรตรวจอย่างน้อยลาย moiré/สิ่งบ่งชี้หน้าจอ ความผิดปกติของสีและแสง เฟรมซ้ำ/ภาพค้าง การตัดต่อฉับพลัน ความแบนและความต่อเนื่องของการเคลื่อนไหว งาน replay-attack แสดงว่าสิ่งบ่งชี้จากจอ เช่น moiré และ image distortion ใช้แยกภาพที่ถูกถ่ายซ้ำจากจอได้ แต่ต้องทดสอบข้ามอุปกรณ์จริง [Patel et al., 2015](https://biometrics.cse.msu.edu/Publications/Face/PatelHanJainOtt_LivevsSpoofFaceVideo_ICB15.pdf)

## ช่องโหว่ของระบบปัจจุบันที่พบจากการอ่านโค้ด

1. ใช้ baseline EAR ค่าเดียวร่วมกับตาทั้งสองข้าง ทำให้ความไม่สมมาตรของดวงตากระทบผลตรวจ
2. ประมวลผลประมาณ 1 เฟรมทุก 66 ms หรือราว 15 FPS แต่บังคับตาปิด 2 เฟรม จึงมีโอกาสพลาด Blink ที่เร็ว
3. ถ่าย screenshot หลัง callback ของ FaceMesh ภาพที่บันทึกอาจไม่ใช่เฟรมเดียวกับที่คำนวณว่าตาปิด
4. Backend ได้เพียงภาพหน้าตรง ภาพตาปิด และภาพหันหน้า จึงพิสูจน์ลำดับ `OPEN→CLOSED→OPEN` เองไม่ได้
5. ค่า `liveness_evidence` เป็น JSON จาก client; ลายเซ็นป้องกันการแก้ challenge แต่ไม่ได้พิสูจน์ว่าค่า EAR มาจากกล้องจริง
6. Backend ตรวจตาปิดจาก landmark ของ InsightFace หนึ่งเฟรม ซึ่งไม่ใช่ตัวตรวจ replay
7. type, API, backend, tests และเอกสารหลายจุดยังผูกกับ `turn_left`, `turn_right` และ `liveness_turn_image`

## หลักฐานที่ควรส่งให้ Backend

ตัวเลือกเหมาะสมคือคลิปสั้น 3–5 วินาทีที่บีบอัด หรือชุดเฟรมพร้อม timestamp ครอบคลุมก่อนเข้าใกล้ ช่วงกลับเข้ากรอบ ก่อนปิดตา ตาปิด เปิดตา และหลังเปิดตา Backend ต้องคำนวณ landmark, EAR, timing, face count และความต่อเนื่องเอง

Client ใช้ตรวจแบบ realtime เพื่อแนะนำผู้ใช้ได้ แต่ห้ามใช้ `livenessPassed: true` จาก Client เป็นคำตัดสินสุดท้าย เมื่อผ่านแล้วให้เลือกเฟรมหน้าตรง ตาเปิด คมชัดที่สุดไปสร้าง face embedding ห้ามเลือกเฟรมตาปิด

## แผนพัฒนาหลังอนุมัติ

1. สร้าง Liveness protocol v2 และ schema ใหม่: `near_return + blink`, จำนวน Blink สำหรับ step-up และ evidence แบบ temporal
2. ปรับ frontend เป็น Face Landmarker VIDEO + Web Worker, baseline แยกสองตา และ state machine ตาม timestamp
3. ปรับการ capture ให้หลักฐานผูกกับเฟรมที่วิเคราะห์จริง และรายงาน effective FPS/quality
4. เปลี่ยน API/Backend จากภาพหันหน้าเป็นหลักฐานลำดับเวลา และคำนวณซ้ำฝั่ง server
5. เพิ่ม Passive PAD สำหรับ print/screen/replay และตรวจ duplicate/frozen/cut frames
6. ปรับ unit, integration, security และ load tests พร้อมแก้ README, DESIGN.md และ UX-CONTRACT.md
7. ทดลอง pilot แล้วค่อยล็อก threshold สำหรับ production

## เกณฑ์ผ่านก่อน production

ต้องรายงานแยกตามชนิดการโจมตี ไม่ใช้ Accuracy รวมเพียงตัวเดียว ตามหลัก ISO/IEC 30107-3 [มาตรฐาน ISO](https://www.iso.org/standard/79520.html)

- Blink precision, recall และ F1
- APCER/IAPAR แยกภาพพิมพ์ ภาพบนจอ replay และ deepfake
- BPCER/FRR ของผู้ใช้จริง
- retry rate
- เวลาจบ Challenge p50/p95
- backend latency p95 เมื่อมี 30–40 คนพร้อมกัน

ชุดทดสอบต้องมีผู้ใส่แว่น คนตาเล็ก/ตาตก กล้องหน้าและหลัง แสงน้อย/ย้อนแสง และการโจมตีด้วยภาพพิมพ์ ภาพเจาะช่องตา ภาพนิ่งบนจอ วิดีโอ Blink 1/2 ครั้ง วิดีโอเร่ง/เลื่อนเวลา Deepfake และ virtual camera การทดสอบ PAD ควรจัดหมวดและรายงานตามชนิดการโจมตี [NISTIR 8491](https://doi.org/10.6028/NIST.IR.8491)

## ข้อจำกัดที่ต้องยอมรับ

ยังไม่มีหลักฐานต้นฉบับที่รับรองว่า MediaPipe EAR หรือ eye-blink blendshape เป็น production PAD ที่ป้องกัน replay/deepfake ได้ เว็บ RGB ทั่วไปจึงไม่สามารถรับประกันการบล็อก virtual camera หรือ real-time deepfake ได้ 100% หากต้องการระดับนั้นต้องเพิ่ม trusted kiosk/native app, device attestation หรือกล้อง depth/IR

