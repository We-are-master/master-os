import "server-only";
/**
 * Certificado liberado com o pagamento (dono, 22/10/2026). O e-mail final de um job de
 * certificado da Fixfy com saldo saiu SEM o certificado e deixou a marca
 * `certificado-retido:<job>` em `outbound_messages`. Esta varredura pega esses jobs que
 * agora estão pagos e manda um e-mail sozinho: pagamento recebido, com o certificado e
 * o report anexados (e o recibo, quando a conta recebe fatura).
 *
 * Só olha para jobs com a marca, então não manda nada retroativo. Cada job sai uma vez:
 * a chave `certificado-pago:<job>` é reservada antes do envio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountFinalEmailPolicyFromRow } from "@/lib/account-final-email-policy";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { sendFinalReviewEmail } from "@/lib/final-review-email";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { contaDoJob } from "@/lib/processo/conta";
import type { Account } from "@/types/database";
import { finalidadeLiberado, finalidadeRetido, jobPago } from "./regra";

export type LinhaDoCertificado = { reference: string; resultado: "enviado" | "aguarda" | "pulado" | "falhou" | "ensaio"; detalhe: string };

export async function varrerCertificadosPagos(
  admin: SupabaseClient,
  opcoes: { aplicar?: boolean; limite?: number } = {},
): Promise<{ linhas: LinhaDoCertificado[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const linhas: LinhaDoCertificado[] = [];
  const podeMandar = opcoes.aplicar === true && mensagensAoClienteLigadas();
  const aviso = opcoes.aplicar && !podeMandar ? "CLIENT_MESSAGING_ENABLED is not 1: nothing sent" : null;

  const { data: retidos } = await admin
    .from("outbound_messages")
    .select("job_id")
    .eq("purpose", finalidadeRetido)
    .eq("status", "sent")
    .not("job_id", "is", null)
    .order("reserved_at", { ascending: true })
    .limit(500);
  const ids = [...new Set((retidos ?? []).map((r) => r.job_id as string))];
  if (ids.length === 0) return { linhas, modo: podeMandar ? "envio" : "ensaio", aviso };

  // Quem já recebeu o certificado sai da lista.
  const { data: feitos } = await admin
    .from("outbound_messages")
    .select("job_id")
    .eq("purpose", finalidadeLiberado)
    .eq("status", "sent")
    .in("job_id", ids);
  const jaFeitos = new Set((feitos ?? []).map((r) => r.job_id as string));
  const pendentes = ids.filter((id) => !jaFeitos.has(id));
  if (pendentes.length === 0) return { linhas, modo: podeMandar ? "envio" : "ensaio", aviso };

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, reference, status, finance_status, payment_status, account_id, client_id, deleted_at")
    .in("id", pendentes);

  let enviados = 0;
  for (const job of jobs ?? []) {
    const reference = String(job.reference ?? job.id);
    if (job.deleted_at || job.status === "cancelled") {
      linhas.push({ reference, resultado: "pulado", detalhe: "job cancelled or deleted" });
      continue;
    }
    if (!jobPago(job)) {
      linhas.push({ reference, resultado: "aguarda", detalhe: `still ${job.status}` });
      continue;
    }
    if (!podeMandar) {
      linhas.push({ reference, resultado: "ensaio", detalhe: "paid: would send the certificate" });
      continue;
    }
    if (enviados >= (opcoes.limite ?? 10)) break;

    const chave = chaveDeEnvio("certificado-pago", job.id);
    const reserva = await reservarEnvio(admin, { chave, finalidade: finalidadeLiberado, canal: "email", jobId: job.id, motivo: "job paid: certificate released" });
    if (!reserva.reservado) {
      linhas.push({ reference, resultado: "pulado", detalhe: reserva.motivo ?? "not reserved" });
      continue;
    }
    try {
      const contaId = await contaDoJob(admin, { account_id: job.account_id, client_id: job.client_id });
      const { data: conta } = contaId
        ? await admin.from("accounts").select("*").eq("id", contaId).maybeSingle()
        : { data: null };
      const politica = accountFinalEmailPolicyFromRow((conta ?? null) as Account | null);
      const r = await sendFinalReviewEmail(admin, job.id, {
        includeInvoice: politica.canIncludeInvoice,
        includeReport: true,
        source: "certificate_after_payment",
        liberarCertificado: true,
      });
      if (!r.ok) throw new Error(`${r.status} ${r.error}`);
      await confirmarEnvio(admin, chave, r.resendId ?? (r.ticketId != null ? String(r.ticketId) : null));
      enviados++;
      linhas.push({ reference, resultado: "enviado", detalhe: `${r.channel} to ${r.to}${r.certificadoAnexado ? "" : " (no certificate file found)"}` });
    } catch (e) {
      await falhouEnvio(admin, chave, e);
      linhas.push({ reference, resultado: "falhou", detalhe: e instanceof Error ? e.message : String(e) });
    }
  }
  return { linhas, modo: podeMandar ? "envio" : "ensaio", aviso };
}
