const FORMULA_LEADING_VALUE = /^(?:[\t\r]|\s*[=+\-@])/;

/** Keep untrusted strings literal when a report is opened by spreadsheet software. */
export function sanitizeSpreadsheetCell(value: unknown): unknown {
  if (typeof value !== 'string' || !FORMULA_LEADING_VALUE.test(value)) {
    return value;
  }
  return `'${value}`;
}

export function sanitizeSpreadsheetRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, sanitizeSpreadsheetCell(value)]),
  ) as T);
}

export function sanitizeSpreadsheetMatrix(rows: unknown[][]): unknown[][] {
  return rows.map((row) => row.map(sanitizeSpreadsheetCell));
}
