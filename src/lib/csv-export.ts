export function csvEscape(value: unknown): string {
  const raw =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${raw.replaceAll("\"", "\"\"")}"`;
}

export function buildCsvFromRows(
  rows: Array<Record<string, unknown>>,
  fields: string[],
): string {
  const header = fields.join(",");
  const lines = rows.map((row) => fields.map((f) => csvEscape(row[f])).join(","));
  return [header, ...lines].join("\n");
}

export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

