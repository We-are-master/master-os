/**
 * O motor do Harvey no WhatsApp: da mensagem que chegou até a resposta que sai.
 *
 *   webhook da Sunshine → trava de repetida → quem está com a conversa?
 *   → histórico → cérebro → responde (ou passa para a equipe) → lead no OS
 *
 * Portas (variáveis):
 *   HARVEY_WA_LIGADO=1        sem ela, nada responde (a conversa segue o fluxo de sempre)
 *   HARVEY_WA_SO_ESTES=+44…   lista de teste: só esses telefones falam com ele;
 *                             o resto segue o fluxo de sempre, calado. Vazia = todo mundo.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { pensar, type Contas, type Fala } from "./cerebro";
import { quemE, type Identidade } from "./identidade";
import { reservasDoCliente, situacaoDoParceiro } from "./contas";
import { salvarDocumento, TIPOS_DE_DOC, type TipoDeDoc } from "./documento";
import { classificarNoZendesk, type DadosDoCliente } from "./zendesk-wa";
import { chamarSite } from "./site";
import { digitando, enviarTexto, historico, INTEGRACAO_HARVEY, passarParaEquipe, seguirFluxoPadrao, telefoneDoUsuario, type MensagemSc } from "./sunshine";

type EventoSc = {
  type: string;
  payload: {
    conversation?: { id: string; activeSwitchboardIntegration?: { name?: string } };
    message?: MensagemSc;
  };
};

let catalogoEmCache: { em: number; dados: unknown } | null = null;
export async function catalogo() {
  if (catalogoEmCache && Date.now() - catalogoEmCache.em < 10 * 60_000) return catalogoEmCache.dados;
  const { status, data } = await chamarSite({ action: "catalog" });
  if (status !== 200) throw new Error(`catálogo do site: ${status}`);
  catalogoEmCache = { em: Date.now(), dados: data };
  return data;
}

function listaDeTeste(): string[] {
  return (process.env.HARVEY_WA_SO_ESTES ?? "").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);
}

export function paraFalas(msgs: MensagemSc[]): Fala[] {
  return msgs
    .map((m): Fala | null => {
      const texto = m.content.type === "text" ? m.content.text ?? "" : `[${m.content.type} sent${m.content.altText ? `: ${m.content.altText}` : ""}]`;
      if (!texto.trim()) return null;
      if (m.author.type === "user") return { papel: "cliente", texto, ...(m.content.mediaUrl ? { midia: m.content.mediaUrl } : {}) };
      return { papel: m.author.displayName === "Harvey" ? "harvey" : "equipe", texto };
    })
    .filter((f): f is Fala => f !== null);
}

/**
 * Quem é a pessoa e o que o Harvey já sabe dela antes de responder: parceiro
 * (status e documentos pela ferramenta) ou cliente, com as reservas já na mão
 * para saber se é job feito, job marcado ou pedido novo sem precisar perguntar.
 */
export async function contextoDaPessoa(sb: ReturnType<typeof createServiceClient>, telefone: string | null) {
  const quem = await quemE(sb, telefone).catch((): Identidade => ({ tipo: "novo" }));
  const contas: Contas = {
    reservas: (email) => reservasDoCliente(sb, { telefone, email, clienteId: quem.tipo === "cliente" ? quem.cliente.id : null }),
    ...(quem.tipo === "parceiro"
      ? {
          situacaoDoParceiro: () => situacaoDoParceiro(sb, quem.parceiro),
          salvarDocumento: (tipo: string, mediaUrl: string) =>
            (TIPOS_DE_DOC as readonly string[]).includes(tipo) ? salvarDocumento(sb, quem.parceiro, tipo as TipoDeDoc, mediaUrl) : Promise.resolve({ error: "unknown document type" }),
        }
      : {}),
  };
  let sobreQuem: string | undefined;
  if (quem.tipo === "parceiro") {
    const p = quem.parceiro;
    sobreQuem = `Partner in our system: ${p.contact_name ?? p.company_name ?? "unknown name"}${p.company_name ? ` (${p.company_name})` : ""}, ${p.trade ?? "trade not set"}, account status ${p.status}.`;
  } else if (quem.tipo === "cliente") {
    const reservas = await contas.reservas(null).catch(() => null);
    sobreQuem =
      `Existing customer in our system: ${quem.cliente.full_name ?? "name unknown"}. ` +
      `Their bookings (recent and upcoming): ${JSON.stringify((reservas as { reservas?: unknown[] } | null)?.reservas ?? [])}. ` +
      "Use this to understand what they are messaging about: a job that is coming up (confirm the details), a job already done (thank them; any problem or complaint goes to the team), a balance to pay (send the link), or something new (sell as usual). If it is not clear, ask one short question.";
  }
  return { quem, contas, sobreQuem };
}

/**
 * Só a conversa de agora: quem volta depois de 6h parado começa do zero, com
 * apresentação nova. Sem isto um pedido velho sem resposta (ou uma passagem
 * para a equipe de outro dia) contaminava o "hi there" seguinte.
 */
const PAUSA_QUE_ENCERRA_MS = 6 * 3_600_000;
export function sessaoAtual(msgs: MensagemSc[]): MensagemSc[] {
  for (let i = msgs.length - 1; i > 0; i--) {
    const agora = Date.parse(msgs[i].received ?? "");
    const antes = Date.parse(msgs[i - 1].received ?? "");
    if (agora && antes && agora - antes > PAUSA_QUE_ENCERRA_MS) return msgs.slice(i);
  }
  return msgs;
}

/** Um evento da Sunshine. Só a mensagem do cliente, na conversa que é do Harvey, gera resposta. */
export async function processarEvento(evento: EventoSc): Promise<string> {
  if (evento.type !== "conversation:message") return "ignorado: tipo";
  const conversa = evento.payload.conversation;
  const msg = evento.payload.message;
  if (!conversa?.id || !msg || msg.author.type !== "user") return "ignorado: não é do cliente";
  if (conversa.activeSwitchboardIntegration?.name && conversa.activeSwitchboardIntegration.name !== INTEGRACAO_HARVEY) return "ignorado: conversa com a equipe";
  // Só WhatsApp. O chat do site (web) e qualquer outro canal seguem o fluxo de sempre.
  if (msg.source?.type !== "whatsapp") {
    await seguirFluxoPadrao(conversa.id).catch(() => {});
    return `ignorado: canal ${msg.source?.type ?? "desconhecido"}`;
  }

  const sb = createServiceClient();
  // Trava: a Sunshine reenvia o evento quando a resposta demora.
  const { error: repetida } = await sb.from("harvey_wa_mensagens").insert({ message_id: msg.id, conversation_id: conversa.id });
  if (repetida) return "ignorado: repetida";

  const { data: estado } = await sb.from("harvey_wa_conversas").select("*").eq("conversation_id", conversa.id).maybeSingle();
  if (estado && estado.estado !== "harvey") return `ignorado: ${estado.estado}`;

  const telefone = (estado?.phone as string | null) ?? (msg.author.userId ? await telefoneDoUsuario(msg.author.userId) : null);
  if (process.env.HARVEY_WA_LIGADO !== "1") {
    await seguirFluxoPadrao(conversa.id);
    return "desligado: seguiu o fluxo padrão";
  }
  const lista = listaDeTeste();
  if (lista.length && !lista.includes((telefone ?? "").replace(/\D/g, ""))) {
    await seguirFluxoPadrao(conversa.id);
    return "fora da lista de teste";
  }
  if (!estado) {
    await sb.from("harvey_wa_conversas").insert({ conversation_id: conversa.id, user_id: msg.author.userId ?? null, phone: telefone, name: msg.author.displayName ?? null });
  }

  await digitando(conversa.id);
  // Quem digita em rajada: espera um pouco e responde tudo junto (a mensagem mais nova manda).
  await new Promise((r) => setTimeout(r, 2500));
  const msgs = await historico(conversa.id);
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
  if (ultimaDoCliente && ultimaDoCliente.id !== msg.id) return "ignorado: chegou outra mensagem depois, ela responde";

  const { quem, contas, sobreQuem } = await contextoDaPessoa(sb, telefone);

  const r = await pensar(
    paraFalas(sessaoAtual(msgs)),
    { telefone, nomeNoWhatsApp: msg.author.displayName ?? null, campanha: "wa_v1", quem: quem.tipo, sobreQuem, contas },
    chamarSite,
    await catalogo(),
  );

  if (r.resposta) await enviarTexto(conversa.id, r.resposta);

  // Parceiro não é lead de venda.
  const leadId =
    quem.tipo === "parceiro"
      ? ((estado?.lead_id as string | null) ?? null)
      : await registrarLead(sb, { conversationId: conversa.id, leadId: (estado?.lead_id as string | null) ?? null, telefone, nome: msg.author.displayName ?? null, r });
  const mudancas: Record<string, unknown> = {
    atualizado_em: new Date().toISOString(),
    // O relógio do chase: a pessoa falou, o Harvey respondeu, zera a contagem.
    cliente_em: msg.received ?? new Date().toISOString(),
    ...(r.resposta ? { harvey_em: new Date().toISOString(), chases: 0 } : {}),
    lead_id: leadId,
    tipo: quem.tipo,
    partner_id: quem.tipo === "parceiro" ? quem.parceiro.id : null,
    client_id: quem.tipo === "cliente" ? quem.cliente.id : null,
  };
  // Zendesk: separa parceiro de cliente na primeira mensagem e preenche o perfil quando a reserva traz os dados.
  // Refaz enquanto o ticket da conversa não apareceu no Zendesk.
  if (!String(estado?.zendesk_resultado ?? "").includes("ticket") || r.checkout || estado?.tipo !== quem.tipo) {
    const dados: DadosDoCliente = r.checkout ? { nome: r.checkout.nome, email: r.checkout.email, postcode: r.checkout.postcode } : {};
    const feito = await classificarNoZendesk(telefone, quem, dados).catch((e) => `falhou: ${e instanceof Error ? e.message : e}`);
    Object.assign(mudancas, { zendesk_em: new Date().toISOString(), zendesk_resultado: feito.slice(0, 300) });
  }
  if (r.checkout)
    Object.assign(mudancas, {
      checkout_ref: r.checkout.ref,
      checkout_total: r.checkout.total,
      checkout_deposit: r.checkout.deposit,
      checkout_method: r.checkout.metodo,
      checkout_at: new Date().toISOString(),
      checkout_sinal: r.checkout.sinal,
      job_ids: r.checkout.jobIds,
      lembrado_em: null,
      liberado_em: null,
      sinal_recebido_em: null,
      email: r.checkout.email.toLowerCase(),
    });
  if (r.passarParaEquipe) {
    await passarParaEquipe(conversa.id, r.passarParaEquipe);
    Object.assign(mudancas, { estado: "equipe", passou_em: new Date().toISOString(), motivo_passagem: r.passarParaEquipe });
  }
  await sb.from("harvey_wa_conversas").update(mudancas).eq("conversation_id", conversa.id);
  return r.passarParaEquipe ? `passou: ${r.passarParaEquipe}` : r.checkout ? `${r.checkout.metodo === "bank" ? "transferência" : "link"} ${r.checkout.ref}` : "respondeu";
}

/**
 * O lead no OS (site_leads, canal whatsapp): nasce na primeira resposta, ganha
 * serviço e preço na cotação e e-mail no link. Sem sequência de e-mails: quem
 * cuida da conversa é o Harvey. Pagou, o site avisa pelo e-mail e ele vira won.
 */
async function registrarLead(
  sb: ReturnType<typeof createServiceClient>,
  a: { conversationId: string; leadId: string | null; telefone: string | null; nome: string | null; r: Awaited<ReturnType<typeof pensar>> },
): Promise<string | null> {
  const agora = new Date().toISOString();
  const campos: Record<string, unknown> = { last_activity_at: agora, updated_at: agora };
  if (a.r.cotacao) Object.assign(campos, { service_label: a.r.cotacao.servico, price: a.r.cotacao.total, postcode: a.r.cotacao.postcode });
  if (a.r.checkout) Object.assign(campos, { email: a.r.checkout.email.toLowerCase(), full_name: a.r.checkout.nome, step_reached: 4, status: "hot", booking_ref: a.r.checkout.ref, postcode: a.r.checkout.postcode, price: a.r.checkout.total });
  if (a.r.passarParaEquipe) campos.notes = `Harvey passed to the team: ${a.r.passarParaEquipe}`;
  try {
    if (a.leadId) {
      await sb.from("site_leads").update(campos).eq("id", a.leadId);
      return a.leadId;
    }
    const { data, error } = await sb
      .from("site_leads")
      .insert({
        ...campos,
        channel: "whatsapp",
        phone: a.telefone,
        full_name: (campos.full_name as string) ?? a.nome,
        status: (campos.status as string) ?? "new",
        step_reached: (campos.step_reached as number) ?? 1,
        sequence_state: "none",
        source: { utm_source: "whatsapp", utm_medium: "chat", utm_campaign: "wa_v1" },
        tags: ["harvey-wa"],
        selection: {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (err) {
    console.error("[harvey-wa] lead", a.conversationId, err);
    return a.leadId;
  }
}

/** O site avisou que pagou (pelo e-mail): o Harvey confirma no WhatsApp da pessoa. */
export async function avisarPagamentoNoWhatsApp(email: string, bookingRef: string | null): Promise<boolean> {
  const sb = createServiceClient();
  const { data } = await sb.from("harvey_wa_conversas").select("conversation_id, checkout_deposit").eq("email", email.toLowerCase()).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
  if (!data) return false;
  // Pagou: nada mais a cobrar.
  await sb.from("harvey_wa_conversas").update({ chases: 3 }).eq("conversation_id", data.conversation_id);
  const texto = data.checkout_deposit
    ? `Payment received, thank you. You're booked in${bookingRef ? ` (${bookingRef})` : ""}, and the confirmation is in your email. The other half is paid after the job.`
    : `Payment received, thank you. You're booked in${bookingRef ? ` (${bookingRef})` : ""}, and the confirmation is in your email.`;
  try {
    await enviarTexto(data.conversation_id as string, texto);
    return true;
  } catch (err) {
    console.error("[harvey-wa] aviso de pagamento", err);
    return false;
  }
}
