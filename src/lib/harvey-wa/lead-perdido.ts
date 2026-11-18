/**
 * Cliente que não quer mais (dono, 18/11/2026: "qual cliente não quer, já marca Lost e
 * coloca como solved"). Vale o botão "No longer needed" do template e a mesma frase
 * digitada. Fecha tudo de uma vez:
 *   1. ticket do lead: solved, Resolution cancelled, tag lead_lost (encerrarLeadPerdido)
 *   2. lead do CRM: Lost (motivo "other", com a frase na nota)
 *   3. conversa sai do Harvey (o ticket "AI agent" não aceita solved pela API) e o
 *      ticket da conversa fica solved. Se a pessoa escrever de novo, reabre para a equipe.
 * Cliente com job em andamento ou parceiro não entram: aí "cancel" é outra conversa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A mensagem inteira é só "não quero mais" (com um obrigado ou desculpa em volta, no máximo). */
const NUCLEO =
  "(?:no longer (?:needed|required)|not (?:needed|required)(?: any ?more)?|(?:i |we )?(?:don'?t|do not) need (?:it|this|the job|the work)?(?: any ?more)?|not interested(?: any ?more)?|(?:i'?ve |we'?ve |i |we )?found someone(?: else)?|(?:it'?s |all |already )?(?:been )?sorted(?: now| already)?)";
const CORTESIA = "(?:hi|hello|hey|sorry|thanks?|thank you|cheers|ok|okay|no)";
const NAO_QUER = new RegExp(`^\\s*(?:${CORTESIA}[,!.\\s]+)*${NUCLEO}(?:[,!.\\s]+${CORTESIA})*[,!.\\s]*$`, "i");

export function naoQuerMais(texto: string | null | undefined): boolean {
  const t = (texto ?? "").trim();
  return t.length > 0 && t.length <= 80 && NAO_QUER.test(t);
}

type Passos = {
  encerrarLeadPerdido: (telefone: string, nota: string) => Promise<string>;
  marcarLostNoCrm: (telefone: string, frase: string) => Promise<number>;
  passarParaEquipe: (conversationId: string, motivo: string) => Promise<unknown>;
  marcarEstadoEquipe: (conversationId: string, motivo: string) => Promise<void>;
  resolverTicketDaConversa: (telefone: string, nota: string) => Promise<string>;
};

export async function fecharLeadPerdido(a: { conversationId: string; telefone: string; frase: string; botao: boolean }, p: Passos): Promise<string> {
  const origem = a.botao ? `tapped "${a.frase}" on the WhatsApp template` : `wrote "${a.frase}" on WhatsApp`;
  const nota = `Lost: the customer ${origem}. Solved as cancelled and the CRM lead is Lost; it reopens by itself if they write again.`;
  const r: string[] = [];
  r.push(await p.encerrarLeadPerdido(a.telefone, nota).catch((e) => `lead: ${e instanceof Error ? e.message : e}`));
  r.push(`crm: ${await p.marcarLostNoCrm(a.telefone, a.frase).catch(() => 0)} lost`);
  const motivo = "Lead lost: no longer needed";
  await p.passarParaEquipe(a.conversationId, motivo).catch(() => null);
  await p.marcarEstadoEquipe(a.conversationId, motivo).catch(() => null);
  r.push(await p.resolverTicketDaConversa(a.telefone, nota).catch((e) => `conversa: ${e instanceof Error ? e.message : e}`));
  return r.join(" · ");
}

/** Lead do CRM com este telefone que ainda não fechou vira Lost. */
export async function marcarLostNoCrm(sb: SupabaseClient, e164: string, frase: string): Promise<number> {
  const { moverEtapa } = await import("@/lib/crm/lead-servidor");
  const { data } = await sb.from("leads").select("id, stage, job_id").eq("phone", e164).is("deleted_at", null).not("stage", "in", "(won,lost)");
  let n = 0;
  for (const l of (data ?? []) as Array<{ id: string; stage: string; job_id: string | null }>) {
    const fim = await moverEtapa(sb, l as never, { to: "lost", lostReason: "other", lostNote: `Customer said "${frase}" on WhatsApp.`, summary: "Lost: no longer needed", channel: "whatsapp" } as never).catch(() => null);
    if (fim === "lost") n++;
  }
  return n;
}
