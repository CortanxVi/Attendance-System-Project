console.log("--- Testing OCR KMUTNB ID Regex Parser ---");

const testCases = [
  "Student ID: 6401012345678 name: Somchai", // ชัดเจน
  "ID 6401012345678",                    // ข้อความสั้น
  "รหัสประจำตัวนักศึกษา 6401012345678",       // ปนภาษาไทย
  "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ Noise 12345 and then 6401012345678", // มีตัวเลขอื่นปน
  "This has no ID just some numbers 123456", // ขาด (มีแค่ 6 หลัก)
  "This has a 14 digit number 12345678901234", // เกิน (14 หลัก)
];

let passed = 0;
const regex = /\b\d{13}\b/; // ตรรกะดึง 13 หลักเป๊ะๆ

for (let i = 0; i < testCases.length; i++) {
  const match = testCases[i].match(regex);
  if (i < 4) {
    // ต้องเจอ 6401012345678
    if (match && match[0] === "6401012345678") {
      console.log(`[PASS] Test ${i + 1}: สำเร็จ (สกัดพบรหัส ${match[0]})`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${i + 1}: ล้มเหลว`);
    }
  } else {
    // ต้องไม่เจออะไรเลย
    if (!match) {
      console.log(`[PASS] Test ${i + 1}: สำเร็จ (ตัดข้อมูลขยะทิ้งถูกต้อง)`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${i + 1}: ล้มเหลว (สกัดขยะมาด้วย: ${match[0]})`);
    }
  }
}

console.log("\n------------------------------------------------");
if (passed === testCases.length) {
  console.log("✓ OCR Regex Logic Tests Passed Completely!\n");
} else {
  console.error("X OCR Regex Logic Tests Failed!\n");
}
