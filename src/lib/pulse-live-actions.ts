/**
 * Live actions do Overview (dono, 05/11/2026): o que acabou de acontecer, com hora exata e
 * quem fez (pessoa, bot ou automação). Junta três fontes:
 *  - jobs criados (jobs.created_at), com a origem e quem criou (owner_name);
 *  - reclamação aberta (job em on hold com o preset complaint, pela hora do on hold);
 *  - o histórico (audit_logs): parceiro alocado, mudança de status de job e quote,
 *    pagamento, fatura enviada, cobrança, relatório enviado, final check automático.
 * Reagendamento e edição de campo ficam de fora: é ruído para quem olha o dia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoAcao = "job_created" | "assigned" | "status" | "complaint" | "payment" | "invoice_sent" | "chase" | "report" | "quote";
export type AcaoAoVivo = { id: string; em: string; tipo: TipoAcao; ref: string | null; href: string | null; texto: string; quem: string; bot: boolean };

const STATUS_JOB: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "Started",
  final_check: "In final review",
  awaiting_payment: "Approved",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On hold",
  late: "Running late",
};
const STATUS_QUOTE: Record<string, string> = { sent: "Quote sent", accepted: "Quote accepted", rejected: "Quote declined", converted: "Quote converted", expired: "Quote expired" };
const ORIGEM: Record<string, string> = { website: "Website", harvey: "Harvey", whatsapp: "WhatsApp", zendesk: "Zendesk", housekeep: "Housekeep", fantastic: "Fantastic", checkatrade: "Checkatrade", checkatrade_express: "Checkatrade Express", manual: "Manual", email: "Email", phone: "Phone" };

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const vazio = (v: string | null | undefined) => !v || v === "None" || v === "null";

/** Quem fez: a pessoa, ou a automação pelo nome que ela grava. Sem nome é robô. */
function autor(nome: string | null | undefined): { quem: string; bot: boolean } {
  const n = (nome ?? "").trim();
  if (!n) return { quem: "Auto", bot: true };
  if (/harvey/i.test(n)) return { quem: "Harvey", bot: true };
  if (/claude|automatic|automation|bot|stefane|cron|system|payment received|final check|^report$/i.test(n)) return { quem: "Auto", bot: true };
  return { quem: n, bot: false };
}

type Audit = { id: string; created_at: string; entity_type: string; entity_id: string | null; entity_ref: string | null; action: string; field_name: string | null; old_value: string | null; new_value: string | null; user_name: string | null; metadata: Record<string, unknown> | null };

export async function montarAcoesAoVivo(sb: SupabaseClient, horas = 36, limite = 40): Promise<AcaoAoVivo[]> {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const [{ data: logs }, { data: novos }, { data: reclamacoes }] = await Promise.all([
    sb
      .from("audit_logs")
      .select("id, created_at, entity_type, entity_id, entity_ref, action, field_name, old_value, new_value, user_name, metadata")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(600),
    sb.from("jobs").select("id, reference, client_price, extras_amount, source, owner_name, created_at").is("deleted_at", null).gte("created_at", desde).order("created_at", { ascending: false }).limit(100),
    sb.from("jobs").select("id, reference, on_hold_at").eq("status", "on_hold").eq("on_hold_reason_preset_id", "complaint").is("deleted_at", null).gte("on_hold_at", desde).limit(50),
  ]);

  const out: AcaoAoVivo[] = [];
  for (const j of (novos ?? []) as Array<{ id: string; reference: string | null; client_price: number | null; extras_amount: number | null; source: string | null; owner_name: string | null; created_at: string }>) {
    // Quem criou fica em owner_name (Leonardo, Victor); sem dono, foi a importação da origem.
    const origem = j.source ? ORIGEM[j.source.toLowerCase()] ?? j.source : null;
    const valor = Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
    out.push({
      id: `job-${j.id}`,
      em: j.created_at,
      tipo: "job_created",
      ref: j.reference,
      href: `/jobs/${j.id}`,
      texto: ["New job", origem, valor > 0 ? gbp(valor) : null].filter(Boolean).join(" · "),
      ...(j.owner_name?.trim() ? autor(j.owner_name) : { quem: origem ?? "Auto", bot: true }),
    });
  }
  for (const j of (reclamacoes ?? []) as Array<{ id: string; reference: string | null; on_hold_at: string }>) {
    out.push({ id: `complaint-${j.id}`, em: j.on_hold_at, tipo: "complaint", ref: j.reference, href: `/jobs/${j.id}`, texto: "Complaint opened", quem: "Ops", bot: false });
  }

  const vistos = new Set<string>();
  for (const l of (logs ?? []) as Audit[]) {
    const { quem, bot } = autor(l.user_name);
    const href = l.entity_type === "job" && l.entity_id ? `/jobs/${l.entity_id}` : l.entity_type === "quote" ? "/quotes" : l.entity_type === "invoice" ? "/finance/billing" : null;
    let tipo: TipoAcao | null = null;
    let texto = "";
    if (l.entity_type === "job" && l.field_name === "partner_name" && !vazio(l.new_value)) {
      tipo = "assigned";
      texto = `${vazio(l.old_value) ? "Assigned" : "Reassigned"} · ${l.new_value}`;
    } else if (l.entity_type === "job" && l.action === "created" && !l.field_name) {
      continue; // já vem da tabela de jobs, com a origem
    } else if (l.entity_type === "job" && l.action === "status_changed" && l.new_value && STATUS_JOB[l.new_value]) {
      if (l.new_value === "on_hold") continue; // reclamação vem com o motivo; outros on hold ficam no job
      // O final check automático grava a aprovação duas vezes; a linha dele (final_check_auto) basta.
      if (l.new_value === "awaiting_payment" && /final check/i.test(l.user_name ?? "")) continue;
      tipo = "status";
      texto = STATUS_JOB[l.new_value];
    } else if (l.entity_type === "job" && l.field_name === "start_report+final_report") {
      tipo = "report";
      texto = "Report submitted";
    } else if (l.entity_type === "job" && l.field_name === "final_check_auto") {
      tipo = "status";
      texto = "Auto-approved";
    } else if (l.action === "payment") {
      const valor = Number((l.metadata as { amount?: unknown } | null)?.amount ?? l.new_value);
      tipo = "payment";
      texto = `Paid${Number.isFinite(valor) && valor > 0 ? ` · ${gbp(valor)}` : ""}`;
    } else if (l.entity_type === "invoice" && l.field_name === "email_sent") {
      tipo = "invoice_sent";
      texto = "Invoice sent";
    } else if (l.entity_type === "invoice" && l.field_name === "overdue_reminder") {
      const n = Number(l.new_value);
      tipo = "chase";
      texto = n >= 4 ? "Final reminder" : `Reminder ${n}`;
    } else if (l.entity_type === "quote" && l.action === "status_changed" && l.new_value && STATUS_QUOTE[l.new_value]) {
      tipo = "quote";
      texto = STATUS_QUOTE[l.new_value];
    }
    if (!tipo) continue;
    // O mesmo evento gravado duas vezes em poucos minutos (ex.: e-mail da fatura) aparece uma vez.
    const chave = `${tipo}|${l.entity_ref}|${texto}|${Math.floor(Date.parse(l.created_at) / 300_000)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ id: l.id, em: l.created_at, tipo, ref: l.entity_ref, href, texto, quem, bot });
  }
  return out.sort((a, b) => b.em.localeCompare(a.em)).slice(0, limite);
}
