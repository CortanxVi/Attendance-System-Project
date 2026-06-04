export function extractStudentId(text: string): string | null {
    // แยกข้อความเป็นบรรทัด เพื่อป้องกันตัวเลขจากบรรทัดอื่นมาต่อกัน
    const lines = text.split('\n');
    
    for (const line of lines) {
        // ลบช่องว่างและขีดออกเฉพาะในบรรทัดนี้
        const cleanLine = line.replace(/[\s-]/g, '');
        
        // ค้นหาตัวเลข 13 หลักที่ไม่ได้ติดกับตัวเลขอื่น
        const match = cleanLine.match(/(?:^|\D)(\d{13})(?:\D|$)/);
        
        if (match) {
            return match[1];
        }
    }
    
    return null;
}
