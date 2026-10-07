/**
 * Express do Checkatrade (dono, 07/10/2026): o Ruben aceita, o job nasce no OS
 * em Unassigned com ticket próprio, e o cliente recebe pelo WhatsApp do Zendesk
 * o template checkatrade_express_booking ("agora somos nós que cuidamos do seu
 * booking"). A nota no ticket do job mostra a mensagem como ele leu e a próxima
 * ação. Quando ele responde, o Harvey assume (#706) e o ticket do job entra na
 * conversa (juntarTicketDoJob): um ticket só.
 *
 * Desligado até HARVEY_WA_EXPRESS_ON=1. Fora das 8h-20h não sai: a nota diz que
 * sai de manhã e scripts/harvey-wa/express-pendentes.mts manda os que ficaram.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dentroDaJanela } from "@/lib/agent/sales/dispatch-one";
import { zendeskApi } from "@/lib/zendesk";
import { chaveDoTelefone } from "./identidade";
import { telefoneE164 } from "./primeiro-contato";
import { scApi, scNotificacao } from "./sunshine";

export const TEMPLATE_DO_EXPRESS = () => process.env.HARVEY_WA_EXPRESS_TEMPLATE?.trim() || "checkatrade_express_booking";
/** A conta Checkatrade no OS: job dela criado pelo Ruben é Express. */
export const CONTA_DO_EXPRESS = () => process.env.HARVEY_WA_EXPRESS_ACCOUNT_ID?.trim() || "38b48520-f116-4263-90e5-8cd5a7d39ecf";
const NAMESPACE = () => process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542";

const TEXTO =
  "Hi {{1}}, this is Fixfy. We've accepted your Checkatrade booking for {{2}} on {{3}}, and from now on we're looking after it for you.\n\nWe'll confirm your professional and arrival time here. If anything changes or you have a question, just reply to this message.";

export function expressLigado(): boolean {
  return process.env.HARVEY_WA_EXPRESS_ON === "1";
}

export type JobDoExpress = { jobId: string; referencia: string; ticketId: number; nome: string; telefone: string | null; titulo: string; dataIso: string | null };

/** As três variáveis do template: primeiro nome, serviço em minúscula, dia por extenso. */
export function variaveisDoExpress(j: Pick<JobDoExpress, "nome" | "titulo" | "dataIso">): [string, string, string] {
  const primeiro = (j.nome.trim().split(/\s+/)[0] || "there").replace(/^./, (c) => c.toUpperCase());
  const t = j.titulo.trim();
  const servico = !t || /general maintenance|handyman/i.test(t) ? "handyman work" : t.toLowerCase();
  const dia = j.dataIso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${j.dataIso}T12:00:00Z`))
    : "the booked day";
  return [primeiro, servico, dia];
}

async function nota(ticketId: number, texto: string) {
  await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false } } } });
}

async function integracaoWhatsApp(): Promise<string> {
  const r = await scApi<{ integrations: Array<{ id: string; type: string }> }>("/integrations?filter[types]=whatsapp");
  const id = r.integrations?.[0]?.id;
  if (!id) throw new Error("integração de WhatsApp não achada no Sunshine");
  return id;
}

export type ResultadoDoExpress = { kind: "enviado" | "fora_da_janela" | "sem_telefone" | "ja_falamos" | "desligado" } | { kind: "falhou"; motivo: string };

/** Manda o template do Express para um job e anota no ticket. Nunca lança. */
export async function mandarTemplateDoExpress(sb: SupabaseClient, j: JobDoExpress, opcoes: { ignorarJanela?: boolean } = {}): Promise<ResultadoDoExpress> {
  if (!expressLigado()) return { kind: "desligado" };
  const destino = telefoneE164(j.telefone);
  try {
    if (!destino) {
      await nota(j.ticketId, "Express accepted: no customer phone came from the platform, so no WhatsApp went out. Next action: call or message the customer from the platform.");
      return { kind: "sem_telefone" };
    }
    const chave = chaveDoTelefone(destino);
    const { data: ja } = await sb.from("harvey_wa_leads").select("chave, job_id").eq("chave", chave).maybeSingle();
    if (ja?.job_id === j.jobId) return { kind: "ja_falamos" };
    if (!opcoes.ignorarJanela && !dentroDaJanela()) {
      await nota(j.ticketId, `Express accepted outside WhatsApp hours. The welcome WhatsApp (${TEMPLATE_DO_EXPRESS()}) goes out at 8am London time.`);
      return { kind: "fora_da_janela" };
    }
    const vars = variaveisDoExpress(j);
    await scNotificacao({
      destination: { integrationId: await integracaoWhatsApp(), destinationId: destino },
      author: { role: "appMaker" },
      messageSchema: "whatsapp",
      message: {
        type: "template",
        template: {
          namespace: NAMESPACE(),
          name: TEMPLATE_DO_EXPRESS(),
          language: { policy: "deterministic", code: "en_GB" },
          components: [{ type: "body", parameters: vars.map((text) => ({ type: "text", text })) }],
        },
      },
      metadata: { origem: "checkatrade_express", jobId: j.jobId },
    });
    await sb.from("harvey_wa_leads").upsert(
      { chave, telefone: destino, servico: vars[1], enviado_em: new Date().toISOString(), job_id: j.jobId, ticket_id: j.ticketId, origem: "express", lead_externo: null },
      { onConflict: "chave" },
    );
    const ligarAte = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + 2 * 3600_000));
    await nota(
      j.ticketId,
      [
        `Express ${j.referencia}: welcome WhatsApp sent automatically (${TEMPLATE_DO_EXPRESS()}). What the customer received:`,
        "",
        vars.reduce((t, v, i) => t.split(`{{${i + 1}}}`).join(v), TEXTO),
        "",
        `Next action: assign a partner. If the customer replies, Harvey answers and this ticket becomes the WhatsApp conversation. No reply by ${ligarAte}: no action needed unless the booking needs details.`,
      ].join("\n"),
    );
    return { kind: "enviado" };
  } catch (e) {
    const motivo = e instanceof Error ? e.message.slice(0, 200) : "falhou";
    await nota(j.ticketId, `Express accepted, but the welcome WhatsApp did not go out (${motivo}). Next action: message the customer.`).catch(() => {});
    return { kind: "falhou", motivo };
  }
}

/**
 * Uma linha para o Harvey sobre o Express deste telefone: qual job, serviço,
 * dia e janela. Sem Express, null.
 */
export async function contextoDoExpress(sb: SupabaseClient, telefone: string): Promise<string | null> {
  const { data: l } = await sb.from("harvey_wa_leads").select("job_id, origem").eq("chave", chaveDoTelefone(telefone)).maybeSingle();
  if (!l?.job_id || l.origem !== "express") return null;
  const { data: j } = await sb.from("jobs").select("reference, title, scheduled_date, arrival_time, status, partner_id").eq("id", l.job_id).maybeSingle();
  if (!j) return null;
  const dia = j.scheduled_date ? variaveisDoExpress({ nome: "x", titulo: "", dataIso: String(j.scheduled_date).slice(0, 10) })[2] : "the booked day";
  return `This customer booked through Checkatrade Express and Fixfy accepted the job: ${j.reference}, ${j.title}, on ${dia}${j.arrival_time ? `, arrival ${j.arrival_time}` : ""}, ${j.partner_id ? "professional assigned" : "professional not assigned yet"}. Our welcome template was the first message (you have already introduced Fixfy: do not introduce yourself again). The price is already agreed on Checkatrade: never quote or send a payment link for this job. Answer questions about it with get_my_bookings; changes, cancellations or anything you cannot answer go to the team.`;
}
