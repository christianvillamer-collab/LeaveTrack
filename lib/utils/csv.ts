/**
 * Minimal RFC 4180-style serializer for report exports. Cells containing a
 * comma, quote, or newline are quoted with doubled inner quotes. Values that
 * look like spreadsheet formulas are prefixed with `'` so a detail string can
 * never execute when the export is opened in Excel or Sheets.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  const guarded = FORMULA_PREFIX.test(value.trimStart()) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
