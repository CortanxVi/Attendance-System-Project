import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ClipboardList, Clock } from 'lucide-react';

export default function SystemLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/admin/logs');
      setLogs(res.data.logs || []);
    } catch (err) {
      console.error("Error fetching logs", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('th-TH', { 
      day: '2-digit', month: 'short', year: 'numeric', 
      hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <ClipboardList className="text-red-500" /> Audit Logs (ประวัติการใช้งานระบบ)
        </h2>
        <button onClick={fetchLogs} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium transition-colors">
          รีเฟรชข้อมูล
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm">
                <th className="py-3 px-4 rounded-tl-xl font-semibold w-1/4"><Clock size={16} className="inline mr-1" /> วัน-เวลา</th>
                <th className="py-3 px-4 font-semibold w-1/5">ผู้ดำเนินการ (Admin)</th>
                <th className="py-3 px-4 font-semibold w-1/5">การกระทำ (Action)</th>
                <th className="py-3 px-4 font-semibold w-1/6">เป้าหมาย</th>
                <th className="py-3 px-4 rounded-tr-xl font-semibold text-right">รายละเอียดเพิ่มเติม</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-700">
              {logs.map(log => (
                <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 whitespace-nowrap text-gray-500">{formatDate(log.created_at)}</td>
                  <td className="py-3 px-4 font-medium">{log.profiles?.full_name || 'System / Unknown'}</td>
                  <td className="py-3 px-4">
                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs font-mono font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {log.target_type}: <span className="text-xs text-gray-400">{log.target_id.substring(0, 8)}...</span>
                  </td>
                  <td className="py-3 px-4 text-right text-xs text-gray-500 max-w-xs truncate">
                    {log.details ? JSON.stringify(log.details) : '-'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">ยังไม่มีประวัติการทำงานของแอดมิน</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
