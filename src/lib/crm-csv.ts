/**
 * CSV para o CRM B2B: lê o arquivo (aspas, vírgulas e quebras de linha dentro
 * de aspas, CRLF) e acha as colunas pelo nome do cabeçalho, para aceitar as
 * listas que já existem (alvos de moradia estudantil, tier-1, lista ICP) sem
 * ninguém precisar renomear coluna. O que não tem campo próprio vai para as
 * notas como "coluna: valor".
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const ALIASES = {
  company_name: ["company_name", "company", "operator", "business", "business_name", "organisation", "organization", "empresa", "name"],
  contact_name: ["contact_name", "contact", "full_name", "decision_maker", "person"],
  contact_email: ["contact_email", "email", "e-mail", "email_address"],
  contact_phone: ["contact_phone", "phone", "telephone", "tel", "mobile", "phone_number"],
  website: ["website", "site", "url", "domain", "web"],
  segment: ["segment", "sector", "industry", "category", "type"],
  monthly_value: ["monthly_value", "value", "monthly_value_gbp"],
} as const;

export type CrmCsvField = keyof typeof ALIASES;

export type CrmCsvRow = {
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  segment: string | null;
  monthly_value: number | null;
  notes: string | null;
};

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[\s.]+/g, "_");
}

/** Para cada campo, o índice da coluna (ou -1). O primeiro apelido que existir vence. */
export function detectColumns(header: string[]): Record<CrmCsvField, number> {
  const normalized = header.map(norm);
  const out = {} as Record<CrmCsvField, number>;
  for (const field of Object.keys(ALIASES) as CrmCsvField[]) {
    out[field] = -1;
    for (const alias of ALIASES[field]) {
      const idx = normalized.indexOf(alias);
      if (idx >= 0) {
        out[field] = idx;
        break;
      }
    }
  }
  return out;
}

export function csvToCrmRows(text: string): { rows: CrmCsvRow[]; columns: Record<CrmCsvField, number>; header: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], columns: detectColumns([]), header: [] };
  const [header, ...body] = table;
  const columns = detectColumns(header);
  const used = new Set(Object.values(columns).filter((i) => i >= 0));
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows: CrmCsvRow[] = [];
  for (const r of body) {
    const company = cell(r, columns.company_name);
    if (!company) continue;
    const extra = header
      .map((h, i) => (used.has(i) ? null : [h.trim(), (r[i] ?? "").trim()] as const))
      .filter((p): p is readonly [string, string] => !!p && p[1] !== "")
      .map(([h, v]) => `${h}: ${v}`);
    const value = Number(cell(r, columns.monthly_value).replace(/[£,\s]/g, ""));
    rows.push({
      company_name: company,
      contact_name: cell(r, columns.contact_name) || null,
      contact_email: cell(r, columns.contact_email) || null,
      contact_phone: cell(r, columns.contact_phone) || null,
      website: cell(r, columns.website) || null,
      segment: cell(r, columns.segment) || null,
      monthly_value: Number.isFinite(value) && value > 0 ? value : null,
      notes: extra.length ? extra.join("\n") : null,
    });
  }
  return { rows, columns, header };
}
