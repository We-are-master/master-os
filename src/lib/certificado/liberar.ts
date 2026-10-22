import "server-only";
/**
 * Pagamento recebido depois do e-mail final (dono, 22/10/2026).
 *
 * O e-mail final que sai com saldo deixa uma marca em `outbound_messages`:
 *   - `recibo-pendente:<job>`   fatura com saldo (o `reason` guarda o id da fatura);
 *   - `certificado-retido:<job>` certificado da Fixfy segurado até o pagamento.
 * Esta varredura pega esses jobs que agora estão pagos e manda UM e-mail:
 *   - job de certificado retido: pagamento recebido + certificado + report + recibo;
 *   - os outros: "Payment received" com a fatura final paga em PDF.
 * Pega todos os jeitos de pagar (Stripe, link, cartão, baixa manual) porque olha o
 * estado do job, não o evento. Só olha jobs marcados: nada retroativo. Cada job sai
 * uma vez (a chave `pagamento-recebido:<job>` é reservada antes do envio).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountFinalEmailPolicyFromRow } from "@/lib/account-final-email-policy";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { sendFinalReviewEmail } from "@/lib/final-review-email";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { contaDoJob } from "@/lib/processo/conta";
import type { Account } from "@/types/database";
import { finalidadeLiberado, finalidadePendente, finalidadeRecibo, finalidadeRetido, jobPago } from "./regra";
import { sendInvoiceEmail } from "@/lib/invoice-send-email";

export type LinhaDoCertificado = { reference: string; resultado: "enviado" | "aguarda" | "pulado" | "falhou" | "ensaio"; detalhe: string };

type Marca = { job_id: string; purpose: string; reason: string | null };

export async function varrerCertificadosPagos(
  admin: SupabaseClient,
  opcoes: { aplicar?: boolean; limite?: number } = {},
): Promise<{ linhas: LinhaDoCertificado[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const linhas: LinhaDoCertificado[] = [];
  const podeMandar = opcoes.aplicar === true && mensagensAoClienteLigadas();
  const aviso = opcoes.aplicar && !podeMandar ? "CLIENT_MESSAGING_ENABLED is not 1: nothing sent" : null;
  const modo = podeMandar ? "envio" : "ensaio";

  const { data: marcas } = await admin
    .from("outbound_messages")
    .select("job_id, purpose, reason")
    .in("purpose", [finalidadeRetido, finalidadePendente])
    .eq("status", "sent")
    .not("job_id", "is", null)
    .order("reserved_at", { ascending: true })
    .limit(500);
  const porJob = new Map<string, { retido: boolean; faturaId: string | null }>();
  for (const m of (marcas ?? []) as Marca[]) {
    const a = porJob.get(m.job_id) ?? { retido: false, faturaId: null };
    if (m.purpose === finalidadeRetido) a.retido = true;
    if (m.purpose === finalidadePendente && m.reason) a.faturaId = m.reason;
    porJob.set(m.job_id, a);
  }
  const ids = [...porJob.keys()];
  if (ids.length === 0) return { linhas, modo, aviso };

  // Quem já recebeu sai da lista (inclui o formato antigo, só do certificado).
  const { data: feitos } = await admin
    .from("outbound_messages")
    .select("job_id")
    .in("purpose", [finalidadeLiberado, finalidadeRecibo])
    .eq("status", "sent")
    .in("job_id", ids);
  const jaFeitos = new Set((feitos ?? []).map((r) => r.job_id as string));
  const pendentes = ids.filter((id) => !jaFeitos.has(id));
  if (pendentes.length === 0) return { linhas, modo, aviso };

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, reference, status, finance_status, payment_status, account_id, client_id, invoice_id, deleted_at")
    .in("id", pendentes);

  let enviados = 0;
  for (const job of jobs ?? []) {
    const reference = String(job.reference ?? job.id);
    const marca = porJob.get(job.id as string)!;
    if (job.deleted_at || job.status === "cancelled") {
      linhas.push({ reference, resultado: "pulado", detalhe: "job cancelled or deleted" });
      continue;
    }
    if (!jobPago(job)) {
      linhas.push({ reference, resultado: "aguarda", detalhe: `still ${job.status}` });
      continue;
    }
    if (!podeMandar) {
      linhas.push({ reference, resultado: "ensaio", detalhe: marca.retido ? "paid: would send payment received + certificate" : "paid: would send payment received + final invoice" });
      continue;
    }
    if (enviados >= (opcoes.limite ?? 10)) break;

    const chave = chaveDeEnvio("pagamento-recebido", job.id);
    const reserva = await reservarEnvio(admin, { chave, finalidade: marca.retido ? finalidadeLiberado : finalidadeRecibo, canal: "email", jobId: job.id, motivo: "job paid after the final email" });
    if (!reserva.reservado) {
      linhas.push({ reference, resultado: "pulado", detalhe: reserva.motivo ?? "not reserved" });
      continue;
    }
    try {
      if (marca.retido) {
        const contaId = await contaDoJob(admin, { account_id: job.account_id, client_id: job.client_id });
        const { data: conta } = contaId ? await admin.from("accounts").select("*").eq("id", contaId).maybeSingle() : { data: null };
        const politica = accountFinalEmailPolicyFromRow((conta ?? null) as Account | null);
        const r = await sendFinalReviewEmail(admin, job.id, { includeInvoice: politica.canIncludeInvoice, includeReport: true, source: "certificate_after_payment", liberarCertificado: true });
        if (!r.ok) throw new Error(`${r.status} ${r.error}`);
        await confirmarEnvio(admin, chave, r.resendId ?? (r.ticketId != null ? String(r.ticketId) : null));
        linhas.push({ reference, resultado: "enviado", detalhe: `certificate ${r.channel} to ${r.to}${r.certificadoAnexado ? "" : " (no certificate file found)"}` });
      } else {
        const faturaId = marca.faturaId ?? (job.invoice_id as string | null);
        if (!faturaId) throw new Error("no invoice on the job");
        const r = await sendInvoiceEmail(admin, faturaId, { userId: null, userName: "Fixfy (payment received)", jobId: job.id });
        if ("error" in r) throw new Error(`${r.status} ${r.error}`);
        await confirmarEnvio(admin, chave, r.resendId ?? (r.ticketId != null ? String(r.ticketId) : null));
        linhas.push({ reference, resultado: "enviado", detalhe: `receipt ${r.channel ?? "resend"} to ${r.to}` });
      }
      enviados++;
    } catch (e) {
      await falhouEnvio(admin, chave, e);
      linhas.push({ reference, resultado: "falhou", detalhe: e instanceof Error ? e.message : String(e) });
    }
  }
  return { linhas, modo, aviso };
}

/** Nome novo: a varredura cobre recibo e certificado. */
export const varrerPagamentosRecebidos = varrerCertificadosPagos;
