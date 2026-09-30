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
import { classificarNoZendesk, fecharConversaPaga, notaInternaNaConversa, type DadosDoCliente } from "./zendesk-wa";
import { mandarEventoWhatsApp } from "@/lib/meta/eventos-whatsapp";
import { ORIGEM_PADRAO, origemDoLead, origemMaisRecente, type Origem } from "./origem";
import { chamarSite } from "./site";
import { pedirCotacao } from "./cotacao";
import { baixarMidia, digitando, enviarTexto, historico, INTEGRACAO_HARVEY, passarParaEquipe, seguirFluxoPadrao, telefoneDoUsuario, type MensagemSc } from "./sunshine";

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
export async function contextoDaPessoa(
  sb: ReturnType<typeof createServiceClient>,
  telefone: string | null,
  extra: { nomeNoWhatsApp?: string | null; fotos?: string[] } = {},
) {
  const quem = await quemE(sb, telefone).catch((): Identidade => ({ tipo: "novo" }));
  const contas: Contas = {
    reservas: (email) => reservasDoCliente(sb, { telefone, email, clienteId: quem.tipo === "cliente" ? quem.cliente.id : null }),
    pedirCotacao: (pedido) => pedirCotacao(sb, { telefone, quem, nomeNoWhatsApp: extra.nomeNoWhatsApp ?? null, fotos: extra.fotos ?? [], pedido }),
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

/** Até 4 fotos (as mais recentes) que o cliente mandou nesta conversa, como data URL. */
async function fotosDaConversa(sessao: MensagemSc[]): Promise<string[]> {
  const urls = sessao.filter((m) => m.author.type === "user" && m.content.type === "image" && m.content.mediaUrl).map((m) => m.content.mediaUrl as string).slice(-4);
  const fotos = await Promise.all(
    urls.map(async (u) => {
      try {
        const f = await baixarMidia(u);
        return f.tipo.startsWith("image/") && f.dados.length < 8 * 1024 * 1024 ? `data:${f.tipo};base64,${f.dados.toString("base64")}` : null;
      } catch {
        return null;
      }
    }),
  );
  return fotos.filter((f): f is string => !!f);
}

/**
 * Só a conversa de agora: quem volta depois de 6h parado começa do zero, com
 * apresentação nova. Sem isto um pedido velho sem resposta (ou uma passagem
 * para a equipe de outro dia) contaminava o "hi there" seguinte.
 */
const PAUSA_QUE_ENCERRA_MS = (Number(process.env.HARVEY_WA_SESSAO_MIN) || 360) * 60_000; // teste: HARVEY_WA_SESSAO_MIN=5
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
  // Alguém da equipe escreveu na conversa pelo Zendesk: o Harvey sai na hora e
  // não responde mais nada ali (dono, 30/09/2026: "como eu assumo sem ele se meter").
  if (conversa?.id && msg?.author.type === "business" && msg.author.displayName && msg.author.displayName !== "Harvey") {
    const sbEquipe = createServiceClient();
    const { data: est } = await sbEquipe.from("harvey_wa_conversas").select("estado").eq("conversation_id", conversa.id).maybeSingle();
    if (est?.estado === "harvey") {
      await sbEquipe
        .from("harvey_wa_conversas")
        .update({ estado: "equipe", passou_em: new Date().toISOString(), motivo_passagem: `${msg.author.displayName} took over in Zendesk`, chases: 3 })
        .eq("conversation_id", conversa.id);
      if (conversa.activeSwitchboardIntegration?.name === INTEGRACAO_HARVEY) await passarParaEquipe(conversa.id, `${msg.author.displayName} took over`).catch(() => {});
      return `equipe assumiu: ${msg.author.displayName}`;
    }
    return "ignorado: equipe já com a conversa";
  }
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

  // De qual anúncio veio: a mensagem pronta de anúncio mais recente manda (quem já falou com a
  // gente e depois clica num anúncio passa a contar para ele). Sem nenhuma no histórico, vale o lead.
  const leadExistente = (estado?.lead_id as string | null) ?? null;
  const deAnuncio = origemMaisRecente(msgs.filter((m) => m.author.type === "user").map((m) => m.content.text));
  const origem =
    deAnuncio ??
    (leadExistente ? origemDoLead((await sb.from("site_leads").select("source").eq("id", leadExistente).maybeSingle()).data?.source) : null) ??
    ORIGEM_PADRAO;

  // As fotos que o cliente mandou nesta conversa: o Harvey olha (e vão para a cotação, se houver).
  const sessao = sessaoAtual(msgs);
  const fotos = await fotosDaConversa(sessao);
  const { quem, contas, sobreQuem } = await contextoDaPessoa(sb, telefone, { nomeNoWhatsApp: msg.author.displayName ?? null, fotos });

  const r = await pensar(
    paraFalas(sessao),
    { telefone, nomeNoWhatsApp: msg.author.displayName ?? null, campanha: origem.campanha, quem: quem.tipo, sobreQuem, contas, fotos },
    chamarSite,
    await catalogo(),
  );

  if (r.resposta) await enviarTexto(conversa.id, r.resposta);

  // Parceiro não é lead de venda.
  const leadId =
    quem.tipo === "parceiro" ? leadExistente : await registrarLead(sb, { conversationId: conversa.id, leadId: leadExistente, telefone, nome: msg.author.displayName ?? null, origem, deAnuncio, r });
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
    const nota = [`Harvey handed this WhatsApp conversation to the team.`, `Why: ${r.passarParaEquipe}`, r.notaParaEquipe ? `\nWhat Harvey already has:\n${r.notaParaEquipe}` : null, r.cotacao ? `\nLast quote: ${r.cotacao.servico}, £${r.cotacao.total}${r.cotacao.postcode ? `, ${r.cotacao.postcode}` : ""}` : null]
      .filter(Boolean)
      .join("\n");
    const feitoNota = await notaInternaNaConversa(telefone, nota).catch((e) => `nota falhou: ${e instanceof Error ? e.message : e}`);
    console.log("[harvey-wa] passagem:", feitoNota);
    Object.assign(mudancas, { estado: "equipe", passou_em: new Date().toISOString(), motivo_passagem: r.passarParaEquipe });
  }
  await sb.from("harvey_wa_conversas").update(mudancas).eq("conversation_id", conversa.id);

  // Veio de anúncio: a Meta fica sabendo do lead (1ª cotação) e do checkout (link ou banco).
  if (r.cotacao) await mandarEventoWhatsApp(sb, { telefone, evento: "LeadSubmitted", chave: conversa.id }).catch((e) => console.error("[harvey-wa] meta lead", e));
  if (r.checkout) await mandarEventoWhatsApp(sb, { telefone, evento: "InitiateCheckout", chave: r.checkout.ref, valor: r.checkout.total }).catch((e) => console.error("[harvey-wa] meta checkout", e));
  return r.passarParaEquipe ? `passou: ${r.passarParaEquipe}` : r.checkout ? `${r.checkout.metodo === "bank" ? "transferência" : "link"} ${r.checkout.ref}` : "respondeu";
}

/**
 * O lead no OS (site_leads, canal whatsapp): nasce na primeira resposta, ganha
 * serviço e preço na cotação e e-mail no link. Sem sequência de e-mails: quem
 * cuida da conversa é o Harvey. Pagou, o site avisa pelo e-mail e ele vira won.
 */
async function registrarLead(
  sb: ReturnType<typeof createServiceClient>,
  a: { conversationId: string; leadId: string | null; telefone: string | null; nome: string | null; origem: Origem; deAnuncio: Origem | null; r: Awaited<ReturnType<typeof pensar>> },
): Promise<string | null> {
  const agora = new Date().toISOString();
  const campos: Record<string, unknown> = { last_activity_at: agora, updated_at: agora };
  if (a.r.cotacao) Object.assign(campos, { service_label: a.r.cotacao.servico, price: a.r.cotacao.total, postcode: a.r.cotacao.postcode });
  if (a.r.checkout) Object.assign(campos, { email: a.r.checkout.email.toLowerCase(), full_name: a.r.checkout.nome, step_reached: 4, status: "hot", booking_ref: a.r.checkout.ref, postcode: a.r.checkout.postcode, price: a.r.checkout.total });
  if (a.r.passarParaEquipe) campos.notes = `Harvey passed to the team: ${a.r.passarParaEquipe}`;
  try {
    if (a.leadId) {
      // Lead antigo que voltou por um anúncio: passa a contar para esse anúncio.
      if (a.deAnuncio?.conteudo) {
        const { data: atual } = await sb.from("site_leads").select("source, tags").eq("id", a.leadId).maybeSingle();
        const fonte = (atual?.source ?? {}) as Record<string, unknown>;
        if (fonte.utm_content !== a.deAnuncio.conteudo) {
          campos.source = { ...fonte, utm_source: "whatsapp", utm_medium: "paid_social", utm_campaign: a.deAnuncio.campanha, utm_content: a.deAnuncio.conteudo };
          campos.tags = Array.from(new Set([...((atual?.tags as string[] | null) ?? []), "harvey-wa", "wa-ads"]));
        }
      }
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
        source: {
          utm_source: "whatsapp",
          utm_medium: a.origem.conteudo ? "paid_social" : "chat",
          utm_campaign: a.origem.campanha,
          ...(a.origem.conteudo ? { utm_content: a.origem.conteudo } : {}),
        },
        tags: a.origem.conteudo ? ["harvey-wa", "wa-ads"] : ["harvey-wa"],
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
  const { data } = await sb
    .from("harvey_wa_conversas")
    .select("conversation_id, checkout_deposit, checkout_ref, checkout_total, phone")
    .eq("email", email.toLowerCase())
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  // Pagou: nada mais a cobrar.
  await sb.from("harvey_wa_conversas").update({ chases: 3 }).eq("conversation_id", data.conversation_id);
  const ref = bookingRef ?? (data.checkout_ref as string | null);
  if (ref) await mandarEventoWhatsApp(sb, { telefone: data.phone as string | null, evento: "Purchase", chave: ref, valor: data.checkout_total as number | null }).catch((e) => console.error("[harvey-wa] meta compra", e));
  const texto = data.checkout_deposit
    ? `Payment received, thank you. You're booked in${bookingRef ? ` (${bookingRef})` : ""}, and the confirmation is in your email. The other half is paid after the job.`
    : `Payment received, thank you. You're booked in${bookingRef ? ` (${bookingRef})` : ""}, and the confirmation is in your email.`;
  await fecharConversaPaga(data.phone as string | null, `Paid online by card${bookingRef ? `: booking ${bookingRef}` : ""}. The job has its own ticket; closing this WhatsApp conversation.`).catch((e) =>
    console.error("[harvey-wa] fechar ticket pago", e),
  );
  try {
    await enviarTexto(data.conversation_id as string, texto);
    return true;
  } catch (err) {
    console.error("[harvey-wa] aviso de pagamento", err);
    return false;
  }
}
