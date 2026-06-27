import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FileText, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from "jspdf"; // ไม่มีคำสั่งสร้างตารางสำเร็จรูป
import autoTable from "jspdf-autotable";

export default function ExportReports() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/admin/courses');
      setCourses(res.data.courses || []);
    } catch (err) {
      console.error("Error fetching courses", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (courseId: string, courseCode: string, format: 'excel' | 'csv' | 'pdf') => {
    try {
      const res = await axios.get(`/api/v1/admin/export/attendance/${courseId}`);
      const data = res.data.records || [];
      const course = res.data.course;

      if (data.length === 0) {
        alert("ไม่มีข้อมูลการเช็คชื่อในรายวิชานี้");
        return;
      }

      // เตรียมข้อมูลให้อ่านง่าย
      const formattedData = data.map((row: any, index: number) => ({
        "ลำดับ": index + 1,
        "รหัสนักศึกษา": row.student_id,
        "ชื่อ-นามสกุล": row.full_name,
        "สถานะ": row.status === 'present' ? 'มาเรียน' : row.status === 'late' ? 'มาสาย' : 'ขาดเรียน',
        "วิธีการ": row.method === 'nfc' ? 'NFC' : row.method === 'face_ocr' ? 'Face Scan' : 'Manual',
        "เวลา": new Date(row.check_in_time).toLocaleString('th-TH')
      }));

      const filename = `Attendance_${courseCode}_${new Date().getTime()}`;

      if (format === 'excel') {
        // แปลงข้อมูลประเภท Array of Objects (JSON) ให้กลายเป็นโครงสร้างข้อมูลแบบ Worksheet (แผ่นงาน)
        const worksheet = XLSX.utils.json_to_sheet(formattedData);       // หน้าแท็บชีต (Sheet1, Sheet2)" ที่อยู่ข้างในไฟล์ Excel
        const workbook = XLSX.utils.book_new();                          // สร้าง Workbook (ไฟล์ Excel เปล่าๆ) ขึ้นมาใหม่ 1 ไฟล์
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance"); // นำ Worksheet ประกอบร่างเข้าไปใน Workbook (ไฟล์หลัก, แผ่นงานที่ต้องการใส่, "ชื่อแท็บของชีตนั้น")
        XLSX.writeFile(workbook, `${filename}.xlsx`);                    // สร้างเป็นไฟล์จริงๆ และทริกเกอร์ให้เบราว์เซอร์ดาวน์โหลดไฟล์ลงเครื่องของผู้ใช้
      } 
      else if (format === 'csv') {
        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const csv = XLSX.utils.sheet_to_csv(worksheet); // แปลงโครงสร้างข้อมูล Worksheet ให้กลายเป็นข้อความ (String) ในรูปแบบ CSV
        // สร้างไฟล์และสั่งดาวน์โหลด
        // \uFEFF BOM (Byte Order Mark) เป็นเทคนิคที่ใส่ไว้เพื่อให้โปรแกรมอย่าง Microsoft Excel รู้ว่าไฟล์ CSV นี้เข้ารหัสแบบ UTF-8 หากไม่ใส่ตรงนี้ เวลาเปิด CSV ด้วย Excel ภาษาไทยมักจะกลายเป็นตัวอักษรต่างด้าว
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' }); // แก้ปัญหาภาษาไทยเพี้ยนใน CSV
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      else if (format === 'pdf') {
        // 1. สร้างกระดาษ A4 แนวนอน (Landscape)
        const doc = new jsPDF({ orientation: 'landscape' }); 
        try {
            // 2. ดึงไฟล์ฟอนต์จากโฟลเดอร์ public/fonts/
            const fontUrl = '/fonts/THSarabunNew.ttf'; 
            const fontResponse = await fetch(fontUrl);
            
            if (!fontResponse.ok) {
                throw new Error("ไม่พบไฟล์ฟอนต์ THSarabunNew.ttf ในโฟลเดอร์ public/fonts/");
            }

            // 3. แปลงไฟล์ฟอนต์ให้กลายเป็น Base64 เพื่อฝังลง PDF
            const fontBuffer = await fontResponse.arrayBuffer();
            const fontBytes = new Uint8Array(fontBuffer);
            let binary = '';
            for (let i = 0; i < fontBytes.byteLength; i++) {
                binary += String.fromCharCode(fontBytes[i]);
            }
            const fontBase64 = window.btoa(binary);

            // 4. ติดตั้งฟอนต์ภาษาไทยเข้าสู่ jsPDF
            doc.addFileToVFS('THSarabun.ttf', fontBase64);
            doc.addFont('THSarabun.ttf', 'THSarabun', 'normal');
            doc.setFont('THSarabun'); // สั่งให้ใช้ฟอนต์นี้เป็นค่าเริ่มต้น
        } catch (fontErr) {
            console.warn("โหลดฟอนต์ไทยไม่สำเร็จ จะใช้ค่าเริ่มต้นแทน", fontErr);
            alert("คำเตือน: โหลดฟอนต์ภาษาไทยไม่สำเร็จ ตัวอักษรอาจแสดงผลผิดเพี้ยน");
        }

        // 5. เตรียมข้อมูลให้ตรงกันกับ Excel และเป็นภาษาไทย
        const tableColumn = ["ลำดับ", "รหัสนักศึกษา", "ชื่อ-นามสกุล", "สถานะ", "วิธีการเช็คชื่อ", "เวลา"];
        const tableRows = data.map((row: any, index: number) => [
          index + 1,
          row.student_id,
          row.full_name, 
          row.status === 'present' ? 'มาเรียน' : row.status === 'late' ? 'มาสาย' : 'ขาดเรียน',
          row.method === 'nfc' ? 'NFC' : row.method === 'face_ocr' ? 'Face Scan' : 'Manual',
          new Date(row.check_in_time).toLocaleString('th-TH') // เวลาภาษาไทย
        ]);

        // 6. พิมพ์หัวรายงาน (ตั้งค่าขนาดฟอนต์เป็น 16)
        doc.setFontSize(16);
        doc.text(`รายงานประวัติการเข้าเรียน - รหัสวิชา: ${courseCode}`, 14, 15);
        
        // 7. วาดตาราง (กำหนดสไตล์ให้ใช้ฟอนต์ THSarabun)
        // เรียกใช้ฟังก์ชัน autoTable() โดยตรงแล้วส่ง doc เข้าไป
        autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 20, // ให้ตารางเริ่มต่ำลงมาจากข้อความบรรทัดบน
          styles: { 
            font: 'THSarabun', // บังคับให้ตารางใช้ฟอนต์ภาษาไทย
            fontSize: 12 
          },
          headStyles: {
            fillColor: [220, 38, 38], // เปลี่ยนสีหัวตารางเป็นสีแดง (อิงตามธีมระบบคุณ)
            textColor: [255, 255, 255],
            fontStyle: 'bold'
          }
        });
        
        // 8. บันทึกและดาวน์โหลด
        doc.save(`${filename}.pdf`);
      }

    } catch (err: any) {
      alert(`Export ล้มเหลว: ${err.response?.data?.detail || err.message}`);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-fade-in">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <FileSpreadsheet className="text-red-500" /> ออกรายงานการเช็คชื่อ
      </h2>

      {loading ? (
        <div className="text-center py-10 text-gray-500">กำลังโหลดรายวิชา...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map(course => (
            <div key={course.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="inline-block px-3 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-full mb-2">
                    {course.course_code}
                  </span>
                  <h3 className="font-bold text-lg text-gray-900">{course.course_name}</h3>
                  <p className="text-sm text-gray-500">เทอม {course.semester}/{course.year} | Sec {course.section}</p>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">เลือกรูปแบบไฟล์</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => handleExport(course.id, course.course_code, 'excel')} className="bg-green-50 hover:bg-green-100 text-green-700 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors">
                    <Download size={14} /> Excel
                  </button>
                  <button onClick={() => handleExport(course.id, course.course_code, 'csv')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors">
                    <Download size={14} /> CSV
                  </button>
                  <button onClick={() => handleExport(course.id, course.course_code, 'pdf')} className="bg-red-50 hover:bg-red-100 text-red-700 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors">
                    <Download size={14} /> PDF
                  </button>
                </div>
              </div>
            </div>
          ))}
          {courses.length === 0 && (
            <div className="col-span-full text-center py-8 text-gray-500">ไม่มีข้อมูลรายวิชาในระบบ</div>
          )}
        </div>
      )}
    </div>
  );
}
