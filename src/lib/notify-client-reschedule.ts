/**
 * Avisa o cliente que a data mudou, do mesmo gesto que avisa o parceiro.
 *
 * Fica ao lado de `notifyPartnerJobChange({ kind: "rescheduled" })` em cada
 * ponto da tela que remarca, e não dentro dele, porque são dois destinatários
 * com regras diferentes: o parceiro é avisado sempre; o cliente depende da
 * trava `CLIENT_MESSAGING_ENABLED` e de a conta dele permitir. Misturar os dois
 * faria a política do cliente virar condição para o parceiro ser avisado.
 *
 * Silencioso por natureza: falhar em avisar o cliente não pode derrubar a
 * remarcação, que já foi salva quando isto roda. O erro vai para o console e a
 * rota devolve o motivo.
 */

export type NotifyClientRescheduleOptions = {
  jobId: string;
  oldDateLine?: string;
  oldTimeLine?: string | null;
  newDateLine?: string;
  newTimeLine?: string | null;
  /** Motivo dado pelo escritório. Nunca inventado: sem motivo, sem linha. */
  reason?: string | null;
};

export async function notifyClientReschedule(
  opts: NotifyClientRescheduleOptions,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  try {
    const res = await fetch(`/api/jobs/${opts.jobId}/notify-client-reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldDateLine: opts.oldDateLine ?? null,
        oldTimeLine: opts.oldTimeLine ?? null,
        newDateLine: opts.newDateLine ?? null,
        newTimeLine: opts.newTimeLine ?? null,
        reason: opts.reason ?? null,
      }),
    });
    return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; skipped?: string };
  } catch (err) {
    console.error("[notify-client-reschedule] fetch failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "fetch failed" };
  }
}
