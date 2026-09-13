import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';
import { sanitizeSpreadsheetMatrix } from './spreadsheet.ts';
import { styleAttendanceWorkbook } from './xlsxStyle.ts';

export type ReportFormat = 'excel' | 'csv' | 'pdf';
export type AttendanceMark = 1 | '/' | 'X' | '';

export interface ReportCourse {
  id: string;
  course_code: string;
  course_name: string;
  semester: number;
  year: number;
  section: number;
  total_sessions?: number | null;
  late_threshold_minutes?: number | null;
  absent_threshold_minutes?: number | null;
  max_absence_percent?: number | null;
  profiles?: { full_name?: string | null } | null;
}

export interface AttendanceExportRecord {
  id: string;
  student_id: string;
  full_name: string;
  status: string;
  method?: string | null;
  check_in_time: string;
  session_id: string;
}

export interface AttendanceExportSession {
  id: string;
  created_at: string;
  closed_at?: string | null;
  status?: string | null;
}

export interface AttendanceExportStudent {
  student_id: string;
  full_name: string;
}

export interface AttendanceExportPayload {
  course: ReportCourse;
  records: AttendanceExportRecord[];
  sessions: AttendanceExportSession[];
  students: AttendanceExportStudent[];
}

export interface AttendanceReportRow {
  order: number;
  studentId: string;
  fullName: string;
  section: string;
  marks: AttendanceMark[];
  presentCount: number;
  lateCount: number;
  absentCount: number;
  attendedCount: number;
  attendanceScore: number | null;
  remark: string;
}

export interface AttendanceReportModel {
  course: ReportCourse;
  instructorName: string;
  weekCount: number;
  closedSessionCount: number;
  allowedAbsenceCount: number;
  sessions: Array<AttendanceExportSession | null>;
  rows: AttendanceReportRow[];
}

const INSTITUTION_NAME = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ';
const REPORT_TITLE = 'บัญชีรายชื่อนักศึกษาและผลการเข้าเรียนรายสัปดาห์';

function profileName(course: ReportCourse): string {
  return course.profiles?.full_name?.trim() || 'ไม่ระบุ';
}

function isClosedSession(session: AttendanceExportSession | null): boolean {
  if (!session) return false;
  return session.status === 'closed' || Boolean(session.closed_at);
}

function markForStatus(status: string | undefined, closed: boolean): AttendanceMark {
  if (status === 'present') return 1;
  if (status === 'late') return '/';
  if (status === 'absent') return 'X';
  return closed ? 'X' : '';
}

function compareStudentIds(left: string, right: string): number {
  return left.localeCompare(right, 'th', { numeric: true, sensitivity: 'base' });
}

export function formatStudentId(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 13) return value;
  return `${digits.slice(0, 2)}-${digits.slice(2, 8)}-${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function buildAttendanceReportModel(payload: AttendanceExportPayload): AttendanceReportModel {
  const sortedSessions = [...(payload.sessions ?? [])].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
  const configuredWeeks = Math.max(0, Number(payload.course.total_sessions) || 0);
  const weekCount = Math.max(1, configuredWeeks, sortedSessions.length);
  const sessions = Array.from({ length: weekCount }, (_, index) => sortedSessions[index] ?? null);
  const closedSessionCount = sessions.filter(isClosedSession).length;
  const maxAbsencePercent = Math.max(0, Number(payload.course.max_absence_percent) || 0);
  const allowedAbsenceCount = Math.floor((weekCount * maxAbsencePercent) / 100);

  const studentMap = new Map<string, AttendanceExportStudent>();
  for (const student of payload.students ?? []) {
    const studentId = student.student_id?.trim();
    if (studentId) studentMap.set(studentId, { student_id: studentId, full_name: student.full_name || 'ไม่ระบุชื่อ' });
  }
  for (const record of payload.records ?? []) {
    const studentId = record.student_id?.trim();
    if (studentId && !studentMap.has(studentId)) {
      studentMap.set(studentId, { student_id: studentId, full_name: record.full_name || 'ไม่ระบุชื่อ' });
    }
  }

  const latestRecordByStudentAndSession = new Map<string, AttendanceExportRecord>();
  for (const record of payload.records ?? []) {
    if (!record.student_id || !record.session_id) continue;
    const key = `${record.student_id}\u0000${record.session_id}`;
    const current = latestRecordByStudentAndSession.get(key);
    if (!current || new Date(record.check_in_time).getTime() >= new Date(current.check_in_time).getTime()) {
      latestRecordByStudentAndSession.set(key, record);
    }
  }

  const rows = [...studentMap.values()]
    .sort((left, right) => compareStudentIds(left.student_id, right.student_id))
    .map((student, index): AttendanceReportRow => {
      const marks = sessions.map((session) => {
        if (!session) return '';
        const record = latestRecordByStudentAndSession.get(`${student.student_id}\u0000${session.id}`);
        return markForStatus(record?.status, isClosedSession(session));
      });
      const closedMarks = marks.filter((_mark, weekIndex) => isClosedSession(sessions[weekIndex]));
      const presentCount = closedMarks.filter((mark) => mark === 1).length;
      const lateCount = closedMarks.filter((mark) => mark === '/').length;
      const absentCount = closedMarks.filter((mark) => mark === 'X').length;
      const attendedCount = presentCount + lateCount;
      const attendanceScore = closedSessionCount > 0
        ? Number(((attendedCount / closedSessionCount) * 100).toFixed(1))
        : null;
      const remark = closedSessionCount === 0
        ? 'ยังไม่มีคาบที่ปิดเพื่อคำนวณผล'
        : absentCount > allowedAbsenceCount
          ? `ไม่ผ่านเกณฑ์ (ขาดเกิน ${allowedAbsenceCount} ครั้ง)`
          : `ผ่านเกณฑ์ (ขาดได้ไม่เกิน ${allowedAbsenceCount} ครั้ง)`;

      return {
        order: index + 1,
        studentId: student.student_id,
        fullName: student.full_name,
        section: String(payload.course.section ?? ''),
        marks,
        presentCount,
        lateCount,
        absentCount,
        attendedCount,
        attendanceScore,
        remark,
      };
    });

  return {
    course: payload.course,
    instructorName: profileName(payload.course),
    weekCount,
    closedSessionCount,
    allowedAbsenceCount,
    sessions,
    rows,
  };
}

function weekLabel(session: AttendanceExportSession | null, index: number): string {
  if (!session) return String(index + 1);
  const date = new Date(session.created_at);
  if (Number.isNaN(date.getTime())) return String(index + 1);
  return `${index + 1}\n${date.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
}

function criteriaText(model: AttendanceReportModel): string {
  const late = model.course.late_threshold_minutes ?? 15;
  const absent = model.course.absent_threshold_minutes ?? 45;
  const maxAbsence = model.course.max_absence_percent ?? 0;
  return `เกณฑ์รายวิชา: สายหลัง ${late} นาที · ขาดหลัง ${absent} นาที · ขาดได้สูงสุด ${maxAbsence}% (${model.allowedAbsenceCount} จาก ${model.weekCount} คาบ)`;
}

function legendText(): string {
  return 'สัญลักษณ์: 1 = มาเรียนและเช็คชื่อผ่าน · / = มาสาย · X = ขาดเรียน · ช่องว่าง = คาบยังไม่เปิด/ยังไม่ปิด';
}

function scoreText(): string {
  return 'คะแนนเวลาเรียน = (จำนวนมาเรียน + จำนวนมาสาย) ÷ จำนวนคาบที่ปิดแล้ว × 100; การมาสายยังนับว่าเข้าเรียน เนื่องจากรายวิชายังไม่มีค่าน้ำหนักหักคะแนนสาย';
}

export function buildCsvMatrix(model: AttendanceReportModel): unknown[][] {
  return sanitizeSpreadsheetMatrix([
    [INSTITUTION_NAME],
    [REPORT_TITLE],
    [`รหัสวิชา: ${model.course.course_code}`, `ชื่อวิชา: ${model.course.course_name}`],
    [`ผู้สอน: ${model.instructorName}`, `ภาคเรียน: ${model.course.semester}/${model.course.year}`, `กลุ่ม: ${model.course.section}`],
    [criteriaText(model)],
    [legendText()],
    [scoreText()],
    [
      'ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'กลุ่ม',
      ...model.sessions.map(weekLabel),
      'มาเรียน', 'มาสาย', 'ขาดเรียน', 'เข้าเรียนรวม', 'คะแนนเวลาเรียน (%)', 'หมายเหตุ',
    ],
    ...model.rows.map((row) => [
      row.order,
      formatStudentId(row.studentId),
      row.fullName,
      row.section,
      ...row.marks,
      row.presentCount,
      row.lateCount,
      row.absentCount,
      row.attendedCount,
      row.attendanceScore ?? '',
      row.remark,
    ]),
  ]);
}

function buildExcelMatrix(model: AttendanceReportModel): unknown[][] {
  const totalColumns = 4 + model.weekCount + 6;
  return sanitizeSpreadsheetMatrix([
    [INSTITUTION_NAME, ...Array(totalColumns - 1).fill('')],
    [REPORT_TITLE, ...Array(totalColumns - 1).fill('')],
    [`รหัสวิชา ${model.course.course_code}  ${model.course.course_name}`, ...Array(totalColumns - 1).fill('')],
    [`ผู้สอน ${model.instructorName}  ภาคเรียน ${model.course.semester}/${model.course.year}  กลุ่ม ${model.course.section}`, ...Array(totalColumns - 1).fill('')],
    [criteriaText(model), ...Array(totalColumns - 1).fill('')],
    [`${legendText()}  ${scoreText()}`, ...Array(totalColumns - 1).fill('')],
    ['สถานะคาบ', '', '', '', ...model.sessions.map((session) => isClosedSession(session) ? 'CLOSED' : 'OPEN'), ...Array(6).fill('')],
    ['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'กลุ่ม', 'สัปดาห์', ...Array(Math.max(0, model.weekCount - 1)).fill(''), 'สรุปผล', ...Array(5).fill('')],
    ['', '', '', '', ...model.sessions.map(weekLabel), 'มา', 'สาย', 'ขาด', 'รวม', 'คะแนน (%)', 'หมายเหตุ'],
    ...model.rows.map((row) => [
      row.order,
      formatStudentId(row.studentId),
      row.fullName,
      row.section,
      ...row.marks,
      row.presentCount,
      row.lateCount,
      row.absentCount,
      row.attendedCount,
      row.attendanceScore ?? 0,
      row.remark,
    ]),
  ]);
}

function columnName(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(((value - 1) % 26) + 65) + result;
  }
  return result;
}

function applyCellStyle(
  worksheet: import('xlsx').WorkSheet,
  range: import('xlsx').Range,
  style: Record<string, unknown>,
): void {
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = `${columnName(column)}${row + 1}`;
      if (!worksheet[address]) worksheet[address] = { t: 's', v: '' };
      worksheet[address].s = style;
    }
  }
}

export async function createAttendanceWorkbook(model: AttendanceReportModel) {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet(buildExcelMatrix(model), { sheetStubs: true });
  const totalColumns = 4 + model.weekCount + 6;
  const finalColumn = totalColumns - 1;
  const weekStart = 4;
  const weekEnd = weekStart + model.weekCount - 1;
  const summaryStart = weekEnd + 1;
  const lastDataRow = 9 + model.rows.length;

  worksheet['!merges'] = [
    ...Array.from({ length: 6 }, (_, row) => ({ s: { r: row, c: 0 }, e: { r: row, c: finalColumn } })),
    { s: { r: 7, c: 0 }, e: { r: 8, c: 0 } },
    { s: { r: 7, c: 1 }, e: { r: 8, c: 1 } },
    { s: { r: 7, c: 2 }, e: { r: 8, c: 2 } },
    { s: { r: 7, c: 3 }, e: { r: 8, c: 3 } },
    { s: { r: 7, c: weekStart }, e: { r: 7, c: weekEnd } },
    { s: { r: 7, c: summaryStart }, e: { r: 7, c: finalColumn } },
  ];
  worksheet['!cols'] = [
    { wch: 7 }, { wch: 18 }, { wch: 30 }, { wch: 9 },
    ...Array.from({ length: model.weekCount }, () => ({ wch: 9 })),
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 13 }, { wch: 36 },
  ];
  worksheet['!rows'] = [
    { hpt: 26 }, { hpt: 30 }, { hpt: 24 }, { hpt: 22 }, { hpt: 22 }, { hpt: 32 },
    { hidden: true }, { hpt: 24 }, { hpt: 36 },
    ...Array.from({ length: model.rows.length }, () => ({ hpt: 24 })),
  ];
  worksheet['!autofilter'] = { ref: `A9:${columnName(finalColumn)}${Math.max(9, lastDataRow)}` };
  const extras = worksheet as import('xlsx').WorkSheet & Record<string, unknown>;
  extras['!freeze'] = { xSplit: 4, ySplit: 9, topLeftCell: 'E10', activePane: 'bottomRight', state: 'frozen' };
  extras['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 8 };
  extras['!margins'] = { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.15 };

  const sessionStateRange = `$${columnName(weekStart)}$7:$${columnName(weekEnd)}$7`;
  for (let index = 0; index < model.rows.length; index += 1) {
    const excelRow = index + 10;
    const presentColumn = columnName(summaryStart);
    const lateColumn = columnName(summaryStart + 1);
    const absentColumn = columnName(summaryStart + 2);
    const attendedColumn = columnName(summaryStart + 3);
    const scoreColumn = columnName(summaryStart + 4);
    const remarkColumn = columnName(summaryStart + 5);
    const weekRowRange = `${columnName(weekStart)}${excelRow}:${columnName(weekEnd)}${excelRow}`;
    worksheet[`${presentColumn}${excelRow}`] = { t: 'n', f: `COUNTIFS(${weekRowRange},1,${sessionStateRange},"CLOSED")`, v: model.rows[index].presentCount };
    worksheet[`${lateColumn}${excelRow}`] = { t: 'n', f: `COUNTIFS(${weekRowRange},"/",${sessionStateRange},"CLOSED")`, v: model.rows[index].lateCount };
    worksheet[`${absentColumn}${excelRow}`] = { t: 'n', f: `COUNTIFS(${weekRowRange},"X",${sessionStateRange},"CLOSED")`, v: model.rows[index].absentCount };
    worksheet[`${attendedColumn}${excelRow}`] = { t: 'n', f: `SUM(${presentColumn}${excelRow}:${lateColumn}${excelRow})`, v: model.rows[index].attendedCount };
    worksheet[`${scoreColumn}${excelRow}`] = { t: 'n', f: `IF(COUNTIF(${sessionStateRange},"CLOSED")=0,0,${attendedColumn}${excelRow}/COUNTIF(${sessionStateRange},"CLOSED")*100)`, v: model.rows[index].attendanceScore ?? 0, z: '0.0' };
    worksheet[`${remarkColumn}${excelRow}`] = { t: 's', f: `IF(COUNTIF(${sessionStateRange},"CLOSED")=0,"ยังไม่มีคาบที่ปิดเพื่อคำนวณผล",IF(${absentColumn}${excelRow}>${model.allowedAbsenceCount},"ไม่ผ่านเกณฑ์ (ขาดเกิน ${model.allowedAbsenceCount} ครั้ง)","ผ่านเกณฑ์ (ขาดได้ไม่เกิน ${model.allowedAbsenceCount} ครั้ง)"))`, v: model.rows[index].remark };
  }

  const border = { top: { style: 'thin', color: { rgb: '9CA3AF' } }, bottom: { style: 'thin', color: { rgb: '9CA3AF' } }, left: { style: 'thin', color: { rgb: '9CA3AF' } }, right: { style: 'thin', color: { rgb: '9CA3AF' } } };
  const centered = { font: { name: 'TH Sarabun New', sz: 16 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border };
  applyCellStyle(worksheet, { s: { r: 7, c: 0 }, e: { r: Math.max(8, lastDataRow - 1), c: finalColumn } }, centered);
  applyCellStyle(worksheet, { s: { r: 0, c: 0 }, e: { r: 0, c: finalColumn } }, { font: { name: 'TH Sarabun New', sz: 18, bold: true }, alignment: { horizontal: 'center' } });
  applyCellStyle(worksheet, { s: { r: 1, c: 0 }, e: { r: 1, c: finalColumn } }, { font: { name: 'TH Sarabun New', sz: 22, bold: true }, alignment: { horizontal: 'center' } });
  applyCellStyle(worksheet, { s: { r: 2, c: 0 }, e: { r: 5, c: finalColumn } }, { font: { name: 'TH Sarabun New', sz: 16 }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } });
  applyCellStyle(worksheet, { s: { r: 7, c: 0 }, e: { r: 8, c: finalColumn } }, { font: { name: 'TH Sarabun New', sz: 16, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: 'C2410C' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border });
  if (model.rows.length > 0) {
    applyCellStyle(worksheet, { s: { r: 9, c: weekStart }, e: { r: lastDataRow - 1, c: weekEnd } }, { font: { name: 'TH Sarabun New', sz: 18, bold: true }, alignment: { horizontal: 'center', vertical: 'center' }, border });
    applyCellStyle(worksheet, { s: { r: 9, c: summaryStart + 4 }, e: { r: lastDataRow - 1, c: summaryStart + 4 } }, { font: { name: 'TH Sarabun New', sz: 16 }, numFmt: '0.0', alignment: { horizontal: 'center', vertical: 'center' }, border });
  }

  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: REPORT_TITLE, Subject: `${model.course.course_code} ${model.course.course_name}`, Author: 'Attendance System', CreatedDate: new Date() };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  return workbook;
}

function safeFilePart(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'course';
}

function triggerCsvDownload(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function triggerXlsxDownload(bytes: Uint8Array, filename: string): void {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function buildAttendancePdfDefinition(model: AttendanceReportModel, generatedAt = new Date()): TDocumentDefinitions {
  const weekHeader = model.sessions.map((session, index) => weekLabel(session, index));
  const body: unknown[][] = [
    [
      { text: 'ลำดับ', rowSpan: 2, style: 'tableHeader' },
      { text: 'รหัสนักศึกษา', rowSpan: 2, style: 'tableHeader' },
      { text: 'ชื่อ-นามสกุล', rowSpan: 2, style: 'tableHeader' },
      { text: 'กลุ่ม', rowSpan: 2, style: 'tableHeader' },
      { text: 'สัปดาห์', colSpan: model.weekCount, style: 'tableHeader' },
      ...Array.from({ length: Math.max(0, model.weekCount - 1) }, () => ({})),
      { text: 'สรุปผล', colSpan: 6, style: 'tableHeader' }, {}, {}, {}, {}, {},
    ],
    ['', '', '', '', ...weekHeader.map((text) => ({ text, style: 'tableHeader' })), ...['มา', 'สาย', 'ขาด', 'รวม', 'คะแนน (%)', 'หมายเหตุ'].map((text) => ({ text, style: 'tableHeader' }))],
    ...model.rows.map((row) => [
      String(row.order), formatStudentId(row.studentId), row.fullName, row.section,
      ...row.marks.map(String),
      String(row.presentCount), String(row.lateCount), String(row.absentCount), String(row.attendedCount),
      row.attendanceScore === null ? '-' : row.attendanceScore.toFixed(1), row.remark,
    ]),
  ];
  const widths: Array<number | '*' | 'auto'> = [
    22, 65, 95, 26,
    ...Array.from({ length: model.weekCount }, () => 28),
    26, 26, 26, 28, 42, '*',
  ];
  const documentDefinition: TDocumentDefinitions = {
    pageSize: model.weekCount > 18 ? 'A2' : 'A3',
    pageOrientation: 'landscape',
    pageMargins: [20, 24, 20, 28],
    defaultStyle: { font: 'THSarabunNew', fontSize: 11 },
    content: [
      { text: INSTITUTION_NAME, alignment: 'center', bold: true, fontSize: 15 },
      { text: REPORT_TITLE, alignment: 'center', bold: true, fontSize: 18, margin: [0, 2, 0, 5] },
      { text: `รหัสวิชา ${model.course.course_code}  ${model.course.course_name}    ผู้สอน ${model.instructorName}    ภาคเรียน ${model.course.semester}/${model.course.year}  กลุ่ม ${model.course.section}`, alignment: 'center', margin: [0, 0, 0, 3] },
      { text: criteriaText(model), alignment: 'center' },
      { text: legendText(), alignment: 'center' },
      { text: scoreText(), alignment: 'center', margin: [0, 0, 0, 7] },
      { table: { headerRows: 2, widths, body: body as never }, layout: { fillColor: (rowIndex: number) => rowIndex < 2 ? '#C2410C' : null, hLineColor: () => '#94A3B8', vLineColor: () => '#94A3B8', paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 3, paddingBottom: () => 3 } },
    ],
    footer: (currentPage, pageCount) => ({ text: `พิมพ์เมื่อ ${generatedAt.toLocaleString('th-TH')} · หน้า ${currentPage}/${pageCount}`, alignment: 'right', margin: [0, 0, 22, 0], fontSize: 9 }),
    styles: { tableHeader: { bold: true, color: 'white', alignment: 'center', fontSize: 10 } },
  };
  return documentDefinition;
}

async function exportPdf(model: AttendanceReportModel, filename: string): Promise<void> {
  const { default: pdfMake } = await import('pdfmake/build/pdfmake');
  const fonts: TFontDictionary = {
    THSarabunNew: {
      normal: `${window.location.origin}/fonts/THSarabunNew.ttf`,
      bold: `${window.location.origin}/fonts/THSarabunNew Bold.ttf`,
      italics: `${window.location.origin}/fonts/THSarabunNew Italic.ttf`,
      bolditalics: `${window.location.origin}/fonts/THSarabunNew BoldItalic.ttf`,
    },
  };
  pdfMake.setFonts(fonts);
  pdfMake.setUrlAccessPolicy((url) => {
    try { return new URL(url, window.location.origin).origin === window.location.origin; }
    catch { return false; }
  });
  pdfMake.createPdf(buildAttendancePdfDefinition(model)).download(`${filename}.pdf`);
}

export async function exportAttendanceReport(payload: AttendanceExportPayload, format: ReportFormat): Promise<void> {
  const model = buildAttendanceReportModel(payload);
  const filename = `Attendance_${safeFilePart(model.course.course_code)}_${new Date().toISOString().slice(0, 10)}`;
  const XLSX = await import('xlsx');
  if (format === 'csv') {
    const worksheet = XLSX.utils.aoa_to_sheet(buildCsvMatrix(model));
    triggerCsvDownload(XLSX.utils.sheet_to_csv(worksheet), filename);
    return;
  }
  if (format === 'excel') {
    const workbook = await createAttendanceWorkbook(model);
    const rawBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, cellStyles: true });
    triggerXlsxDownload(styleAttendanceWorkbook(new Uint8Array(rawBytes), model.weekCount), filename);
    return;
  }
  await exportPdf(model, filename);
}
