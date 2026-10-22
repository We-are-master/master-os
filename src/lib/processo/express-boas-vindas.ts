/**
 * Express v2 (plano do dono, 22/10/2026): job do Express criado com e-mail do
 * cliente = e-mail de boas-vindas com os dados do booking (serviço, dia, janela,
 * endereço), DENTRO do ticket do job, como resposta pública.
 *
 * Fica ao lado do WhatsApp de boas-vindas (harvey-wa/express.ts): o WhatsApp
 * depende de telefone e da janela 8h-20h; o e-mail é o registro escrito.
 *
 * O ticket do Express nasce com a Fixfy Team de solicitante. Para o comentário
 * público chegar ao cliente, o solicitante vira o cliente antes (o mesmo passo
 * que /api/jobs já faz para a reserva do site); se não der, o helper de aviso
 * do job manda como conversa lateral por e-mail no mesmo ticket.
 *
 * Reserva `express-welcome-email:<jobId>` ANTES de mandar. Nunca lança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegrasDoProcesso } from "./conta";
import { ehExpress, emailNormalizado } from "./plataformas";
import { EXPRESS_BOAS_VINDAS_ASSUNTO, EXPRESS_BOAS_VINDAS_HTML, TEXTO_A_CONFIRMAR, preencherTexto } from "./textos";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

export type JobDaBoasVindas = {
  jobId: string;
  referencia: string;
  contaId: string;
  ticketId: number | null;
  clienteId?: string | null;
  nome: string;
  email: string | null;
  servico: string;
  dataIso: string | null;
  inicioIso: string | null;
  fimIso: string | null;
  endereco: string;
};

export type DependenciasDaBoasVindas = {
  /** Põe o cliente como solicitante do ticket. */
  definirSolicitante: (a: { ticketId: number; email: string; nome: string | null; entityId: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Entrega o e-mail no ticket (público quando o solicitante é o cliente). */
  entregar: (a: { ticketId: number; para: { email: string; nome: string | null }; assunto: string; html: string }) => Promise<{ modo: string }>;
  rotuloDoDia: (ymd: string | null) => string | null;
  rotuloDaJanela: (inicio: string | null, fim: string | null) => string | null;
};

export type ResultadoDaBoasVindas =
  | { kind: "enviado"; modo: string }
  | { kind: "pulado"; motivo: string }
  | { kind: "falhou"; motivo: string };

/** Puro: o e-mail pronto. */
export function montarBoasVindasDoExpress(
  j: Pick<JobDaBoasVindas, "referencia" | "nome" | "servico" | "dataIso" | "inicioIso" | "fimIso" | "endereco">,
  rotulos: Pick<DependenciasDaBoasVindas, "rotuloDoDia" | "rotuloDaJanela">,
): { assunto: string; html: string } {
  const primeiro = (j.nome.trim().split(/\s+/)[0] || "there").replace(/^./, (c) => c.toUpperCase());
  const valores = {
    primeiroNome: primeiro,
    referencia: j.referencia,
    servico: j.servico.trim() || "Your booking",
    data: rotulos.rotuloDoDia(j.dataIso) ?? TEXTO_A_CONFIRMAR,
    janela: rotulos.rotuloDaJanela(j.inicioIso, j.fimIso) ?? TEXTO_A_CONFIRMAR,
    endereco: j.endereco.trim() || TEXTO_A_CONFIRMAR,
  };
  return {
    assunto: preencherTexto(EXPRESS_BOAS_VINDAS_ASSUNTO, valores, { html: false }),
    html: preencherTexto(EXPRESS_BOAS_VINDAS_HTML, valores),
  };
}

/** Puro: sai ou não, e por quê. */
export function motivoParaNaoMandarBoasVindas(j: Pick<JobDaBoasVindas, "contaId" | "email" | "ticketId">, regras: RegrasDoProcesso | null): string | null {
  if (!ehExpress(j.contaId)) return "not an Express job";
  if (!regras?.v2) return "account not on v2";
  if (!regras.mensagensAoCliente) return "customer messages off for this account";
  if (!regras.canais.includes("email")) return "email not an allowed channel for this account";
  if (!emailNormalizado(j.email)) return "no customer email";
  if (!j.ticketId) return "no Zendesk ticket on the job";
  return null;
}

async function dependenciasPadrao(): Promise<DependenciasDaBoasVindas> {
  const [{ setTicketRequester }, { avisarNoTicketDoJob }, { rotuloDoDia, rotuloDaJanela }] = await Promise.all([
    import("@/lib/zendesk"),
    import("@/lib/um-ticket/aviso-do-job"),
    import("@/lib/client-confirmation/professional-email"),
  ]);
  return {
    definirSolicitante: (a) => setTicketRequester({ ticketId: a.ticketId, email: a.email, name: a.nome, entityId: a.entityId }),
    entregar: (a) => avisarNoTicketDoJob({ ticketId: a.ticketId, para: a.para, assunto: a.assunto, html: a.html }),
    rotuloDoDia,
    rotuloDaJanela,
  };
}

export async function mandarBoasVindasDoExpress(
  sb: SupabaseClient,
  j: JobDaBoasVindas,
  regras: RegrasDoProcesso | null,
  deps?: DependenciasDaBoasVindas,
): Promise<ResultadoDaBoasVindas> {
  const motivo = motivoParaNaoMandarBoasVindas(j, regras);
  if (motivo) return { kind: "pulado", motivo };
  const email = emailNormalizado(j.email)!;
  const ticketId = j.ticketId!;
  const chave = chaveDeEnvio("express-welcome-email", j.jobId);
  try {
    const d = deps ?? (await dependenciasPadrao());
    const reserva = await reservarEnvio(sb, {
      chave,
      finalidade: "express-welcome-email",
      canal: "email",
      jobId: j.jobId,
      ticketId,
      destinatario: email,
      template: "express_welcome_email",
      motivo: "Express booking created with a customer email",
    });
    if (!reserva.reservado) return { kind: "pulado", motivo: reserva.motivo ?? "already reserved" };
    try {
      const { assunto, html } = montarBoasVindasDoExpress(j, d);
      const solicitante = await d.definirSolicitante({ ticketId, email, nome: j.nome || null, entityId: j.clienteId || j.jobId }).catch((e: unknown) => ({ ok: false, error: String(e) }));
      if (!solicitante.ok) console.warn(`[express-boas-vindas] ${j.referencia}: requester not set (${solicitante.error ?? "?"}), the helper decides the channel`);
      const r = await d.entregar({ ticketId, para: { email, nome: j.nome || null }, assunto, html });
      await confirmarEnvio(sb, chave, `zendesk:${ticketId}:${r.modo}`);
      return { kind: "enviado", modo: r.modo };
    } catch (e) {
      await falhouEnvio(sb, chave, e).catch(() => undefined);
      throw e;
    }
  } catch (e) {
    return { kind: "falhou", motivo: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
