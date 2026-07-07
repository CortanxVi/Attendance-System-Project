import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const History = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await api.get('/attendance/my-history');
        setRecords(response.data);
      } catch (err) {
        console.error('Failed to fetch history', err);
        alert('เกิดข้อผิดพลาดในการดึงข้อมูลประวัติการเช็คชื่อ กรุณาตรวจสอบอินเทอร์เน็ต');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const formatDate = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('th-TH', { 
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="container" style={{ padding: 'var(--space-6) 0' }}>
      <header style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-secondary)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
        </button>
        <h1 style={{ fontSize: '1.25rem' }}>ประวัติการเช็คชื่อ</h1>
      </header>

      {loading ? (
        <div className="flex-center" style={{ minHeight: '200px' }}>
          <p style={{ color: 'var(--color-ink-tertiary)' }}>กำลังดึงข้อมูลสถิติ...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
          <p style={{ color: 'var(--color-ink-secondary)' }}>คุณยังไม่มีประวัติการเช็คชื่อเข้าเรียนในระบบ</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {records.map((record) => {
            const course = record.attendance_sessions?.sections?.courses;
            const section = record.attendance_sessions?.sections;
            const isLate = record.status === 'late';
            
            return (
              <div key={record.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--color-ink-primary)' }}>
                    {course?.code || 'ไม่ทราบรหัสวิชา'} {course?.name || ''}
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-ink-secondary)', marginTop: '4px' }}>
                    ตอนเรียน: {section?.number || '-'} • {formatDate(record.check_in_time)}
                  </p>
                </div>
                <div>
                  <span style={{ 
                    padding: '4px 8px', 
                    borderRadius: 'var(--radius-full)', 
                    fontSize: '0.75rem', 
                    fontWeight: 500,
                    backgroundColor: isLate ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                    color: isLate ? 'var(--color-warning-ink)' : 'var(--color-success-ink)'
                  }}>
                    {isLate ? 'มาสาย' : 'มาเรียน'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default History;
