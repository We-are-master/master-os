/**
 * Atendimento do WhatsApp de operação (+44 7983 182332). Lê `wa_mensagens` (o
 * webhook grava; src/lib/whatsapp/operacao.ts e uazapi-operacao.ts) dos
 * últimos 60 dias, uma conversa por número, e o estado de cada uma em
 * `inbox_conversas` (resolvida, tags, presença).
 *
 * Quem é quem sai do telefone: parceiro se o número está em `partners`,
 * cliente se está em `clients` e já teve job. O resto (lead, número novo)
 * fica só em All, com a opção de cadastrar. O atendimento daqui é de quem já
 * é cliente ou parceiro; venda e B2B ficam no Zendesk.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { OPS_PHONE_NUMBER_ID, finalDoNumero } from "@/lib/whatsapp/operacao";
import { provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";
import { CaixaAtendimento } from "./caixa-atendimento";
import {
  JOB_FECHADO,
  QUOTE_FECHADA,
  type ConversaDaCaixa,
  type EtapaDaConversa,
  type JobDaCaixa,
  type JobParaOferecer,
  type MensagemDaCaixa,
  type TagDaCaixa,
} from "./tipos";

export const dynamic = "force-dynamic";

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
};

const COLUNAS_JOB =
  "id, reference, title, partner_id, client_id, client_name, scheduled_date, scheduled_start_at, property_address, status, external_ref, partner_name";

const paraJob = (j: LinhaJob): JobDaCaixa => ({
  id: j.id,
  ref: j.reference ?? "Job",
  titulo: j.title,
  data: j.scheduled_date,
  inicio: j.scheduled_start_at,
  endereco: j.property_address,
  ticket: j.external_ref,
  status: j.status ?? "",
  parceiro: j.partner_name,
  cliente: j.client_name,
});

/** Hoje em Londres, AAAA-MM-DD, como `scheduled_date`. */
const hojeEmLondres = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

/** Mesmo número pelos 10 últimos dígitos; a busca larga vai pelos 9. */
function porTelefone<T extends Record<string, unknown>>(linhas: T[], contato: string, campos: (keyof T)[]): T | undefined {
  const fim = finalDoNumero(contato);
  return linhas.find((l) => campos.some((c) => finalDoNumero(l[c]) === fim));
}

export default async function InboxPage() {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const hoje = hojeEmLondres();
  const { data: linhas } = await sb
    .from("wa_mensagens")
    .select("id, wamid, contato, contato_nome, direcao, origem, tipo, texto, midia_id, status, erro, enviado_por_nome, partner_id, criado_em")
    .eq("phone_number_id", OPS_PHONE_NUMBER_ID())
    .gte("criado_em", desde)
    .order("criado_em", { ascending: true })
    .limit(4000);

  // O que a equipe mandou pela tela mora no bucket privado: assina para ver.
  const caminhos = [...new Set((linhas ?? []).map((l) => l.midia_id as string | null).filter((m): m is string => Boolean(m?.startsWith("storage:"))))];
  const assinadas = new Map<string, string>();
  if (caminhos.length) {
    const { data } = await sb.storage.from("inbox-media").createSignedUrls(caminhos.map((c) => c.slice("storage:".length)), 60 * 60 * 12);
    for (const s of data ?? []) if (s.path && s.signedUrl) assinadas.set(`storage:${s.path}`, s.signedUrl);
  }

  const porContato = new Map<string, MensagemDaCaixa[]>();
  const nomeDoPerfil = new Map<string, string>();
  const parceiroDoContato = new Map<string, string>();
  for (const l of linhas ?? []) {
    const contato = l.contato as string;
    if (!porContato.has(contato)) porContato.set(contato, []);
    const midia = (l.midia_id as string | null) ?? null;
    porContato.get(contato)!.push({
      id: l.id as string,
      direcao: l.direcao as MensagemDaCaixa["direcao"],
      origem: l.origem as MensagemDaCaixa["origem"],
      tipo: l.tipo as string,
      texto: (l.texto as string | null) ?? null,
      // A uazapi entrega a mídia por URL; o id da Meta não abre sem token.
      midiaUrl: midia ? (assinadas.get(midia) ?? (/^https?:\/\//.test(midia) ? midia : null)) : null,
      status: (l.status as string | null) ?? null,
      erro: (l.erro as string | null) ?? null,
      quem: (l.enviado_por_nome as string | null) ?? null,
      criadoEm: l.criado_em as string,
    });
    if (l.contato_nome) nomeDoPerfil.set(contato, l.contato_nome as string);
    if (l.partner_id) parceiroDoContato.set(contato, l.partner_id as string);
  }
  const contatos = [...porContato.keys()];

  // Parceiro cadastrado depois da primeira mensagem não tem partner_id na linha: acha pelo telefone.
  const semParceiro = contatos.filter((c) => !parceiroDoContato.has(c) && finalDoNumero(c).length >= 10);
  const filtroTelefone = (campos: string[]) => semParceiro.flatMap((c) => campos.map((f) => `${f}.ilike.%${finalDoNumero(c).slice(-9)}%`)).join(",");
  const [{ data: parceirosPorTelefone }, { data: clientes }, { data: estados, error: semEstado }, { data: tags }] = await Promise.all([
    semParceiro.length
      ? sb.from("partners").select("id, whatsapp, phone").or(filtroTelefone(["whatsapp", "phone"])).limit(200)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    semParceiro.length
      ? sb.from("clients").select("id, full_name, email, phone, address, postcode, source_account_id").is("deleted_at", null).or(filtroTelefone(["phone"])).limit(300)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    contatos.length
      ? sb.from("inbox_conversas").select("contato, resolvida_em, tags, presenca, presenca_em").in("contato", contatos)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    sb.from("inbox_tags").select("nome, cor").order("nome"),
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
  const estadoDoContato = new Map(((estados ?? []) as Record<string, unknown>[]).map((e) => [e.contato as string, e]));

  const idsParceiros = [...new Set(parceiroDoContato.values())];
  const idsClientes = [...new Set([...clienteDoContato.values()].map((c) => c.id as string))];
  const idsContas = [...new Set([...clienteDoContato.values()].map((c) => c.source_account_id as string | null).filter((x): x is string => Boolean(x)))];

  const [{ data: parceiros }, { data: jobsParceiros }, { data: jobsClientes }, { data: quotes }, { data: contas }, { data: semDono }] = await Promise.all([
    idsParceiros.length
      ? sb.from("partners").select("id, contact_name, company_name, trade, email, status").in("id", idsParceiros)
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
    idsContas.length ? sb.from("accounts").select("id, company_name").in("id", idsContas) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    // Jobs sem parceiro, para o "Offer job" de uma conversa de parceiro.
    idsParceiros.length
      ? sb
          .from("jobs")
          .select("id, reference, title, scheduled_date, scheduled_start_at, property_address, client_name, partner_cost, job_type, hourly_partner_rate, scope")
          .is("partner_id", null)
          .is("deleted_at", null)
          .in("status", ["unassigned", "auto_assigning"])
          .order("scheduled_date", { ascending: true, nullsFirst: false })
          .limit(80)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const refsDosClientes = [...new Set(((jobsClientes ?? []) as LinhaJob[]).map((j) => j.reference).filter((r): r is string => Boolean(r)))];
  const { data: faturas } = refsDosClientes.length
    ? await sb
        .from("invoices")
        .select("id, reference, job_reference, amount, amount_paid, status, due_date")
        .in("job_reference", refsDosClientes)
        .order("due_date", { ascending: false })
        .limit(300)
    : { data: [] };

  const parceiroPorId = new Map((parceiros ?? []).map((p) => [p.id as string, p]));
  const nomeDaConta = new Map((contas ?? []).map((a) => [a.id as string, (a.company_name as string | null) ?? "Account"]));

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
        tags: (estado?.tags as string[] | null) ?? [],
        presenca: (estado?.presenca as string | null) ?? null,
        presencaEm: (estado?.presenca_em as string | null) ?? null,
      };

      const pid = parceiroDoContato.get(contato);
      if (pid) {
        const p = parceiroPorId.get(pid);
        const jobs = ((jobsParceiros ?? []) as LinhaJob[]).filter((j) => j.partner_id === pid).map(paraJob);
        return {
          ...base,
          tipo: "parceiro",
          nome: (p?.contact_name as string | null) || (p?.company_name as string | null) || base.perfil || `+${contato}`,
          parceiro: {
            id: pid,
            empresa: (p?.company_name as string | null) ?? null,
            oficio: (p?.trade as string | null) ?? null,
            email: (p?.email as string | null) ?? null,
            status: (p?.status as string | null) ?? null,
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
      const jobsDoCliente = c ? ((jobsClientes ?? []) as LinhaJob[]).filter((j) => j.client_id === c.id).map(paraJob) : [];
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
        tipo: jobsDoCliente.length ? "cliente" : "outro",
        nome: (c?.full_name as string | null) || base.perfil || `+${contato}`,
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
            }
          : null,
        jobs: jobsDoCliente.slice(0, 12),
        jobHoje: jobsDoCliente.find((j) => j.data === hoje && !JOB_FECHADO.has(j.status)) ?? null,
        etapa,
        quotes: quotesDoCliente.slice(0, 12),
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
      custoParceiro: Number.isFinite(custo) && custo > 0 ? custo : null,
      porHora,
      scope: (j.scope as string | null) ?? null,
    };
  });

  // Pela uazapi não há janela de 24h: a caixa sempre deixa escrever.
  return (
    <CaixaAtendimento
      conversas={conversas}
      tags={(tags ?? []) as TagDaCaixa[]}
      paraOferecer={paraOferecer}
      semJanela={provedorDaOperacao() === "uazapi"}
      estadoPronto={!semEstado}
    />
  );
}
