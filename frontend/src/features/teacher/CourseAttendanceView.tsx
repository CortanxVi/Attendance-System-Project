import { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { X, Download, Clock, Search, AlertCircle, Edit2, CheckCircle2, List, Grid, CalendarDays, CheckSquare, XSquare, MessageSquare } from 'lucide-react';
import { useNotification } from '../../components/notifications/NotificationProvider';
import ConfirmDialog from '../../components/overlays/ConfirmDialog';
import { sanitizeSpreadsheetMatrix } from '../../services/spreadsheet';

interface CourseAttendanceViewProps {
  courseId: string;
  courseCode: string;
  courseName: string;
  onClose: () => void;
}

export default function CourseAttendanceView({ courseId, courseCode, courseName, onClose }: CourseAttendanceViewProps) {
  const { notify } = useNotification();
  const [records, setRecords] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [students, setStudents] = useState<Array<{ student_id: string; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'session' | 'list' | 'matrix'>('matrix');
  
  // States for manual edit (List View)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string>('');
  
  // State for Session View
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [pendingBulkStatus, setPendingBulkStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [courseId]);

  const fetchData = async (preserveSession = false) => {
    try {
      if (!preserveSession) setLoading(true);
      const res = await axios.get(`/api/v1/teacher/export/attendance/${courseId}`);
      if (res.data.status === 'success') {
        setRecords(res.data.records);
        setStudents(res.data.students || []);
        const s = res.data.sessions || [];
        setSessions(s);
        if (!preserveSession && s.length > 0 && !selectedSessionId) {
          // Default to latest session
          setSelectedSessionId(s[s.length - 1].id);
        }
      }
    } catch (err) {
      console.error("Error fetching attendance data", err);
    } finally {
      if (!preserveSession) setLoading(false);
    }
  };

  const handleUpdateStatusList = async (recordId: string) => {
    try {
      setUpdating(true);
      await axios.put(`/api/v1/teacher/attendance/${recordId}`, {
        status: editStatus
      });
      await fetchData(true);
      setEditingRecordId(null);
    } catch (err: any) {
      notify(`ไม่สามารถแก้ไขสถานะได้: ${err.response?.data?.detail || err.message}`, 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateSessionRecord = async (studentId: string, sessionId: string, currentRecord: any, newStatus: string) => {
    try {
      setUpdating(true);
      if (currentRecord) {
        await axios.put(`/api/v1/teacher/attendance/${currentRecord.id}`, { status: newStatus });
      } else {
        await axios.post(`/api/v1/teacher/attendance`, {
          student_id: studentId,
          session_id: sessionId,
          status: newStatus
        });
      }
      await fetchData(true);
    } catch (err: any) {
      notify(`ไม่สามารถอัปเดตข้อมูลได้: ${err.response?.data?.detail || err.message}`, 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleBulkAction = (status: string) => {
    if (!selectedSessionId || filteredStudents.length === 0) return;
    setPendingBulkStatus(status);
  };

  const confirmBulkAction = async () => {
    if (!pendingBulkStatus || !selectedSessionId) return;
    const status = pendingBulkStatus;
    setUpdating(true);
    try {
      // Process updates sequentially to avoid overwhelming the server/DB
      for (const student of filteredStudents) {
        const record = matrixMap[student.student_id]?.[selectedSessionId];
        // Only update if it's different
        if (!record || record.status !== status) {
          if (record) {
            await axios.put(`/api/v1/teacher/attendance/${record.id}`, { status });
          } else {
            await axios.post(`/api/v1/teacher/attendance`, {
              student_id: student.student_id,
              session_id: selectedSessionId,
              status
            });
          }
        }
      }
      await fetchData(true);
      notify('อัปเดตสถานะสำเร็จ', 'success');
      setPendingBulkStatus(null);
    } catch (err: any) {
      notify(`เกิดข้อผิดพลาดในการอัปเดตแบบกลุ่ม: ${err.response?.data?.detail || err.message}`, 'error');
    } finally {
      setUpdating(false);
    }
  };

  const filteredRecords = records.filter(r => 
    r.student_id?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Generate Matrix/Session Data
  const uniqueStudentsMap = new Map(students.map((student) => [student.student_id, student]));
  records.forEach(r => {
    if (!uniqueStudentsMap.has(r.student_id)) {
      uniqueStudentsMap.set(r.student_id, { student_id: r.student_id, full_name: r.full_name });
    }
  });
  const studentsList = Array.from(uniqueStudentsMap.values());
  const filteredStudents = studentsList.filter(s => 
    s.student_id?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const matrixMap: any = {};
  records.forEach(r => {
    if (!matrixMap[r.student_id]) matrixMap[r.student_id] = {};
    matrixMap[r.student_id][r.session_id] = r;
  });




  const handleExportExcel = () => {
    try {
      // Create worksheet data
      const wsData = [];
      
      // Header row
      const header = ["รหัสนักศึกษา", "ชื่อ-นามสกุล"];
      sessions.forEach((_session, i) => header.push(`ครั้งที่ ${i + 1}`));
      header.push("มา/สาย", "ลา", "ขาด");
      wsData.push(header);
      
      // Data rows
      filteredStudents.forEach(student => {
        const row = [student.student_id, student.full_name];
        let presentCount = 0;
        let absentCount = 0;
        let leaveCount = 0;
        
        sessions.forEach(s => {
          const record = matrixMap[student.student_id]?.[s.id];
          const status = record?.status;
          const isAttended = status === 'present' || status === 'late';
          if (isAttended) presentCount++;
          else if (status === 'leave') leaveCount++;
          else absentCount++;
          
          let statusText = 'ขาด';
          if (status === 'present') statusText = 'มา';
          else if (status === 'late') statusText = 'สาย';
          else if (status === 'leave') statusText = 'ลา';
          
          row.push(statusText);
        });
        
        row.push(presentCount.toString(), leaveCount.toString(), absentCount.toString());
        wsData.push(row);
      });
      
      const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetMatrix(wsData));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
      
      XLSX.writeFile(wb, `Attendance_${courseCode}.xlsx`);
    } catch (err) {
      console.error(err);
      notify('เกิดข้อผิดพลาดในการสร้างไฟล์ Excel', 'error');
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <ConfirmDialog
        open={Boolean(pendingBulkStatus)}
        title="ยืนยันการแก้ไขแบบกลุ่ม"
        description={`ตั้งค่านักศึกษาที่แสดงทั้งหมดเป็น “${pendingBulkStatus === 'present' ? 'มาเรียน' : pendingBulkStatus === 'absent' ? 'ขาดเรียน' : pendingBulkStatus === 'late' ? 'มาสาย' : 'ลา'}” สำหรับคาบนี้หรือไม่?`}
        confirmLabel="อัปเดตทั้งหมด"
        busy={updating}
        onConfirm={confirmBulkAction}
        onCancel={() => setPendingBulkStatus(null)}
      />
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-fade-in">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              จัดการประวัติการเข้าเรียน
            </h2>
            <p className="text-gray-500 mt-1">วิชา: {courseCode} - {courseName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-200 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="relative w-64">
              <input 
                type="text" 
                placeholder="ค้นหารหัสนักศึกษา / ชื่อ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            </div>

            
            <div className="flex items-center gap-4">
              <button 
                onClick={handleExportExcel}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors"
              >
                <Download size={16} /> โหลด Excel
              </button>

              {/* Toggle View Mode */}
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button 
                  onClick={() => setViewMode('session')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'session' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <CalendarDays size={16} /> จัดการรายวัน
                </button>
                <button 
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'list' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <List size={16} /> แบบรายการ
                </button>
                <button 
                  onClick={() => setViewMode('matrix')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'matrix' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Grid size={16} /> แบบสมุดตาราง
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto border border-gray-200 rounded-xl bg-white shadow-sm flex flex-col">
            
            {/* SESSION VIEW */}
            {viewMode === 'session' && (
              <div className="flex flex-col h-full">
                <div className="p-4 bg-white border-b border-gray-200 flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 max-w-sm">
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">เลือกวันที่ (คาบเรียน)</label>
                      <select
                        value={selectedSessionId}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-orange-500 focus:border-orange-500 outline-none"
                      >
                        {sessions.map((s, idx) => (
                          <option key={s.id} value={s.id}>
                            ครั้งที่ {idx + 1} - {new Date(s.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => handleBulkAction('present')} disabled={updating} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      <CheckSquare size={16} /> มาทั้งหมด
                    </button>
                    <button onClick={() => handleBulkAction('absent')} disabled={updating} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      <XSquare size={16} /> ขาดทั้งหมด
                    </button>
                    <button onClick={() => handleBulkAction('leave')} disabled={updating} className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      <MessageSquare size={16} /> ลาทั้งหมด
                    </button>
                    <button onClick={() => handleBulkAction('late')} disabled={updating} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      <Clock size={16} /> สายทั้งหมด
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-50 sticky top-0 border-b border-gray-200 text-gray-700 shadow-sm">
                      <tr>
                        <th className="px-6 py-4 font-semibold w-1/4">รหัสนักศึกษา</th>
                        <th className="px-6 py-4 font-semibold w-1/3">ชื่อ-นามสกุล</th>
                        <th className="px-6 py-4 font-semibold">การเช็คชื่อ (สถานะ)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr><td colSpan={3} className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</td></tr>
                      ) : !selectedSessionId ? (
                        <tr><td colSpan={3} className="text-center py-10 text-gray-500">ไม่พบคลาสเรียน</td></tr>
                      ) : filteredStudents.length === 0 ? (
                        <tr><td colSpan={3} className="text-center py-10 text-gray-500">ไม่มีนักศึกษาในระบบ</td></tr>
                      ) : (
                        filteredStudents.map(student => {
                          const record = matrixMap[student.student_id]?.[selectedSessionId];
                          const status = record ? record.status : '';

                        

  return (
                            <tr key={student.student_id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-6 py-3 font-medium text-gray-900">{student.student_id}</td>
                              <td className="px-6 py-3">{student.full_name}</td>
                              <td className="px-6 py-3">
                                <select
                                  value={status}
                                  onChange={(e) => handleUpdateSessionRecord(student.student_id, selectedSessionId, record, e.target.value)}
                                  disabled={updating}
                                  className={`border rounded-lg p-2 text-sm font-bold focus:outline-none transition-colors disabled:opacity-50 min-w-[140px] cursor-pointer ${
                                    status === 'present' ? 'bg-green-50 text-green-700 border-green-300 focus:border-green-500' :
                                    status === 'absent' ? 'bg-red-50 text-red-700 border-red-300 focus:border-red-500' :
                                    status === 'late' ? 'bg-orange-50 text-orange-700 border-orange-300 focus:border-orange-500' :
                                    status === 'leave' ? 'bg-yellow-50 text-yellow-700 border-yellow-300 focus:border-yellow-500' :
                                    'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
                                  }`}
                                >
                                  <option value="" disabled className="text-gray-500 bg-white">-- ยังไม่เช็คชื่อ --</option>
                                  <option value="present" className="text-green-700 bg-white">มาเรียน</option>
                                  <option value="absent" className="text-red-700 bg-white">ขาดเรียน</option>
                                  <option value="leave" className="text-yellow-700 bg-white">ลา</option>
                                  <option value="late" className="text-orange-700 bg-white">มาสาย</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* LIST VIEW */}
            {viewMode === 'list' && (
              <div className="overflow-auto h-full">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 sticky top-0 border-b border-gray-200 text-gray-700">
                    <tr>
                      <th className="px-6 py-4 font-semibold">รหัสนักศึกษา</th>
                      <th className="px-6 py-4 font-semibold">ชื่อ-นามสกุล</th>
                      <th className="px-6 py-4 font-semibold">เวลาเช็คชื่อ</th>
                      <th className="px-6 py-4 font-semibold">สถานะ</th>
                      <th className="px-6 py-4 font-semibold text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={5} className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</td></tr>
                    ) : filteredRecords.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-gray-500"><AlertCircle className="mb-2 text-gray-400 mx-auto" size={32} /> ไม่มีข้อมูลการเช็คชื่อ</td></tr>
                    ) : (
                      filteredRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 font-medium text-gray-900">{record.student_id}</td>
                          <td className="px-6 py-4">{record.full_name}</td>
                          <td className="px-6 py-4">{new Date(record.check_in_time).toLocaleString('th-TH')}</td>
                          <td className="px-6 py-4">
                            {editingRecordId === record.id ? (
                              <select 
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value)}
                                className="bg-white border border-gray-300 rounded-md py-1.5 px-3 text-sm font-medium shadow-sm outline-none"
                              >
                                <option value="present">มาเรียน</option>
                                <option value="late">มาสาย</option>
                                <option value="absent">ขาดเรียน</option>
                                <option value="leave">ลา</option>
                              </select>
                            ) : (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                                record.status === 'present' ? 'bg-green-100 text-green-700' : 
                                record.status === 'late' ? 'bg-orange-100 text-orange-700' : 
                                record.status === 'leave' ? 'bg-yellow-100 text-yellow-700' : 
                                'bg-red-100 text-red-700'}`}>
                                {record.status === 'present' ? 'มาเรียน' : record.status === 'late' ? 'มาสาย' : record.status === 'leave' ? 'ลา' : 'ขาดเรียน'}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {editingRecordId === record.id ? (
                              <div className="flex justify-center gap-2">
                                <button onClick={() => handleUpdateStatusList(record.id)} className="text-green-600 bg-green-50 hover:bg-green-100 p-1.5 rounded-md"><CheckCircle2 size={16} /></button>
                                <button onClick={() => setEditingRecordId(null)} className="text-gray-500 bg-gray-100 hover:bg-gray-200 p-1.5 rounded-md"><X size={16} /></button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingRecordId(record.id); setEditStatus(record.status); }} className="text-blue-600 bg-blue-50 hover:bg-blue-100 p-1.5 rounded-md"><Edit2 size={16} /></button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* MATRIX VIEW */}
            {viewMode === 'matrix' && (
              <div className="overflow-x-auto h-full">
                <table className="w-full text-left text-sm text-gray-600 min-w-max">
                  <thead className="bg-gray-50 sticky top-0 border-b border-gray-200 text-gray-700 z-10 shadow-sm">
                    <tr>
                      <th className="px-6 py-4 font-semibold sticky left-0 bg-gray-50 z-20 border-r border-gray-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                        ข้อมูลนักศึกษา
                      </th>
                      {sessions.map((s, index) => (
                        <th key={s.id} className="px-4 py-4 font-semibold text-center whitespace-nowrap min-w-[100px]">
                          <div>ครั้งที่ {index + 1}</div>
                          <div className="text-xs text-gray-400 font-normal mt-1">{new Date(s.created_at).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}</div>
                        </th>
                      ))}
                      <th className="px-6 py-4 font-semibold text-center border-l border-gray-200 bg-orange-50/50">
                        สรุปยอด
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={sessions.length + 2} className="text-center py-10 text-gray-500">กำลังโหลดข้อมูล...</td></tr>
                    ) : filteredStudents.length === 0 ? (
                      <tr><td colSpan={sessions.length + 2} className="text-center py-10 text-gray-500">ไม่มีรายชื่อนักศึกษา</td></tr>
                    ) : (
                      filteredStudents.map(student => {
                        let presentCount = 0;
                        let absentCount = 0;
                        let leaveCount = 0;

                      

  return (
                          <tr key={student.student_id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-6 py-3 sticky left-0 bg-white border-r border-gray-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)] z-10">
                              <div className="font-medium text-gray-900">{student.student_id}</div>
                              <div className="text-xs text-gray-500">{student.full_name}</div>
                            </td>
                            {sessions.map(s => {
                              const record = matrixMap[student.student_id]?.[s.id];
                              const isAttended = record && (record.status === 'present' || record.status === 'late');
                              if (isAttended) presentCount++;
                              else if (record && record.status === 'leave') leaveCount++;
                              else if (record && record.status === 'absent') absentCount++;
                              else absentCount++;

                            

  return (
                                <td key={s.id} className="px-4 py-3 text-center border-r border-gray-50 last:border-r-0">
                                    <select
                                      value={record?.status || 'absent'}
                                      onChange={(e) => {
                                        handleUpdateSessionRecord(student.student_id, s.id, record, e.target.value);
                                      }}
                                      disabled={updating}
                                      className={`w-full rounded border text-sm p-1 cursor-pointer outline-none focus:ring-1 focus:ring-orange-500 transition-colors
                                        ${record?.status === 'present' ? 'bg-green-50 text-green-700 border-green-200' : 
                                          record?.status === 'late' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                          record?.status === 'leave' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                          'bg-red-50 text-red-700 border-red-200'}
                                      `}
                                    >
                                      <option value="present">มาเรียน</option>
                                      <option value="late">มาสาย</option>
                                      <option value="leave">ลา</option>
                                      <option value="absent">ขาดเรียน</option>
                                    </select>
                                  </td>
                              );
                            })}
                            <td className="px-6 py-3 text-center border-l border-gray-100 bg-orange-50/20 whitespace-nowrap text-xs">
                              <span className="text-green-600 font-bold mr-2" title="มาเรียน/สาย">มา: {presentCount}</span>
                              <span className="text-yellow-600 font-bold mr-2" title="ลา">ลา: {leaveCount}</span>
                              <span className="text-red-500 font-bold" title="ขาดเรียน">ขาด: {absentCount}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
