import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';
import { sanitizeSpreadsheetRows } from './spreadsheet';

export type ReportFormat = 'excel' | 'csv' | 'pdf';
export interface ReportCourse { id: string; course_code: string; course_name: string; semester: number; year: number; section: number }
export interface AttendanceExportRecord { student_id: string; full_name: string; status: string; method: string; check_in_time: string }

const statusLabel = (status: string) => status === 'present' ? 'มาเรียน' : status === 'late' ? 'มาสาย' : 'ขาดเรียน';
const methodLabel = (method: string) => method === 'nfc' ? 'NFC' : method === 'face_ocr' ? 'Face Scan' : 'Manual';

function triggerCsvDownload(csv: string, filename: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${filename}.csv`; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportAttendanceReport(records: AttendanceExportRecord[], courseCode: string, format: ReportFormat, accentColor: string) {
  const filename = `Attendance_${courseCode}_${Date.now()}`;
  const rows = records.map((row, index) => ({
    ลำดับ: index + 1, รหัสนักศึกษา: row.student_id, 'ชื่อ-นามสกุล': row.full_name,
    สถานะ: statusLabel(row.status), วิธีการ: methodLabel(row.method), เวลา: new Date(row.check_in_time).toLocaleString('th-TH'),
  }));
  if (format !== 'pdf') {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(rows));
    if (format === 'excel') {
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance'); XLSX.writeFile(workbook, `${filename}.xlsx`);
    } else triggerCsvDownload(XLSX.utils.sheet_to_csv(worksheet), filename);
    return;
  }
  const { default: pdfMake } = await import('pdfmake/build/pdfmake');
  const fonts: TFontDictionary = { THSarabunNew: {
    normal: `${window.location.origin}/fonts/THSarabunNew.ttf`, bold: `${window.location.origin}/fonts/THSarabunNew Bold.ttf`,
    italics: `${window.location.origin}/fonts/THSarabunNew Italic.ttf`, bolditalics: `${window.location.origin}/fonts/THSarabunNew BoldItalic.ttf`,
  } };
  pdfMake.setFonts(fonts);
  pdfMake.setUrlAccessPolicy((url) => { try { return new URL(url, window.location.origin).origin === window.location.origin; } catch { return false; } });
  const documentDefinition: TDocumentDefinitions = {
    pageSize: 'A4', pageOrientation: 'landscape', defaultStyle: { font: 'THSarabunNew', fontSize: 14 },
    content: [
      { text: `รายงานประวัติการเข้าเรียน - รหัสวิชา: ${courseCode}`, style: 'header', margin: [0, 0, 0, 15] },
      { table: { headerRows: 1, widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'], body: [
        ['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'สถานะ', 'วิธีการเช็คชื่อ', 'เวลา'].map((text) => ({ text, style: 'tableHeader' })),
        ...records.map((row, index) => [String(index + 1), row.student_id, row.full_name, statusLabel(row.status), methodLabel(row.method), new Date(row.check_in_time).toLocaleString('th-TH')]),
      ] }, layout: 'lightHorizontalLines' },
    ],
    styles: { header: { fontSize: 18, bold: true }, tableHeader: { bold: true, fontSize: 14, color: 'white', fillColor: accentColor, alignment: 'center' } },
  };
  pdfMake.createPdf(documentDefinition).download(`${filename}.pdf`);
}
