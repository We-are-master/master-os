/**
 * Os dados do Atendimento do WhatsApp de operação (+44 7983 182332). Lê `wa_mensagens` (o
 * webhook grava; src/lib/whatsapp/operacao.ts e uazapi-operacao.ts) dos
 * últimos 60 dias, uma conversa por número, e o estado de cada uma em
 * `inbox_conversas` (resolvida, tags, presença).
 *
 * Quem é quem sai do telefone: parceiro se o número está em `partners`,
 * cliente se está em `clients` e já teve job. O resto (lead, número novo)
 * fica só em All, com a opção de cadastrar. O atendimento daqui é de quem já
 * é cliente ou parceiro; venda e B2B ficam no Zendesk.
 */

import { equipeDaInbox, type MembroDaEquipe } from "@/lib/inbox/equipe";
import { ehGrupo } from "@/lib/inbox/grupo";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarOrganizacoes } from "@/lib/organizacoes/carregar";
import { reconhecerOrganizacao } from "@/lib/organizacoes/reconhecer";
import { OPS_PHONE_NUMBER_ID, filtroDoNumero, finalDoNumero } from "@/lib/whatsapp/operacao";
import { provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";
import {
  JOB_FECHADO,
  QUOTE_FECHADA,
  type ConversaDaCaixa,
  type EtapaDaConversa,
  type JobDaCaixa,
  type JobParaOferecer,
  type LeadDaCaixa,
  type MensagemDaCaixa,
  type TagDaCaixa,
} from "./tipos";

type LinhaJob = {
  id: string;
  reference: string | null;
  title: string | null;
  partner_id: string | null;
  client_id: string | null;
  client_name: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  property_address: string | null;
  status: string | null;
  external_ref: string | null;
  partner_name: string | null;
  scheduled_end_at: string | null;
  external_source: string | null;
  job_type: string | null;
};

const COLUNAS_JOB =
  "id, reference, title, partner_id, client_id, client_name, scheduled_date, scheduled_start_at, scheduled_end_at, property_address, status, external_ref, external_source, partner_name, job_type";

const ORIGEM: Record<string, string> = { housekeep: "Housekeep", checkatrade: "Checkatrade", fantastic: "Fantastic", website: "Website" };

const paraJob = (j: LinhaJob): JobDaCaixa => ({
  id: j.id,
  ref: j.reference ?? "Job",
  titulo: j.title,
  data: j.scheduled_date,
  inicio: j.scheduled_start_at,
  endereco: j.property_address,
  // Só é ticket do Zendesk quando veio de lá; Housekeep e Checkatrade guardam o id deles aqui.
  ticket: j.external_source?.toLowerCase() === "zendesk" ? j.external_ref : null,
  status: j.status ?? "",
  parceiro: j.partner_name,
  cliente: j.client_name,
  fim: j.scheduled_end_at,
  origem: j.external_source ? (ORIGEM[j.external_source.toLowerCase()] ?? j.external_source) : null,
  porHora: j.job_type === "hourly",
});

const SELF_BILL_FECHADO = ["paid", "rejected", "payout_archived"];

/** Hoje em Londres, AAAA-MM-DD, como `scheduled_date`. */
const hojeEmLondres = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
/** Somar dias a um AAAA-MM-DD, ao meio-dia UTC para o fuso não mudar o dia. */
const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Mesmo número pelos 10 últimos dígitos; a busca larga vai pelos 9. */
function porTelefone<T extends Record<string, unknown>>(linhas: T[], contato: string, campos: (keyof T)[]): T | undefined {
  const fim = finalDoNumero(contato);
  return linhas.find((l) => campos.some((c) => finalDoNumero(l[c]) === fim));
}

/**
 * O estado de cada conversa, das colunas mais novas para as mais velhas: migration
 * que ainda não rodou (354 lida/fixada, 355 nome do grupo) não derruba a caixa.
 */
async function estadosDasConversas(sb: ReturnType<typeof createServiceClient>, contatos: string[]) {
  if (!contatos.length) return { data: [] as Record<string, unknown>[], error: null };
  const base = "contato, resolvida_em, arquivada_em, excluida_em, tags, presenca, presenca_em";
  let ultimo: { data: Record<string, unknown>[] | null; error: { message: string } | null } = { data: null, error: null };
  for (const colunas of [`${base}, lida_em, nao_lida, fixada_em, nome, atribuida_a, vinculo_tipo, vinculo_id`, `${base}, lida_em, nao_lida, fixada_em, nome, atribuida_a`, `${base}, lida_em, nao_lida, fixada_em, nome`, `${base}, lida_em, nao_lida, fixada_em`, base]) {
    const r = await sb.from("inbox_conversas").select(colunas).in("contato", contatos);
    ultimo = { data: (r.data ?? null) as Record<string, unknown>[] | null, error: r.error };
    if (!r.error) return ultimo;
  }
  return ultimo;
}

export type DadosDaCaixa = {
  conversas: ConversaDaCaixa[];
  tags: TagDaCaixa[];
  paraOferecer: JobParaOferecer[];
  semJanela: boolean;
  estadoPronto: boolean;
  /** Quem pode assumir conversa: o Workforce ativo com login. */
  equipe: MembroDaEquipe[];
};

/** Monta a caixa inteira: a página /inbox e o painel lateral (/api/inbox/lista) leem daqui. */
export async function carregarCaixa(): Promise<DadosDaCaixa> {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const hoje = hojeEmLondres();
  // Em paralelo com o resto: quem pode assumir conversa.
  const equipeAPromessa = equipeDaInbox(sb);
  const colunasDaMensagem = "id, wamid, contato, contato_nome, direcao, origem, tipo, texto, midia_id, status, erro, enviado_por, enviado_por_nome, partner_id, criado_em, citada:bruto->>quoted, alvo:bruto->>reaction, alvo_chave:bruto->content->key->>id, editado_em:bruto->>editado_em";
  const mensagensDesde = (colunas: string) =>
    sb.from("wa_mensagens").select(colunas).eq("phone_number_id", OPS_PHONE_NUMBER_ID()).gte("criado_em", desde).order("criado_em", { ascending: true }).limit(4000);
  // Sem a 355 aplicada não há autor: a caixa carrega igual, só sem o nome de quem falou no grupo.
  const comAutor = await mensagensDesde(`${colunasDaMensagem}, autor, autor_nome`);
  const linhas = ((comAutor.error ? (await mensagensDesde(colunasDaMensagem)).data : comAutor.data) ?? []) as unknown as Record<string, unknown>[];

  // O que a equipe mandou pela tela mora no bucket privado: assina para ver.
  const caminhos = [...new Set((linhas ?? []).map((l) => l.midia_id as string | null).filter((m): m is string => Boolean(m?.startsWith("storage:"))))];
  const assinadas = new Map<string, string>();
  if (caminhos.length) {
    const { data } = await sb.storage.from("inbox-media").createSignedUrls(caminhos.map((c) => c.slice("storage:".length)), 60 * 60 * 12);
    for (const s of data ?? []) if (s.path && s.signedUrl) assinadas.set(`storage:${s.path}`, s.signedUrl);
  }

  // A foto de quem da equipe mandou, para o avatar no balão de saída.
  const idsDeQuemMandou = [...new Set(linhas.map((l) => l.enviado_por as string | null).filter((x): x is string => Boolean(x)))];
  const fotoDe = new Map<string, string | null>();
  if (idsDeQuemMandou.length) {
    const { data } = await sb.from("profiles").select("id, avatar_url").in("id", idsDeQuemMandou);
    for (const p of data ?? []) fotoDe.set(p.id as string, (p.avatar_url as string | null) ?? null);
  }

  // Reação não é balão: guarda à parte (por alvo) e pendura na mensagem depois.
  const reacoesBrutas: { alvo: string; emoji: string | null; deNos: boolean; quem: string | null; chave: string }[] = [];
  const porContato = new Map<string, MensagemDaCaixa[]>();
  const nomeDoPerfil = new Map<string, string>();
  const parceiroDoContato = new Map<string, string>();
  for (const l of linhas ?? []) {
    const contato = l.contato as string;
    if (l.tipo === "reaction") {
      const alvo = (l.alvo as string | null) || (l.alvo_chave as string | null);
      const deNos = l.direcao === "saida";
      const quem = deNos ? ((l.enviado_por_nome as string | null) ?? null) : ((l.autor_nome as string | null) ?? (l.contato_nome as string | null) ?? null);
      if (alvo) reacoesBrutas.push({ alvo, emoji: (l.texto as string | null) ?? null, deNos, quem, chave: deNos ? "nos" : `${(l.autor as string | null) ?? contato}` });
      continue;
    }
    if (!porContato.has(contato)) porContato.set(contato, []);
    const midia = (l.midia_id as string | null) ?? null;
    porContato.get(contato)!.push({
      id: l.id as string,
      direcao: l.direcao as MensagemDaCaixa["direcao"],
      origem: l.origem as MensagemDaCaixa["origem"],
      tipo: l.tipo as string,
      texto: (l.texto as string | null) ?? null,
      // Mídia ainda no link da uazapi passa pela nossa rota: ela copia para o
      // bucket e redireciona (o domínio da uazapi é bloqueado em algumas redes).
      midiaUrl: midia ? (assinadas.get(midia) ?? (/^https?:\/\//.test(midia) ? `/api/inbox/midia/${l.id as string}` : null)) : null,
      status: (l.status as string | null) ?? null,
      erro: (l.erro as string | null) ?? null,
      quem: (l.enviado_por_nome as string | null) ?? null,
      quemAvatar: l.enviado_por ? (fotoDe.get(l.enviado_por as string) ?? null) : null,
      criadoEm: l.criado_em as string,
      autor: ehGrupo(contato) && l.direcao === "entrada" ? { numero: (l.autor as string | null) ?? null, nome: (l.autor_nome as string | null) ?? null } : null,
      wamid: (l.wamid as string | null) ?? null,
      // Por enquanto o wamid da citada; vira a mensagem logo abaixo, quando ela está na conversa.
      citada: l.citada ? { id: l.citada as string, texto: "", deNos: false, quem: null } : null,
      editadaEm: (l.editado_em as string | null) ?? null,
    });
    if (l.contato_nome) nomeDoPerfil.set(contato, l.contato_nome as string);
    if (l.partner_id) parceiroDoContato.set(contato, l.partner_id as string);
  }
  // Citadas e reações acham a mensagem pelo wamid (a uazapi às vezes manda "dono:id").
  const semDonoDoId = (w: string) => w.split(":").pop()!;
  const porWamid = new Map<string, MensagemDaCaixa>();
  for (const lista of porContato.values()) for (const m of lista) if (m.wamid) porWamid.set(semDonoDoId(m.wamid), m);
  for (const lista of porContato.values())
    for (const m of lista) {
      if (!m.citada) continue;
      const c = porWamid.get(semDonoDoId(m.citada.id));
      m.citada = c ? { id: c.id, texto: c.texto ?? `[${c.tipo}]`, deNos: c.direcao === "saida", quem: c.direcao === "saida" ? c.quem : (c.autor?.nome ?? null) } : null;
    }
  // A última reação de cada pessoa vale (as linhas já vêm em ordem); emoji vazio tira.
  const ultimaReacao = new Map<string, (typeof reacoesBrutas)[number]>();
  for (const r of reacoesBrutas) ultimaReacao.set(`${semDonoDoId(r.alvo)}|${r.chave}`, r);
  for (const r of ultimaReacao.values()) {
    const m = porWamid.get(semDonoDoId(r.alvo));
    if (!m || !r.emoji) continue;
    (m.reacoes ??= []).push({ emoji: r.emoji, deNos: r.deNos, quem: r.quem });
  }
  const contatos = [...porContato.keys()];

  // Parceiro cadastrado depois da primeira mensagem não tem partner_id na linha: acha pelo telefone.
  const semParceiro = contatos.filter((c) => !ehGrupo(c) && !parceiroDoContato.has(c) && finalDoNumero(c).length >= 10);
  const filtroTelefone = (campos: string[]) => semParceiro.flatMap((c) => campos.map((f) => filtroDoNumero(f, c))).join(",");
  const [{ data: parceirosPorTelefone }, { data: clientes }, { data: estados, error: semEstado }, { data: tags }, { data: contasPorTelefone }] = await Promise.all([
    semParceiro.length
      ? sb.from("partners").select("id, whatsapp, phone").or(filtroTelefone(["whatsapp", "phone"])).limit(200)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    semParceiro.length
      ? sb.from("clients").select("id, full_name, email, phone, address, postcode, source_account_id, source").is("deleted_at", null).or(filtroTelefone(["phone"])).limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    estadosDasConversas(sb, contatos),
    sb.from("inbox_tags").select("nome, cor").order("nome"),
    // O número da conta (accounts.contact_number): quem escreve dele é a conta, mesmo sem cliente.
    semParceiro.length
      ? sb.from("accounts").select("id, contact_number").or(filtroTelefone(["contact_number"])).limit(100)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  if (semEstado) console.error("[inbox] inbox_conversas", semEstado.message);

  for (const c of semParceiro) {
    const p = porTelefone((parceirosPorTelefone ?? []) as Record<string, unknown>[], c, ["whatsapp", "phone"]);
    if (p) parceiroDoContato.set(c, p.id as string);
  }
  const clienteDoContato = new Map<string, Record<string, unknown>>();
  for (const c of semParceiro) {
    if (parceiroDoContato.has(c)) continue;
    const achado = porTelefone((clientes ?? []) as Record<string, unknown>[], c, ["phone"]);
    if (achado) clienteDoContato.set(c, achado);
  }
  /** A conta de cada contato: a do cliente (source_account_id), senão a do número da conta. */
  const contaDoContato = new Map<string, string>();
  /**
   * Aba Accounts (dono, 10/11/2026): o contato da conta, não o cliente dela. É o número da própria
   * conta (accounts.contact_number), o ligado à mão como conta, ou o cliente cujo e-mail é do
   * domínio da conta dele (Michelle @kvadrat). Morador de uma conta (Housekeep, Fixfy) fica em Clients.
   */
  const numeroDaConta = new Set<string>();
  for (const c of semParceiro) {
    if (parceiroDoContato.has(c)) continue;
    const doCliente = clienteDoContato.get(c)?.source_account_id as string | null | undefined;
    const pelaConta = porTelefone((contasPorTelefone ?? []) as Record<string, unknown>[], c, ["contact_number"])?.id as string | undefined;
    // O número é o da própria conta: ela vence a conta de origem do cliente (Mohsen Sayahi, 10/11/2026).
    const id = pelaConta ?? doCliente;
    if (id) contaDoContato.set(c, id);
    if (pelaConta) numeroDaConta.add(c);
  }
  // Número ligado à mão (355): vale mais que o telefone do cadastro.
  const vinculos = ((estados ?? []) as Record<string, unknown>[]).filter((e) => e.vinculo_tipo && e.vinculo_id && !ehGrupo(e.contato as string));
  const idsClientesLigados = vinculos.filter((v) => v.vinculo_tipo === "cliente").map((v) => v.vinculo_id as string);
  const clientesLigados = idsClientesLigados.length
    ? (((await sb.from("clients").select("id, full_name, email, phone, address, postcode, source_account_id, source").in("id", idsClientesLigados)).data ?? []) as Record<string, unknown>[])
    : [];
  for (const v of vinculos) {
    const c = v.contato as string;
    const id = v.vinculo_id as string;
    if (v.vinculo_tipo === "parceiro") {
      parceiroDoContato.set(c, id);
      clienteDoContato.delete(c);
      contaDoContato.delete(c);
      numeroDaConta.delete(c);
    } else if (v.vinculo_tipo === "cliente") {
      const cl = clientesLigados.find((x) => x.id === id);
      if (!cl) continue;
      parceiroDoContato.delete(c);
      numeroDaConta.delete(c);
      clienteDoContato.set(c, cl);
      if (cl.source_account_id) contaDoContato.set(c, cl.source_account_id as string);
      else contaDoContato.delete(c);
    } else if (v.vinculo_tipo === "conta") {
      parceiroDoContato.delete(c);
      clienteDoContato.delete(c);
      contaDoContato.set(c, id);
      numeroDaConta.add(c);
    }
  }
  // Contas que escreveram sem um cliente por trás: os jobs vêm da conta (jobs.account_id).
  // Cliente com e-mail do domínio da própria conta é contato dela (e-mail pessoal nunca prova).
  const organizacoes = await carregarOrganizacoes(sb).catch(() => []);
  for (const [c, cl] of clienteDoContato) {
    const conta = cl.source_account_id as string | null | undefined;
    if (!conta || numeroDaConta.has(c)) continue;
    const r = reconhecerOrganizacao(cl.email as string | null, organizacoes);
    if (r.tipo === "organizacao" && r.id === conta) numeroDaConta.add(c);
  }
  const idsContasDiretas = [...new Set([...contaDoContato.entries()].filter(([c]) => !clienteDoContato.has(c)).map(([, id]) => id))];
  const estadoDoContato = new Map(((estados ?? []) as Record<string, unknown>[]).map((e) => [e.contato as string, e]));

  const idsParceiros = [...new Set(parceiroDoContato.values())];
  const idsClientes = [...new Set([...clienteDoContato.values()].map((c) => c.id as string))];
  const idsContas = [...new Set(contaDoContato.values())];

  // A semana de cada parceiro (segunda a domingo, Londres): o planejado do self-bill sai do custo destes jobs.
  const segunda = somarDias(hoje, -((new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7));
  const jobsDaSemana = idsParceiros.length
    ? Promise.resolve(
        sb
          .from("jobs")
          .select("partner_id, partner_cost, scheduled_date, status")
          .in("partner_id", idsParceiros)
          .gte("scheduled_date", somarDias(segunda, -14))
          .lte("scheduled_date", somarDias(segunda, 13))
          .is("deleted_at", null)
          .neq("status", "cancelled")
          .limit(1000),
      )
    : null;
  // O ticket de ligações (355). Sem a coluna ainda, vem erro e o Call cai na busca por telefone.
  const ticketsDeLigacao = idsParceiros.length
    ? Promise.resolve(sb.from("partners").select("id, zendesk_ticket_id").in("id", idsParceiros).not("zendesk_ticket_id", "is", null))
    : null;
  const [{ data: parceiros }, { data: jobsParceiros }, { data: jobsClientes }, { data: quotes }, { data: contas }, { data: semDono }, { data: jobsContas }] = await Promise.all([
    idsParceiros.length
      ? sb.from("partners").select("id, contact_name, company_name, avatar_url, trade, email, status, rating, jobs_completed, coverage_base_postcode, included_postcodes, trades, coverage_mode, service_radius_miles, uk_coverage_regions, coverage_cities").in("id", idsParceiros)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsParceiros.length
      ? sb
          .from("jobs")
          .select(COLUNAS_JOB)
          .in("partner_id", idsParceiros)
          .gte("scheduled_date", hoje)
          .is("deleted_at", null)
          .not("status", "in", `(${[...JOB_FECHADO].join(",")})`)
          .order("scheduled_date", { ascending: true })
          .limit(400)
      : Promise.resolve({ data: [] as LinhaJob[] }),
    idsClientes.length
      ? sb.from("jobs").select(COLUNAS_JOB).in("client_id", idsClientes).is("deleted_at", null).order("created_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] as LinhaJob[] }),
    idsClientes.length
      ? sb.from("quotes").select("id, reference, title, client_id, status, total_value, created_at").in("client_id", idsClientes).order("created_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsContas.length ? sb.from("accounts").select("id, company_name, contact_name, logo_url").in("id", idsContas) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    // Jobs sem parceiro, para o "Offer job" de uma conversa de parceiro.
    idsParceiros.length
      ? sb
          .from("jobs")
          .select("id, reference, title, status, scheduled_date, scheduled_start_at, property_address, client_name, partner_cost, job_type, hourly_partner_rate, scope")
          .is("partner_id", null)
          .is("deleted_at", null)
          // Sem parceiro e com data: Unassigned e Finding partner. On hold e rascunho ficam de fora.
          .in("status", ["unassigned", "auto_assigning"])
          .not("scheduled_date", "is", null)
          .order("scheduled_date", { ascending: true, nullsFirst: false })
          .limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsContasDiretas.length
      ? sb.from("jobs").select(`${COLUNAS_JOB}, account_id`).in("account_id", idsContasDiretas).is("deleted_at", null).order("created_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] as (LinhaJob & { account_id: string })[] }),
  ]);

  // O card no CRM (06/11/2026): pelo cliente; contato sem cadastro, pelo telefone (só os abertos).
  const leadPorCliente = new Map<string, LeadDaCaixa>();
  const leadPorTelefone = new Map<string, LeadDaCaixa>();
  {
    const ABERTOS = ["new", "qualified", "quoting", "quoted"];
    const [porCliente, porFone] = await Promise.all([
      idsClientes.length
        ? sb.from("leads").select("id, reference, stage, client_id, created_at").in("client_id", idsClientes).is("deleted_at", null).order("created_at", { ascending: false }).limit(600)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      sb.from("leads").select("id, reference, stage, phone, created_at").in("stage", ABERTOS).not("phone", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(1000),
    ]);
    const paraLead = (l: Record<string, unknown>): LeadDaCaixa => ({ id: l.id as string, ref: (l.reference as string | null) ?? null, stage: String(l.stage ?? "new") });
    for (const l of (porCliente.data ?? []) as Record<string, unknown>[]) {
      const cid = l.client_id as string;
      const ja = leadPorCliente.get(cid);
      // O aberto mais novo vence; sem aberto, o mais novo de todos.
      if (!ja || (!ABERTOS.includes(ja.stage) && ABERTOS.includes(String(l.stage)))) leadPorCliente.set(cid, paraLead(l));
    }
    const contatoPeloFinal = new Map(contatos.map((c) => [finalDoNumero(c), c]));
    for (const l of (porFone.data ?? []) as Record<string, unknown>[]) {
      const contato = contatoPeloFinal.get(finalDoNumero(String(l.phone ?? "").replace(/\D/g, "")));
      if (contato && !leadPorTelefone.has(contato)) leadPorTelefone.set(contato, paraLead(l));
    }
  }

  const refsDosClientes = [...new Set([...((jobsClientes ?? []) as LinhaJob[]), ...((jobsContas ?? []) as LinhaJob[])].map((j) => j.reference).filter((r): r is string => Boolean(r)))];
  const { data: faturas } = refsDosClientes.length
    ? await sb
        .from("invoices")
        .select("id, reference, job_reference, amount, amount_paid, status, due_date")
        .in("job_reference", refsDosClientes)
        .order("due_date", { ascending: false })
        .limit(300)
    : { data: [] };

  // O que a gaveta do parceiro mostra: documentos, relatórios que faltam e o self-bill em aberto.
  const [{ data: documentos }, { data: semRelatorio }, { data: selfBills }] = await Promise.all([
    idsParceiros.length
      ? sb.from("partner_documents").select("id, partner_id, name, doc_type, status, expires_at").in("partner_id", idsParceiros).order("expires_at", { ascending: true }).limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsParceiros.length
      ? sb
          .from("jobs")
          .select("id, reference, partner_id")
          .in("partner_id", idsParceiros)
          // Só job ainda aberto: o que já fechou (completed) não se cobra mais.
          .in("status", ["final_check", "awaiting_payment"])
          .eq("report_submitted", false)
          .is("deleted_at", null)
          .gte("scheduled_date", desde.slice(0, 10))
          .limit(200)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsParceiros.length
      ? sb
          .from("self_bills")
          .select("id, reference, partner_id, net_payout, jobs_count, due_date, status, week_label, created_at, email_sent_at, week_start, week_end")
          .in("partner_id", idsParceiros)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const parceiroPorId = new Map((parceiros ?? []).map((p) => [p.id as string, p]));
  const semana = ((jobsDaSemana ? (await jobsDaSemana).data : null) ?? []) as Record<string, unknown>[];
  const ticketDoParceiro = new Map<string, string>();
  const tk = ticketsDeLigacao ? await ticketsDeLigacao : null;
  if (tk && !tk.error) for (const t of (tk.data ?? []) as Record<string, unknown>[]) ticketDoParceiro.set(t.id as string, String(t.zendesk_ticket_id));
  const nomeDaConta = new Map((contas ?? []).map((a) => [a.id as string, (a.company_name as string | null) ?? "Account"]));
  const logoDaConta = new Map((contas ?? []).map((a) => [a.id as string, (a.logo_url as string | null) ?? null]));
  const pessoaDaConta = new Map((contas ?? []).map((a) => [a.id as string, (a.contact_name as string | null) ?? null]));

  const conversas: ConversaDaCaixa[] = [...porContato.entries()]
    .map(([contato, mensagens]): ConversaDaCaixa => {
      const ultimaEntrada = [...mensagens].reverse().find((m) => m.direcao === "entrada");
      const estado = estadoDoContato.get(contato);
      const base = {
        contato,
        mensagens,
        ultimaEntradaEm: ultimaEntrada?.criadoEm ?? null,
        perfil: nomeDoPerfil.get(contato) ?? null,
        resolvidaEm: (estado?.resolvida_em as string | null) ?? null,
        arquivadaEm: (estado?.arquivada_em as string | null) ?? null,
        excluidaEm: (estado?.excluida_em as string | null) ?? null,
        tags: (estado?.tags as string[] | null) ?? [],
        presenca: (estado?.presenca as string | null) ?? null,
        presencaEm: (estado?.presenca_em as string | null) ?? null,
        lidaEm: (estado?.lida_em as string | null) ?? null,
        naoLida: Boolean(estado?.nao_lida),
        fixadaEm: (estado?.fixada_em as string | null) ?? null,
        atribuidaA: (estado?.atribuida_a as string | null) ?? null,
        org: null as ConversaDaCaixa["org"],
      };

      if (ehGrupo(contato)) {
        return {
          ...base,
          tipo: "grupo",
          nome: (estado?.nome as string | null) || "WhatsApp group",
          parceiro: null,
          cliente: null,
          jobs: [],
          jobHoje: null,
          etapa: null,
          quotes: [],
          faturas: [],
        };
      }

      const pid = parceiroDoContato.get(contato);
      if (pid) {
        const p = parceiroPorId.get(pid);
        const jobs = ((jobsParceiros ?? []) as LinhaJob[]).filter((j) => j.partner_id === pid).map(paraJob);
        return {
          ...base,
          tipo: "parceiro",
          org: p?.company_name ? { nome: p.company_name as string, logo: (p.avatar_url as string | null) ?? null } : null,
          // Parceiro aparece sempre pelo nome da empresa; a pessoa só se não houver empresa.
          nome: (p?.company_name as string | null) || (p?.contact_name as string | null) || base.perfil || `+${contato}`,
          parceiro: {
            id: pid,
            empresa: (p?.company_name as string | null) ?? null,
            oficio: (p?.trade as string | null) ?? null,
            email: (p?.email as string | null) ?? null,
            status: (p?.status as string | null) ?? null,
            nota: Number(p?.rating) > 0 ? Number(p?.rating) : null,
            jobsFeitos: Number(p?.jobs_completed ?? 0),
            area:
              ((p?.included_postcodes as string[] | null) ?? []).slice(0, 4).join(", ") || ((p?.coverage_base_postcode as string | null) ?? null),
            documentos: (documentos ?? [])
              .filter((d) => d.partner_id === pid)
              .map((d) => ({
                id: d.id as string,
                nome: (d.name as string | null) ?? "Document",
                tipo: (d.doc_type as string | null) ?? null,
                status: (d.status as string | null) ?? null,
                expira: (d.expires_at as string | null) ?? null,
              })),
            semRelatorio: (semRelatorio ?? []).filter((j) => j.partner_id === pid).map((j) => ({ id: j.id as string, ref: (j.reference as string | null) ?? "Job" })),
            ...(() => {
              const meus = (selfBills ?? []).filter((x) => x.partner_id === pid).map((b) => ({
                id: b.id as string,
                ref: (b.reference as string | null) ?? "Self-bill",
                valor: Number(b.net_payout ?? 0),
                jobs: Number(b.jobs_count ?? 0),
                vence: (b.due_date as string | null) ?? null,
                status: (b.status as string | null) ?? "",
                semana: (b.week_label as string | null) ?? null,
                enviadoEm: (b.email_sent_at as string | null) ?? null,
              }));
              // O próximo self-bill a pagar: o em aberto com o vencimento mais perto (de hoje em diante);
              // sem nenhum, o do período que cobre hoje; sem esse, segunda a domingo desta semana.
              const abertos = (selfBills ?? []).filter(
                (x) => x.partner_id === pid && !SELF_BILL_FECHADO.includes(x.status as string) && x.status !== "payout_cancelled" && x.week_start && x.week_end,
              );
              const doPeriodo =
                abertos.filter((x) => ((x.due_date as string | null) ?? "") >= hoje).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] ??
                abertos.find((x) => (x.week_start as string) <= hoje && hoje <= (x.week_end as string));
              const de = (doPeriodo?.week_start as string | undefined) ?? segunda;
              const ate = (doPeriodo?.week_end as string | undefined) ?? somarDias(segunda, 6);
              const planejado = semana
                .filter((j) => j.partner_id === pid && (j.scheduled_date as string) >= de && (j.scheduled_date as string) <= ate)
                .reduce((t, j) => t + (Number(j.partner_cost) || 0), 0);
              return {
                selfBill: meus.find((b) => !SELF_BILL_FECHADO.includes(b.status)) ?? null,
                selfBills: meus.slice(0, 6),
                estaSemana: {
                  planejado,
                  confirmado: doPeriodo ? Number(doPeriodo.net_payout ?? 0) : 0,
                  pagamento: (doPeriodo?.due_date as string | null) ?? null,
                  ref: (doPeriodo?.reference as string | null) ?? null,
                  de,
                  ate,
                },
              };
            })(),
            oficios: [...new Set([p?.trade as string | null, ...((p?.trades as string[] | null) ?? [])].filter((t): t is string => !!t))],
            cobertura: {
              modo: (p?.coverage_mode as string | null) ?? null,
              raioMilhas: (p?.service_radius_miles as number | null) ?? null,
              base: (p?.coverage_base_postcode as string | null) ?? null,
              postcodes: (p?.included_postcodes as string[] | null) ?? [],
              regioes: (p?.uk_coverage_regions as string[] | null) ?? [],
              cidades: (p?.coverage_cities as string[] | null) ?? [],
            },
            ticketDeLigacao: ticketDoParceiro.get(pid) ?? null,
          },
          cliente: null,
          jobs: jobs.slice(0, 12),
          jobHoje: jobs.find((j) => j.data === hoje) ?? null,
          etapa: null,
          quotes: [],
          faturas: [],
        };
      }

      const c = clienteDoContato.get(contato);
      const contaId = contaDoContato.get(contato) ?? null;
      const jobsDoCliente = c
        ? ((jobsClientes ?? []) as LinhaJob[]).filter((j) => j.client_id === c.id).map(paraJob)
        : contaId
          ? ((jobsContas ?? []) as (LinhaJob & { account_id: string })[]).filter((j) => j.account_id === contaId).map(paraJob)
          : [];
      const leadDoContato = (c ? leadPorCliente.get(c.id as string) : null) ?? leadPorTelefone.get(contato) ?? null;
      const quotesDoCliente = c
        ? (quotes ?? [])
            .filter((q) => q.client_id === c.id)
            .map((q) => ({ id: q.id as string, ref: (q.reference as string | null) ?? "Quote", titulo: (q.title as string | null) ?? null, status: (q.status as string | null) ?? "", total: Number(q.total_value ?? 0) }))
        : [];
      // A etapa é a do trabalho em aberto: job vivo, senão cotação viva, senão o último job.
      const jobVivo = jobsDoCliente.find((j) => !JOB_FECHADO.has(j.status));
      const quoteViva = quotesDoCliente.find((q) => !QUOTE_FECHADA.has(q.status));
      const etapa: EtapaDaConversa | null = jobVivo
        ? { grupo: "job", status: jobVivo.status, ref: jobVivo.ref, id: jobVivo.id }
        : quoteViva
          ? { grupo: "quote", status: quoteViva.status, ref: quoteViva.ref, id: quoteViva.id }
          : jobsDoCliente[0]
            ? { grupo: "job", status: jobsDoCliente[0].status, ref: jobsDoCliente[0].ref, id: jobsDoCliente[0].id }
            : null;
      const refs = new Set(jobsDoCliente.map((j) => j.ref));
      return {
        ...base,
        tipo: contaId && numeroDaConta.has(contato) ? "conta" : jobsDoCliente.length || estado?.vinculo_tipo === "cliente" ? "cliente" : "outro",
        org: contaId ? { nome: nomeDaConta.get(contaId) ?? "Account", logo: logoDaConta.get(contaId) ?? null } : null,
        // O nome dado à mão na caixa (ou o do lead ligado) vence o do cadastro.
        nome:
          (estado?.nome as string | null) ||
          (c?.full_name as string | null) ||
          (contaId && !c ? pessoaDaConta.get(contaId) : null) ||
          base.perfil ||
          `+${contato}`,
        parceiro: null,
        cliente: c
          ? {
              id: c.id as string,
              nome: (c.full_name as string | null) ?? "",
              email: (c.email as string | null) ?? null,
              endereco: (c.address as string | null) ?? null,
              postcode: (c.postcode as string | null) ?? null,
              contaId: (c.source_account_id as string | null) ?? null,
              conta: c.source_account_id ? nomeDaConta.get(c.source_account_id as string) ?? null : null,
              origem: (c.source as string | null) ?? null,
            }
          : null,
        jobs: jobsDoCliente.slice(0, 12),
        jobHoje: jobsDoCliente.find((j) => j.data === hoje && !JOB_FECHADO.has(j.status)) ?? null,
        etapa,
        quotes: quotesDoCliente.slice(0, 12),
        lead: leadDoContato,
        faturas: (faturas ?? [])
          .filter((f) => refs.has(f.job_reference as string))
          .slice(0, 12)
          .map((f) => ({
            id: f.id as string,
            ref: (f.reference as string | null) ?? "Invoice",
            job: (f.job_reference as string | null) ?? null,
            status: (f.status as string | null) ?? "",
            valor: Number(f.amount ?? 0),
            pago: Number(f.amount_paid ?? 0),
          })),
      };
    })
    .sort((a, b) => b.mensagens[b.mensagens.length - 1].criadoEm.localeCompare(a.mensagens[a.mensagens.length - 1].criadoEm));

  const paraOferecer: JobParaOferecer[] = (semDono ?? []).map((j) => {
    const porHora = j.job_type === "hourly";
    const custo = Number(porHora ? j.hourly_partner_rate : j.partner_cost);
    return {
      id: j.id as string,
      ref: (j.reference as string | null) ?? "Job",
      titulo: (j.title as string | null) ?? null,
      data: (j.scheduled_date as string | null) ?? null,
      inicio: (j.scheduled_start_at as string | null) ?? null,
      endereco: (j.property_address as string | null) ?? null,
      cliente: (j.client_name as string | null) ?? null,
      status: (j.status as string | null) ?? "",
      custoParceiro: Number.isFinite(custo) && custo > 0 ? custo : null,
      porHora,
      scope: (j.scope as string | null) ?? null,
    };
  });

  const equipe = await equipeAPromessa;
  // Pela uazapi não há janela de 24h: a caixa sempre deixa escrever.
  return {
    conversas,
    tags: (tags ?? []) as TagDaCaixa[],
    paraOferecer,
    semJanela: provedorDaOperacao() === "uazapi",
    estadoPronto: !semEstado,
    equipe,
  };
}
