import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

export default function AttendanceHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ present: 0, late: 0, absent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/v1/student/history/${session.user.id}`);
      const data = await response.json();

      if (data.status === 'success') {
        setHistory(data.history);
        setStats(data.stats);
      } else {
        setError(data.detail || 'Failed to load history');
      }
    } catch (err) {
      setError('An error occurred while fetching data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'present':
        return <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1"><CheckCircle className="w-4 h-4"/> มาเรียน</span>;
      case 'late':
        return <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium flex items-center gap-1"><AlertCircle className="w-4 h-4"/> สาย</span>;
      case 'absent':
        return <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium flex items-center gap-1"><XCircle className="w-4 h-4"/> ขาดเรียน</span>;
      default:
        return <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">{status}</span>;
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">ประวัติการเข้าเรียน</h1>
      
      {error && <div className="bg-red-50 text-red-500 p-4 rounded-lg mb-6">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-green-100 p-3 rounded-lg"><CheckCircle className="w-8 h-8 text-green-600" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">มาเรียน (Present)</p>
            <p className="text-2xl font-bold text-gray-800">{stats.present}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-yellow-100 p-3 rounded-lg"><AlertCircle className="w-8 h-8 text-yellow-600" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">มาสาย (Late)</p>
            <p className="text-2xl font-bold text-gray-800">{stats.late}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-red-100 p-3 rounded-lg"><XCircle className="w-8 h-8 text-red-600" /></div>
          <div>
            <p className="text-sm text-gray-500 font-medium">ขาดเรียน (Absent)</p>
            <p className="text-2xl font-bold text-gray-800">{stats.absent}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-600 text-sm">วิชา</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-sm">วันที่ / เวลา</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-sm">วิธีการ</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-sm">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    ยังไม่มีประวัติการเข้าเรียน
                  </td>
                </tr>
              ) : (
                history.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800">{record.course_code}</div>
                      <div className="text-xs text-gray-500">{record.course_name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">{new Date(record.check_in_time).toLocaleDateString('th-TH')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-500 mt-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-xs">{new Date(record.check_in_time).toLocaleTimeString('th-TH')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                        {record.method === 'face_ocr' ? 'สแกนหน้า' : record.method === 'nfc' ? 'บัตร NFC' : record.method}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(record.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
