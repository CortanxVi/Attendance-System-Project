import assert from 'node:assert/strict';

import {
  buildAttendanceReportModel,
  buildAttendancePdfDefinition,
  buildCsvMatrix,
  createAttendanceWorkbook,
  formatStudentId,
  type AttendanceExportPayload,
} from '../src/services/reportExport.ts';
import { strFromU8, unzipSync } from 'fflate';
import { styleAttendanceWorkbook } from '../src/services/xlsxStyle.ts';

const payload: AttendanceExportPayload = {
  course: {
    id: 'course-1',
    course_code: 'ENG101',
    course_name: 'Technical English',
    semester: 1,
    year: 2026,
    section: 2,
    total_sessions: 4,
    late_threshold_minutes: 15,
    absent_threshold_minutes: 45,
    max_absence_percent: 25,
    profiles: { full_name: 'Example Instructor' },
  },
  sessions: [
    { id: 'session-2', created_at: '2026-09-08T08:00:00Z', closed_at: '2026-09-08T09:00:00Z', status: 'closed' },
    { id: 'session-1', created_at: '2026-09-01T08:00:00Z', closed_at: '2026-09-01T09:00:00Z', status: 'closed' },
    { id: 'session-3', created_at: '2026-09-15T08:00:00Z', status: 'open' },
  ],
  students: [
    { student_id: '6500000000002', full_name: 'Student Two' },
    { student_id: '6500000000001', full_name: 'Student One' },
  ],
  records: [
    { id: 'r1', student_id: '6500000000001', full_name: 'Student One', session_id: 'session-1', status: 'present', method: 'face', check_in_time: '2026-09-01T08:01:00Z' },
    { id: 'r2', student_id: '6500000000001', full_name: 'Student One', session_id: 'session-2', status: 'late', method: 'face', check_in_time: '2026-09-08T08:20:00Z' },
    { id: 'r3', student_id: '6500000000001', full_name: 'Student One', session_id: 'session-3', status: 'present', method: 'face', check_in_time: '2026-09-15T08:01:00Z' },
    { id: 'r4', student_id: '6500000000002', full_name: 'Student Two', session_id: 'session-1', status: 'absent', method: 'manual', check_in_time: '2026-09-01T09:00:00Z' },
  ],
};

const model = buildAttendanceReportModel(payload);

assert.equal(model.weekCount, 4);
assert.equal(model.closedSessionCount, 2);
assert.equal(model.allowedAbsenceCount, 1);
assert.deepEqual(model.rows.map((row) => row.studentId), ['6500000000001', '6500000000002']);
assert.deepEqual(model.rows[0].marks, [1, '/', 1, '']);
assert.equal(model.rows[0].presentCount, 1);
assert.equal(model.rows[0].lateCount, 1);
assert.equal(model.rows[0].absentCount, 0);
assert.equal(model.rows[0].attendanceScore, 100);
assert.match(model.rows[0].remark, /^ผ่านเกณฑ์/);
assert.deepEqual(model.rows[1].marks, ['X', 'X', '', '']);
assert.equal(model.rows[1].absentCount, 2);
assert.equal(model.rows[1].attendanceScore, 0);
assert.match(model.rows[1].remark, /^ไม่ผ่านเกณฑ์/);
assert.equal(formatStudentId('6500000000001'), '65-000000-0000-1');

const maliciousPayload: AttendanceExportPayload = {
  ...payload,
  students: [{ student_id: '=1+1', full_name: '=HYPERLINK("https://example.invalid")' }],
  records: [],
};
const csvMatrix = buildCsvMatrix(buildAttendanceReportModel(maliciousPayload));
assert.equal(csvMatrix[8][1], "'=1+1");
assert.equal(csvMatrix[8][2], "'=HYPERLINK(\"https://example.invalid\")");

const XLSX = await import('xlsx');
const workbook = await createAttendanceWorkbook(model);
const rawBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, cellStyles: true });
const styledArchive = unzipSync(styleAttendanceWorkbook(new Uint8Array(rawBytes), model.weekCount));
const stylesXml = strFromU8(styledArchive['xl/styles.xml']);
const sheetXml = strFromU8(styledArchive['xl/worksheets/sheet1.xml']);
assert.match(stylesXml, /TH Sarabun New/);
assert.match(stylesXml, /FFC2410C/);
assert.match(sheetXml, /<c r="A8"[^>]* s="4">/);
assert.match(sheetXml, /<pane xSplit="4" ySplit="9"/);
assert.match(sheetXml, /<pageSetup[^>]*orientation="landscape"/);

const pdfDefinition = buildAttendancePdfDefinition(model, new Date('2026-09-13T00:00:00Z'));
assert.equal(pdfDefinition.pageOrientation, 'landscape');
assert.equal(pdfDefinition.pageSize, 'A3');
assert.equal(Array.isArray(pdfDefinition.content), true);
assert.equal((pdfDefinition.content as unknown[]).length, 7);

console.log('Attendance report model checks passed');
