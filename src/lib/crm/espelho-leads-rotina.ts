/**
 * A passada de leads do espelho do Zendesk (fase 3 e 4 do CRM). Roda a cada
 * 10 min pelo fixfy-workers, junto do espelho de job e quote
 * (scripts/espelho-zendesk.mts chama, scripts/espelho-leads.mts roda sozinha).
 *
 *   1. etapa pelas quotes (todos os leads com quote) e Nurture que venceu hoje
 *   2. sinal de resposta pelo campo Reply Status (e-mail não tem webhook de
 *      comentário; o WhatsApp já chega na hora pelo motor do Harvey)
 *   3. ticket de lead SEM quote nem job: status pela etapa e uma tag crm_*
 *
 * Sem `aplicar` só conta o que faria. Nada de IA, nenhuma mensagem ao cliente,
 * nenhum ticket novo. Escreve em lote (tickets/update_many): PUT por ticket
 * estoura o limite de atualização da conta (429).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadLostReason, LeadStage } from "@/types/database";
import { zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { acordarNurture, marcarRespostaDoCliente, marcarRespostaNossa, registrarEvento, sincronizarEtapasPelasQuotes } from "./lead-servidor";
import { alvoDoTicketDoLead, hojeEmLondres, leadDoTicket, nurtureIdDoAmbiente, pessoaDoAssunto, sinalDeResposta, STATUS_DE_ENTRADA, tagsDoLead } from "./espelho-leads";
import { segmentoPeloProcesso } from "./fontes";

const WHAT_HAPPENED_FIELD_ID = Number(process.env.ZENDESK_WHAT_HAPPENED_FIELD_ID?.trim() || "5687150349343");
const CLOSING_SUMMARY_FIELD_ID = Number(process.env.ZENDESK_CLOSING_SUMMARY_FIELD_ID?.trim() || "6417950403231");
/** Campo Resolution do formulário (o mesmo que o Harvey grava no lead perdido). */
const RESOLUTION_FIELD_ID = Number(process.env.ZENDESK_RESOLUTION_FIELD_ID?.trim() || "5872761703199");

type LeadDoEspelho = {
  id: string;
  reference: string | null;
  stage: LeadStage;
  nurture_until: string | null;
  lost_reason: LeadLostReason | null;
  external_ref: string;
  customer_replied_at: string | null;
};

type TicketCru = {
  id: number;
  status: string | null;
  custom_status_id: number | null;
  updated_at?: string | null;
  support_type?: string | null;
  tags?: string[];
  custom_fields?: Array<{ id: number; value: unknown }>;
};

export type ResultadoDoEspelhoDeLeads = {
  conta: Record<string, number>;
  linhas: string[];
};

const LOTE = 100;

function campo(t: TicketCru, id: number): unknown {
  return t.custom_fields?.find((f) => Number(f.id) === id)?.value ?? null;
}

export async function passarLeadsNoEspelho(
  sb: SupabaseClient,
  opts: { aplicar: boolean; detalhe?: boolean; dias?: number; agora?: Date },
): Promise<ResultadoDoEspelhoDeLeads> {
  const { aplicar, detalhe = false } = opts;
  const agora = opts.agora ?? new Date();
  const dias = opts.dias ?? 14;
  const conta: Record<string, number> = {};
  const somar = (k: string, n = 1) => (conta[k] = (conta[k] ?? 0) + n);
  const linhas: string[] = [];

  // 0. Ticket de lead do Zendesk sem nada no OS cai no CRM (dono, 06/11/2026).
  try {
    const entrada = await trazerLeadsDoZendesk(sb, { aplicar, dias, detalhe });
    if (entrada.criados) somar(aplicar ? "leads: entraram do Zendesk (novos ou ligados)" : "leads: entrariam do Zendesk (novos ou ligados)", entrada.criados);
    linhas.push(...entrada.linhas);
  } catch (e) {
    linhas.push(`entrada do Zendesk: ERRO ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
  }

  // 1. Etapa pelas quotes (rede de segurança de toda escrita de quote) e Nurture vencido.
  const sync = await sincronizarEtapasPelasQuotes(sb, { aplicar });
  if (sync.movidos) somar(aplicar ? "leads: etapa pela quote" : "leads: etapa pela quote (moveria)", sync.movidos);
  if (sync.ganhos) somar(aplicar ? "leads: won pelo job" : "leads: won pelo job (moveria)", sync.ganhos);
  for (const e of sync.erros) linhas.push(`leads sync: ERRO ${e.slice(0, 160)}`);
  const acordados = await acordarNurture(sb, hojeEmLondres(agora), aplicar);
  if (acordados) somar(aplicar ? "leads: voltaram do nurture" : "leads: voltariam do nurture", acordados);

  // 2. Leads vivos com ticket. Lost só os mexidos na janela; Won é do espelho do job.
  const desde = new Date(agora.getTime() - dias * 86_400_000).toISOString();
  const { data: lidos, error } = await sb
    .from("leads")
    .select("id, reference, stage, lost_reason, nurture_until, external_ref, customer_replied_at, updated_at")
    .eq("external_source", "zendesk")
    .not("external_ref", "is", null)
    .is("deleted_at", null)
    .or(`stage.in.(new,qualified,quoting,quoted),and(stage.eq.lost,updated_at.gte.${desde})`)
    .limit(3000);
  if (error) {
    linhas.push(`leads: ERRO ${error.message}`);
    return { conta, linhas };
  }
  const leads = ((lidos ?? []) as LeadDoEspelho[]).filter((l) => /^\d+$/.test(String(l.external_ref).trim()));
  if (!leads.length) return { conta, linhas };
  const refs = [...new Set(leads.map((l) => String(l.external_ref).trim()))];

  // Ticket com quote ou job já é do espelho de job e quote: o lead não briga.
  const comPedido = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const lote = refs.slice(i, i + 200);
    const [jobs, quotes] = await Promise.all([
      sb.from("jobs").select("external_ref").eq("external_source", "zendesk").in("external_ref", lote).is("deleted_at", null).neq("status", "deleted"),
      sb.from("quotes").select("external_ref").eq("external_source", "zendesk").in("external_ref", lote).is("deleted_at", null),
    ]);
    for (const r of [...(jobs.data ?? []), ...(quotes.data ?? [])] as Array<{ external_ref: string | null }>) comPedido.add(String(r.external_ref ?? ""));
  }

  const tickets = new Map<string, TicketCru>();
  for (let i = 0; i < refs.length; i += LOTE) {
    const { tickets: lote } = await zendeskApi<{ tickets?: TicketCru[] }>(`tickets/show_many.json?ids=${refs.slice(i, i + LOTE).join(",")}`);
    for (const t of lote ?? []) tickets.set(String(t.id), t);
  }

  // Categoria de cada status (o Zendesk recusa custom_status_id de outra categoria sem o status base).
  const categoria = new Map<number, { cat: string; ativo: boolean }>();
  try {
    const { custom_statuses } = await zendeskApi<{ custom_statuses?: Array<{ id: number; status_category: string; active: boolean }> }>("custom_statuses.json");
    for (const c of custom_statuses ?? []) categoria.set(Number(c.id), { cat: c.status_category, ativo: c.active !== false });
  } catch (e) {
    linhas.push(`custom_statuses: ERRO ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  }
  const nurtureId = nurtureIdDoAmbiente();
  if (nurtureId == null && leads.some((l) => l.stage === "lost" && l.nurture_until)) somar("leads: lost com data de volta sem ZENDESK_STATUS_NURTURE_ID (ticket não muda)");

  const pendentes: Array<Record<string, unknown>> = [];
  for (const l of leads) {
    const ref = String(l.external_ref).trim();
    const t = tickets.get(ref);
    if (!t) {
      somar("leads: ticket não existe");
      continue;
    }
    const reply = (campo(t, ZENDESK_REPLY_STATUS_FIELD_ID) as string | null) ?? null;
    let stage = l.stage;

    // Sinal de resposta (e-mail): o Reply Status diz quem escreveu por último.
    const sinal = t.status === "closed" ? null : sinalDeResposta(reply, l.customer_replied_at);
    if (sinal) {
      somar(aplicar ? `leads: resposta ${sinal === "cliente" ? "do cliente" : "nossa"} marcada` : `leads: marcaria resposta ${sinal === "cliente" ? "do cliente" : "nossa"}`);
      if (detalhe) linhas.push(`${l.reference} #${ref}: resposta ${sinal}`);
      if (aplicar) {
        const at = t.updated_at ?? agora.toISOString();
        const eventoId = `rs:${at}`;
        try {
          if (sinal === "cliente") await marcarRespostaDoCliente(sb, { ticketId: ref, at, channel: "zendesk", eventoId });
          else await marcarRespostaNossa(sb, { ticketId: ref, at, channel: "zendesk", actorType: "staff", eventoId });
        } catch (e) {
          linhas.push(`${l.reference} #${ref}: ERRO resposta ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
        }
      }
      if (sinal === "cliente" && stage === "lost" && l.nurture_until) stage = "new";
    }

    if (comPedido.has(ref)) {
      somar("leads: ticket com quote ou job (espelho do pedido)");
      continue;
    }
    if (t.status === "closed") {
      somar("leads: ticket closed");
      continue;
    }

    const alvo = alvoDoTicketDoLead({ stage, lostReason: l.lost_reason, nurtureUntil: stage === "lost" ? l.nurture_until : null }, { status: t.status, customStatusId: t.custom_status_id, replyStatus: reply, supportType: t.support_type }, nurtureId);
    const tags = tagsDoLead(stage, t.tags ?? []);
    const mud: Record<string, unknown> = { id: t.id };
    if (alvo.kind === "status") {
      const c = categoria.get(alvo.customStatusId);
      if (categoria.size && (!c || !c.ativo)) {
        somar("leads: status alvo inativo ou inexistente no Zendesk");
        linhas.push(`${l.reference} #${ref}: status ${alvo.customStatusId} não está ativo no Zendesk`);
      } else {
        mud.custom_status_id = alvo.customStatusId;
        if (c && c.cat !== "new") mud.status = c.cat;
      }
    } else if (alvo.kind === "solved") {
      mud.status = "solved";
      const campos: Array<{ id: number; value: string }> = [{ id: RESOLUTION_FIELD_ID, value: alvo.resolucao }];
      if (!campo(t, WHAT_HAPPENED_FIELD_ID)) campos.push({ id: WHAT_HAPPENED_FIELD_ID, value: "other" });
      if (!campo(t, CLOSING_SUMMARY_FIELD_ID)) campos.push({ id: CLOSING_SUMMARY_FIELD_ID, value: alvo.resumo });
      mud.custom_fields = campos;
    } else if (alvo.motivo !== "already mirrored" && alvo.motivo !== "already solved") {
      somar(`leads: ticket fica (${alvo.motivo})`);
    }
    if (tags.add.length) mud.additional_tags = tags.add;
    if (tags.remove.length) mud.remove_tags = tags.remove;
    if (Object.keys(mud).length === 1) {
      somar("leads: ticket já igual");
      continue;
    }
    if (mud.custom_status_id != null) somar(aplicar ? "leads: status gravado" : "leads: status (gravaria)");
    if (mud.status === "solved") somar(aplicar ? "leads: lost → solved" : "leads: lost → solved (gravaria)");
    if (mud.additional_tags || mud.remove_tags) somar(aplicar ? "leads: tag crm_* gravada" : "leads: tag crm_* (gravaria)");
    if (detalhe) linhas.push(`${l.reference} ${stage} #${ref}: ${JSON.stringify({ ...mud, id: undefined })} (era ${t.custom_status_id}/${t.status})`);
    pendentes.push(mud);
  }

  for (let i = 0; i < pendentes.length; i += LOTE) {
    if (!aplicar) break;
    const lote = pendentes.slice(i, i + LOTE);
    try {
      await zendeskApi("tickets/update_many.json", { method: "PUT", body: { tickets: lote } });
    } catch (e) {
      somar("leads: erro no lote");
      linhas.push(`leads em lote: ERRO ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
  return { conta, linhas };
}


type TicketDeEntrada = { id: number; subject?: string | null; status: string; custom_status_id: number | null; requester_id?: number | null; tags?: string[] };
type UsuarioZd = { id: number; name?: string | null; email?: string | null; phone?: string | null };

/**
 * Passo 0: tickets em Lead, To Call ou Needs Quote mexidos nos últimos `dias`
 * que ainda não têm lead, quote nem job no OS viram lead na coluna do status.
 * Ticket do primeiro contato do Harvey (harvey_wa_lead): o lead já existe
 * (registrarLeadNoOs), só sem o ticket; liga pelo nome e postcode do assunto
 * e nunca cria outro. Nada vai ao cliente.
 */
export async function trazerLeadsDoZendesk(
  sb: SupabaseClient,
  opts: { aplicar: boolean; dias: number; detalhe?: boolean },
): Promise<{ criados: number; linhas: string[] }> {
  const linhas: string[] = [];
  const tickets: TicketDeEntrada[] = [];
  for (const statusId of STATUS_DE_ENTRADA) {
    const q = `type:ticket custom_status_id:${statusId} updated>${Math.max(1, opts.dias)}days`;
    const r = await zendeskApi<{ results?: TicketDeEntrada[] }>(`search.json?query=${encodeURIComponent(q)}&per_page=100`);
    for (const t of r.results ?? []) {
      if (t.status === "solved" || t.status === "closed") continue;
      tickets.push(t);
    }
  }
  if (!tickets.length) return { criados: 0, linhas };

  const refs = [...new Set(tickets.map((t) => String(t.id)))];
  const ocupados = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const lote = refs.slice(i, i + 200);
    const [leads, jobs, quotes] = await Promise.all([
      sb.from("leads").select("external_ref").eq("external_source", "zendesk").in("external_ref", lote),
      sb.from("jobs").select("external_ref").eq("external_source", "zendesk").in("external_ref", lote).is("deleted_at", null),
      sb.from("quotes").select("external_ref").eq("external_source", "zendesk").in("external_ref", lote).is("deleted_at", null),
    ]);
    for (const r of [...(leads.data ?? []), ...(jobs.data ?? []), ...(quotes.data ?? [])] as Array<{ external_ref: string | null }>) {
      ocupados.add(String(r.external_ref ?? ""));
    }
  }
  const novos = tickets.filter((t) => !ocupados.has(String(t.id)));
  if (!novos.length) return { criados: 0, linhas };

  const pessoas = new Map<number, UsuarioZd>();
  const ids = [...new Set(novos.map((t) => t.requester_id).filter((x): x is number => !!x))];
  for (let i = 0; i < ids.length; i += 100) {
    const { users } = await zendeskApi<{ users?: UsuarioZd[] }>(`users/show_many.json?ids=${ids.slice(i, i + 100).join(",")}`);
    for (const u of users ?? []) pessoas.set(u.id, u);
  }

  let criados = 0;
  for (const t of novos) {
    const doHarvey = (t.tags ?? []).includes("harvey_wa_lead");
    const pessoa = pessoaDoAssunto(t.subject);
    if (pessoa) {
      const { data: soltos } = await sb
        .from("leads")
        .select("id, reference, name, postcode")
        .is("external_ref", null)
        .is("deleted_at", null)
        .in("stage", ["new", "qualified", "quoting", "quoted"])
        .ilike("name", pessoa.nome)
        .limit(5);
      const doTicket = ((soltos ?? []) as Array<{ id: string; reference: string; postcode: string | null }>).filter(
        (l) => String(l.postcode ?? "").replace(/\s+/g, "").toUpperCase() === pessoa.postcode.replace(/\s+/g, ""),
      );
      if (doTicket.length === 1) {
        if (opts.detalhe) linhas.push(`#${t.id} → liga ao ${doTicket[0].reference}`);
        if (opts.aplicar) {
          const { error } = await sb
            .from("leads")
            .update({ external_source: "zendesk", external_ref: String(t.id), updated_at: new Date().toISOString() })
            .eq("id", doTicket[0].id)
            .is("external_ref", null);
          if (error) linhas.push(`#${t.id}: ERRO ao ligar ${error.message}`);
        }
        criados++;
        continue;
      }
    }
    if (doHarvey) continue;
    const linha = leadDoTicket({ id: t.id, subject: t.subject, customStatusId: t.custom_status_id }, t.requester_id ? pessoas.get(t.requester_id) ?? null : null);
    if (!linha) continue;
    if (opts.detalhe) linhas.push(`#${t.id} → ${linha.stage} · ${linha.name}`);
    if (!opts.aplicar) {
      criados++;
      continue;
    }
    // Cliente que já existe (pelo e-mail): o lead nasce ligado a ele e à conta dele.
    if (linha.email) {
      const { data: c } = await sb.from("clients").select("id, source_account_id").ilike("email", linha.email as string).is("deleted_at", null).limit(1).maybeSingle();
      const cli = c as { id: string; source_account_id: string | null } | null;
      if (cli) {
        linha.client_id = cli.id;
        if (cli.source_account_id) {
          linha.account_id = cli.source_account_id;
          const { data: a } = await sb.from("accounts").select("process_type").eq("id", cli.source_account_id).maybeSingle();
          linha.segment = segmentoPeloProcesso((a as { process_type?: string | null } | null)?.process_type);
        }
      }
    }
    const { data: ref } = await sb.rpc("next_lead_ref");
    if (!ref) continue;
    const { data: criado, error } = await sb.from("leads").insert({ reference: String(ref), ...linha }).select("id").single();
    if (error || !criado) {
      // Índice único por ticket: outro caminho criou no meio tempo.
      if (!/duplicate|unique/i.test(error?.message ?? "")) linhas.push(`#${t.id}: ERRO ${error?.message ?? "insert"}`);
      continue;
    }
    criados++;
    await registrarEvento(sb, {
      leadId: criado.id as string,
      kind: "created",
      channel: "zendesk",
      toStage: linha.stage as LeadStage,
      summary: `Lead created from Zendesk ticket #${t.id}`,
      payload: { ticket_id: t.id },
      idempotencyKey: `created:zendesk:${t.id}`,
    });
  }
  return { criados, linhas };
}
