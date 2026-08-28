import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
  sanitizeSpreadsheetCell,
  sanitizeSpreadsheetMatrix,
  sanitizeSpreadsheetRows,
} from '../src/services/spreadsheet.ts';


for (const unsafe of [
  '=HYPERLINK("https://example.invalid")',
  '+cmd',
  '-2+3',
  '@SUM(1,2)',
  '\t=1+1',
  '\r=1+1',
  '  =1+1',
]) {
  assert.equal(sanitizeSpreadsheetCell(unsafe), `'${unsafe}`);
}

assert.equal(sanitizeSpreadsheetCell('นายสมพงษ์'), 'นายสมพงษ์');
assert.equal(sanitizeSpreadsheetCell(42), 42);
assert.deepEqual(
  sanitizeSpreadsheetRows([{ name: '=1+1', status: 'มาเรียน' }]),
  [{ name: "'=1+1", status: 'มาเรียน' }],
);
assert.deepEqual(
  sanitizeSpreadsheetMatrix([['@SUM(1,2)', 'ปกติ']]),
  [["'@SUM(1,2)", 'ปกติ']],
);

const worksheet = XLSX.utils.json_to_sheet(
  sanitizeSpreadsheetRows([{ full_name: '=HYPERLINK("https://example.invalid")' }]),
);
const csv = XLSX.utils.sheet_to_csv(worksheet);
assert.match(csv, /'=HYPERLINK/);
assert.doesNotMatch(csv, /(?:^|[,\n])=HYPERLINK/);

console.log('Spreadsheet export security checks passed');
