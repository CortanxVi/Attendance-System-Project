import { useEffect, useState } from 'react';
import axios from 'axios';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import pdfMake from 'pdfmake/build/pdfmake';
import { supabase } from '../../lib/supabaseClient';
import CourseAttendanceView from './CourseAttendanceView';

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
  
  // States for viewing data in table
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedCourseForView, setSelectedCourseForView] = useState<any>(null);

  useEffect(() => {
    fetchTeacherCourses();
  }, []);

  const fetchTeacherCourses = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const res = await axios.get(`/api/v1/courses/${session.user.id}`);
      setCourses(res.data.courses || []);
    } catch (err) {
      console.error("Error fetching courses", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (courseId: string, courseCode: string, format: 'excel' | 'csv' | 'pdf') => {
    try {
      const res = await axios.get(`/api/v1/teacher/export/attendance/${courseId}`);
      const data = res.data.records || [];
      const course = res.data.course;

      if (data.length === 0) {
        alert("ไม่มีข้อมูลการเช็คชื่อสำหรับวิชานี้");
        return;
      }

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
      else if (format === 'pdf') {
        const docDefinition: any = {
          pageSize: 'A4',
          pageOrientation: 'landscape',
          defaultStyle: {
            font: 'THSarabunNew',
            fontSize: 14
          },
          content: [
            { 
              text: `รายงานประวัติการเข้าเรียน - รหัสวิชา: ${courseCode}`, 
              style: 'header',
              margin: [0, 0, 0, 15]
            },
            {
              table: {
                headerRows: 1,
                widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
                body: [
                  [
                    { text: 'ลำดับ', style: 'tableHeader' },
                    { text: 'รหัสนักศึกษา', style: 'tableHeader' },
                    { text: 'ชื่อ-นามสกุล', style: 'tableHeader' },
                    { text: 'สถานะ', style: 'tableHeader' },
                    { text: 'วิธีการเช็คชื่อ', style: 'tableHeader' },
                    { text: 'เวลา', style: 'tableHeader' }
                  ],
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
              layout: 'lightHorizontalLines'
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
              fillColor: '#ea580c', // Orange-600
              alignment: 'center'
            }
          }
        };

        pdfMake.createPdf(docDefinition).download(`${filename}.pdf`);
      }

    } catch (err: any) {
      alert(`Export ล้มเหลว: ${err.response?.data?.detail || err.message}`);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <FileSpreadsheet className="text-orange-500" /> ส่งออกรายงานการเช็คชื่อ
        </h2>

        {loading ? (
          <div className="text-center py-10 text-gray-500 flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-4"></div>
            กำลังโหลดรายวิชาของคุณ...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map(course => (
              <div key={course.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="inline-block px-3 py-1 bg-orange-50 text-orange-700 text-xs font-bold rounded-full mb-2">
                      {course.course_code}
                    </span>
                    <button 
                      onClick={() => { setSelectedCourseForView(course); setIsViewOpen(true); }}
                      className="block text-left hover:text-orange-600 transition-colors"
                    >
                      <h3 className="font-bold text-lg text-gray-900 underline decoration-gray-300 decoration-1 underline-offset-4 hover:decoration-orange-400">{course.course_name}</h3>
                    </button>
                    <p className="text-sm text-gray-500 mt-1">เทอม {course.semester}/{course.year} | Sec {course.section}</p>
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
                    <button onClick={() => handleExport(course.id, course.course_code, 'pdf')} className="bg-orange-50 hover:bg-orange-100 text-orange-700 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors">
                      <Download size={14} /> PDF
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full text-center py-8 text-gray-500">คุณยังไม่ได้เปิดรายวิชาใดๆ ในระบบ</div>
            )}
          </div>
        )}
      </div>

      {isViewOpen && selectedCourseForView && (
        <CourseAttendanceView 
          courseId={selectedCourseForView.id} 
          courseCode={selectedCourseForView.course_code}
          courseName={selectedCourseForView.course_name}
          onClose={() => setIsViewOpen(false)} 
        />
      )}
    </div>
  );
}
