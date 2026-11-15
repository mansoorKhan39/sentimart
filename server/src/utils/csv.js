// Spreadsheet formulas start with = + - @ (or tab / CR): prefix a quote so Excel shows them as text
// (CSV injection protection). Numbers are written as they are.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ key, label }]. A BOM is added so Excel reads UTF-8 correctly.
export function toCsv(columns, rows) {
  const lines = [
    columns.map((c) => csvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
