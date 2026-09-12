import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ClipboardList, Clock, Search, X } from "lucide-react";

interface AuditLog {
  id: string;
  created_at: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  details?: unknown;
  profiles?: { full_name?: string | null } | null;
}

export default function SystemLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get("/api/v1/admin/logs");
      setLogs(res.data.logs || []);
    } catch (err) {
      console.error("Error fetching logs", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchLogs(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDetails = (details: unknown) => {
    if (!details) return "-";

    // ถ้าเป็นข้อความธรรมดา ให้แสดงผลปกติ
    if (typeof details !== "object")
      return <span className="text-gray-600">{String(details)}</span>;

    // ถ้าเป็น Object (JSON) ให้แกะออกมาทำเป็น Badge
    return (
      <div className="flex flex-wrap gap-1.5 justify-end">
        {Object.entries(details as Record<string, unknown>).map(([key, value]) => (
          <span
            key={key}
            className="inline-flex items-center bg-white border border-gray-200 shadow-sm rounded-md px-2 py-1 text-[11px] text-gray-600"
          >
            <span className="font-bold text-slate-700 mr-1 capitalize">
              {key.replace(/_/g, " ")}:
            </span>
            <span className="text-blue-600 font-medium">{String(value)}</span>
          </span>
        ))}
      </div>
    );
  };

  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th-TH");
    if (!normalized) return logs;
    return logs.filter((log) => [
      log.action,
      log.target_type,
      log.target_id,
      log.profiles?.full_name,
      typeof log.details === "string" ? log.details : JSON.stringify(log.details ?? {}),
      formatDate(log.created_at),
    ].some((value) => value?.toLocaleLowerCase("th-TH").includes(normalized)));
  }, [logs, query]);

  return (
    <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm animate-fade-in sm:p-6">
      <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="flex items-start gap-2 text-xl font-bold text-gray-800 sm:items-center sm:text-2xl">
          <ClipboardList className="shrink-0 text-red-500" /> Audit Logs
          (ประวัติการใช้งานระบบ)
        </h2>
        <button
          onClick={fetchLogs}
          className="min-h-11 cursor-pointer rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          รีเฟรชข้อมูล
        </button>
      </div>

      <div className="relative mb-5 max-w-xl">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
        <label htmlFor="admin-log-search" className="sr-only">ค้นหาประวัติการใช้งานระบบ</label>
        <input id="admin-log-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาผู้ดำเนินการ การกระทำ หรือเป้าหมาย" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-11 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา" className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-red-300"><X size={17} /></button>}
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">
          กำลังโหลดข้อมูล...
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm">
                <th className="py-3 px-4 rounded-tl-xl font-semibold w-1/4">
                  <Clock size={16} className="inline mr-1" /> วัน-เวลา
                </th>
                <th className="py-3 px-4 font-semibold w-1/5">
                  ผู้ดำเนินการ (Admin)
                </th>
                <th className="py-3 px-4 font-semibold w-1/5">
                  การกระทำ (Action)
                </th>
                <th className="py-3 px-4 font-semibold w-1/6">เป้าหมาย</th>
                <th className="py-3 px-4 rounded-tr-xl font-semibold text-right">
                  รายละเอียดเพิ่มเติม
                </th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-700">
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="py-3 px-4 whitespace-nowrap text-gray-500">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="py-3 px-4 font-medium">
                    {log.profiles?.full_name || "System / Unknown"}
                  </td>
                  <td className="py-3 px-4">
                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs font-mono font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {/* ป้องกันหน้าขาวด้วยการเช็คว่ามีค่าไหมก่อนใช้ substring */}
                    {log.target_type ? `${log.target_type}: ` : ""}
                    <span className="text-xs text-gray-400">
                      {log.target_id
                        ? log.target_id.substring(0, 8) + "..."
                        : "-"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right max-w-sm">
                    {formatDetails(log.details)}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    {logs.length ? "ไม่พบ Log ที่ตรงกับคำค้นหา" : "ยังไม่มีประวัติการทำงานของแอดมิน"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
