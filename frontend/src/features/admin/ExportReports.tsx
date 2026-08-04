import { useEffect, useState } from 'react';
import axios from 'axios';
import { FileText, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import pdfMake from 'pdfmake/build/pdfmake';
// 🌟 ตั้งค่าฟอนต์ภาษาไทยให้กับ pdfmake (โหลดจากโฟลเดอร์ public/fonts)
const pdfMakeAny = pdfMake as any;
pdfMakeAny.fonts = {
  THSarabunNew: {
    normal: `${window.location.origin}/fonts/THSarabunNew.ttf`,
    bold: `${window.location.origin}/fonts/THSarabunNew Bold.ttf`,
    italics: `${window.location.origin}/fonts/THSarabunNew Italic.ttf`,
    bolditalics: `${window.location.origin}/fonts/THSarabunNew BoldItalic.ttf`
  }
};

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

      // เตรียมข้อมูลดิบ
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
      
      // 🌟 [ปรับปรุงใหม่] สร้าง PDF ด้วย pdfmake
      else if (format === 'pdf') {
        // กำหนดโครงสร้างเอกสาร (Document Definition)
        const docDefinition: any = {
          pageSize: 'A4',
          pageOrientation: 'landscape',
          defaultStyle: {
            font: 'THSarabunNew', // เรียกใช้ฟอนต์ไทยเป็นค่าเริ่มต้น
            fontSize: 14
          },
          content: [
            { 
              text: `รายงานประวัติการเข้าเรียน - รหัสวิชา: ${courseCode}`, 
              style: 'header',
              margin: [0, 0, 0, 15] // เว้นระยะห่างด้านล่าง 15
            },
            {
              table: {
                headerRows: 1,
                widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'], // '*' หมายถึงให้ขยายความกว้างเต็มพื้นที่ที่เหลือ
                body: [
                  [
                    { text: 'ลำดับ', style: 'tableHeader' },
                    { text: 'รหัสนักศึกษา', style: 'tableHeader' },
                    { text: 'ชื่อ-นามสกุล', style: 'tableHeader' },
                    { text: 'สถานะ', style: 'tableHeader' },
                    { text: 'วิธีการเช็คชื่อ', style: 'tableHeader' },
                    { text: 'เวลา', style: 'tableHeader' }
                  ],
                  // ข้อมูลนักศึกษา
                  ...data.map((row: any, index: number) => [
                    (index + 1).toString(),
                    row.student_id,
                    row.full_name,
                    row.status === 'present' ? 'มาเรียน' : row.status === 'late' ? 'มาสาย' : 'ขาดเรียน',
                    row.method === 'nfc' ? 'NFC' : row.method === 'face_ocr' ? 'Face Scan' : 'Manual',
                    new Date(row.check_in_time).toLocaleString('th-TH')
                  ])
                ]
              },
              layout: 'lightHorizontalLines' // ใส่เส้นขอบแบบบางแนวนอนให้ดูสะอาดตา
            }
          ],
          styles: {
            header: {
              fontSize: 18,
              bold: true
            },
            tableHeader: {
              bold: true,
              fontSize: 14,
              color: 'white',
              fillColor: '#dc2626', // สีแดงแบบฉบับโปรเจกต์คุณ
              alignment: 'center'
            }
          }
        };

        // สั่งสร้างและดาวน์โหลด
        pdfMake.createPdf(docDefinition).download(`${filename}.pdf`);
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
