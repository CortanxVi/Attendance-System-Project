import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FileText, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

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
        alert("ไม่มีข้อมูลการเช็คชื่อสำหรับวิชานี้");
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
        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
        XLSX.writeFile(workbook, `${filename}.xlsx`);
      } 
      else if (format === 'csv') {
        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        // สร้างไฟล์และสั่งดาวน์โหลด
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
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
        const doc = new jsPDF();
        
        // ฟอนต์ภาษาไทยสำหรับ PDF อาจจะต้องเตรียมฟอนต์ฝังในระบบ (ปัจจุบันใช้ ASCII ไปก่อนหรือจัดโครงสร้างง่ายๆ)
        // เพื่อความเรียบง่าย ใช้ jsPDF พิมพ์ภาษาอังกฤษแทน หรือสามารถปรับปรุงภายหลังโดยการเพิ่ม Custom Font
        const tableColumn = ["No", "Student ID", "Name", "Status", "Method", "Time"];
        const tableRows = data.map((row: any, index: number) => [
          index + 1,
          row.student_id,
          // การแสดงผลภาษาไทยใน PDF ต้องใช้ฟอนต์ที่รองรับ ถ้าไม่รองรับอาจจะแสดงเป็นตัวยึกยือ
          // ในที่นี้อาจจะใช้แค่รหัสนักศึกษาไปก่อน
          row.full_name, 
          row.status,
          row.method,
          new Date(row.check_in_time).toLocaleString('en-GB')
        ]);

        doc.text(`Attendance Report - Course: ${courseCode}`, 14, 15);
        
        (doc as any).autoTable({
          head: [tableColumn],
          body: tableRows,
          startY: 20,
        });
        
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
