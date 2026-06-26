import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { getReportSummary, getExportUrl } from '../services/api';

interface StudentSummary {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  present: number;
  late: number;
  absent: number;
  leave: number;
}

const AttendanceReport: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [data, setData] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (courseId) {
      getReportSummary(Number(courseId))
        .then(res => setData(res.data))
        .catch(err => console.error(err))
        .finally(() => {
          setTimeout(() => setLoading(false), 500);
        });
    }
  }, [courseId]);

  return (
    <div className="pb-10 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <Link to="/courses" className="inline-flex items-center gap-2 mb-4 text-slate-500 font-medium hover:text-blue-600 transition-colors bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100 hover:shadow-md">
            <ArrowLeft size={18} /> Back to Courses
          </Link>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">Attendance Report</h1>
          <p className="text-slate-500 mt-2 text-lg">Comprehensive overview of student attendance records.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a href={getExportUrl(Number(courseId), 'excel')} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-colors font-medium">
            <FileSpreadsheet size={20} /> Excel
          </a>
          <a href={getExportUrl(Number(courseId), 'csv')} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors font-medium">
            <FileText size={20} /> CSV
          </a>
          <a href={getExportUrl(Number(courseId), 'pdf')} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors font-medium">
            <Download size={20} /> PDF
          </a>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8">
            <div className="flex gap-6 mb-8 pb-5 border-b border-slate-100">
              <div className="h-6 w-24 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-6 w-48 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-6 w-16 bg-slate-200 rounded animate-pulse ml-auto"></div>
              <div className="h-6 w-16 bg-slate-200 rounded animate-pulse"></div>
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex gap-6 mb-6">
                <div className="h-6 w-20 bg-slate-100 rounded animate-pulse"></div>
                <div className="h-6 w-40 bg-slate-100 rounded animate-pulse"></div>
                <div className="h-8 w-14 bg-slate-100 rounded-full animate-pulse ml-auto"></div>
                <div className="h-8 w-14 bg-slate-100 rounded-full animate-pulse"></div>
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="py-20 px-8 text-center">
            <div className="inline-flex p-6 bg-slate-50 rounded-full mb-6 border border-slate-200">
              <FileText size={56} className="text-slate-400" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-3">No Data Available</h3>
            <p className="text-slate-500 text-lg">You haven't imported any students for this course yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-4 pl-8 pr-4">Student ID</th>
                  <th className="py-4 px-4">Name</th>
                  <th className="py-4 px-4 text-center text-green-700 bg-green-50/50">Present</th>
                  <th className="py-4 px-4 text-center text-amber-700 bg-amber-50/50">Late</th>
                  <th className="py-4 px-4 text-center text-red-700 bg-red-50/50">Absent</th>
                  <th className="py-4 pl-4 pr-8 text-center text-blue-700 bg-blue-50/50">Leave</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map(student => (
                  <tr key={student.student_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 pl-8 pr-4 text-slate-500 font-medium font-mono text-sm">{student.student_code}</td>
                    <td className="py-4 px-4 font-semibold text-slate-800">{student.first_name} {student.last_name}</td>
                    <td className="py-4 px-4 text-center bg-green-50/30">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 bg-white border border-green-200 text-green-700 font-semibold rounded-full shadow-sm text-sm">
                        {student.present}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-center bg-amber-50/30">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 bg-white border border-amber-200 text-amber-700 font-semibold rounded-full shadow-sm text-sm">
                        {student.late}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-center bg-red-50/30">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 bg-white border border-red-200 text-red-700 font-semibold rounded-full shadow-sm text-sm">
                        {student.absent}
                      </span>
                    </td>
                    <td className="py-4 pl-4 pr-8 text-center bg-blue-50/30">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 bg-white border border-blue-200 text-blue-700 font-semibold rounded-full shadow-sm text-sm">
                        {student.leave}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceReport;
