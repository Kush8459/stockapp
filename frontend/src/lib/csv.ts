/** Escape a single CSV cell (RFC 4180): wrap in quotes if it contains
 *  delimiters or newlines; double any embedded quotes. */
export function escapeCsv(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize a 2-D array into CSV text. */
export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
}

/** Trigger a browser download for the given CSV text + filename. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
