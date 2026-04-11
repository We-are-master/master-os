/**
 * Variable substitution for outreach email templates.
 *
 * Syntax: {{var_name}}. Only the keys declared in OutreachTemplateVars are
 * resolved — any unknown placeholder is replaced with an empty string (so a
 * template used for an external email without partner metadata degrades
 * gracefully).
 */

import type { OutreachTemplateVars } from "@/types/outreach";

const VAR_REGEX = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(body: string, vars: OutreachTemplateVars): string {
  return body.replace(VAR_REGEX, (_, key: string) => {
    const v = vars[key as keyof OutreachTemplateVars];
    return typeof v === "string" ? v : "";
  });
}

export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(VAR_REGEX)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Build vars object from a partner record (using fields available in the Partner type). */
export function partnerVars(p: {
  contact_name?: string | null;
  company_name?: string | null;
  trade?: string | null;
  email?: string | null;
}): OutreachTemplateVars {
  return {
    nome: p.contact_name ?? "",
    empresa: p.company_name ?? "",
    servico: p.trade ?? "",
    email: p.email ?? "",
  };
}
