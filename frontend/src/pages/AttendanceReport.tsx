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
    <div style={{ paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
        <div>
          <Link to="/courses" style={{ 
            display: 'inline-flex', alignItems: 'center', gap: '8px', 
            marginBottom: '20px', color: 'var(--text-secondary)', 
            fontWeight: 600, transition: 'color 0.2s',
            backgroundColor: 'white', padding: '8px 16px', borderRadius: '20px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.02)'
          }} 
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'} 
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
            <ArrowLeft size={18} /> Back to Courses
          </Link>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0F172A' }}>Attendance Report</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '1.1rem' }}>Comprehensive overview of student attendance records.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '16px' }}>
          <a href={getExportUrl(Number(courseId), 'excel')} className="btn btn-outline" style={{ color: '#16A34A', borderColor: '#BBF7D0' }}>
            <FileSpreadsheet size={20} /> Excel
          </a>
          <a href={getExportUrl(Number(courseId), 'csv')} className="btn btn-outline" style={{ color: '#475569', borderColor: '#E2E8F0' }}>
            <FileText size={20} /> CSV
          </a>
          <a href={getExportUrl(Number(courseId), 'pdf')} className="btn btn-outline" style={{ color: '#DC2626', borderColor: '#FECACA' }}>
            <Download size={20} /> PDF
          </a>
        </div>
      </div>

      <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid rgba(226, 232, 240, 0.8)' }}>
        {loading ? (
          <div style={{ padding: '32px' }}>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
              <div className="skeleton" style={{ height: '24px', width: '120px' }}></div>
              <div className="skeleton" style={{ height: '24px', width: '250px' }}></div>
              <div className="skeleton" style={{ height: '24px', width: '80px', marginLeft: 'auto' }}></div>
              <div className="skeleton" style={{ height: '24px', width: '80px' }}></div>
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ display: 'flex', gap: '24px', marginBottom: '28px' }}>
                <div className="skeleton" style={{ height: '24px', width: '100px' }}></div>
                <div className="skeleton" style={{ height: '24px', width: '200px' }}></div>
                <div className="skeleton" style={{ height: '32px', width: '60px', marginLeft: 'auto', borderRadius: '16px' }}></div>
                <div className="skeleton" style={{ height: '32px', width: '60px', borderRadius: '16px' }}></div>
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div style={{ padding: '80px 40px', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', padding: '24px', backgroundColor: '#F8FAFC', borderRadius: '50%', marginBottom: '24px', border: '1px solid #E2E8F0' }}>
              <FileText size={56} color="#94A3B8" />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>No Data Available</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>You haven't imported any students for this course yet.</p>
          </div>
        ) : (
          <div className="table-container" style={{ border: 'none', borderRadius: '0' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingLeft: '32px' }}>Student ID</th>
                  <th>Name</th>
                  <th style={{ textAlign: 'center', color: '#059669', backgroundColor: '#ECFDF5' }}>Present</th>
                  <th style={{ textAlign: 'center', color: '#D97706', backgroundColor: '#FFFBEB' }}>Late</th>
                  <th style={{ textAlign: 'center', color: '#DC2626', backgroundColor: '#FEF2F2' }}>Absent</th>
                  <th style={{ textAlign: 'center', color: '#2563EB', backgroundColor: '#EFF6FF', paddingRight: '32px' }}>Leave</th>
                </tr>
              </thead>
              <tbody>
                {data.map(student => (
                  <tr key={student.student_id}>
                    <td style={{ color: 'var(--text-secondary)', fontWeight: 600, paddingLeft: '32px' }}>{student.student_code}</td>
                    <td style={{ fontWeight: 600 }}>{student.first_name} {student.last_name}</td>
                    <td style={{ textAlign: 'center', backgroundColor: '#F0FDF4' }}>
                      <span className="pill" style={{ backgroundColor: 'white', color: '#059669', border: '1px solid #A7F3D0', boxShadow: '0 2px 4px rgba(5, 150, 105, 0.05)' }}>
                        {student.present}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', backgroundColor: '#FFFBEB' }}>
                      <span className="pill" style={{ backgroundColor: 'white', color: '#D97706', border: '1px solid #FDE68A', boxShadow: '0 2px 4px rgba(217, 119, 6, 0.05)' }}>
                        {student.late}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', backgroundColor: '#FEF2F2' }}>
                      <span className="pill" style={{ backgroundColor: 'white', color: '#DC2626', border: '1px solid #FECACA', boxShadow: '0 2px 4px rgba(220, 38, 38, 0.05)' }}>
                        {student.absent}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', backgroundColor: '#EFF6FF', paddingRight: '32px' }}>
                      <span className="pill" style={{ backgroundColor: 'white', color: '#2563EB', border: '1px solid #BFDBFE', boxShadow: '0 2px 4px rgba(37, 99, 235, 0.05)' }}>
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
