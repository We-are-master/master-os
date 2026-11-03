/**
 * Atendimento do WhatsApp de operação (+44 7983 182332). Lê `wa_mensagens` (o
 * webhook grava; src/lib/whatsapp/operacao.ts e uazapi-operacao.ts) dos
 * últimos 30 dias, uma conversa por número. Cada conversa é de parceiro (o
 * número está em `partners`) ou de cliente (o resto); o cliente é achado pelo
 * telefone em `clients`, com os jobs, cotações e faturas dele ao lado.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { OPS_PHONE_NUMBER_ID, finalDoNumero } from "@/lib/whatsapp/operacao";
import { provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";
import { CaixaAtendimento, type ConversaDaCaixa, type MensagemDaCaixa, type JobDaCaixa } from "./caixa-atendimento";

export const dynamic = "force-dynamic";

const ESTADOS_FECHADOS = ["cancelled", "completed", "closed", "paid", "archived", "deleted", "lost"];

type LinhaJob = {
  id: string;
  reference: string | null;
  title: string | null;
  partner_id: string | null;
  client_id: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  property_address: string | null;
  status: string | null;
  external_ref: string | null;
  partner_name: string | null;
};

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
});

export default async function InboxPage() {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: linhas } = await sb
    .from("wa_mensagens")
    .select("id, wamid, contato, contato_nome, direcao, origem, tipo, texto, midia_id, status, erro, enviado_por_nome, partner_id, criado_em")
    .eq("phone_number_id", OPS_PHONE_NUMBER_ID())
    .gte("criado_em", desde)
    .order("criado_em", { ascending: true })
    .limit(3000);

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
      midiaUrl: midia && /^https?:\/\//.test(midia) ? midia : null,
      status: (l.status as string | null) ?? null,
      erro: (l.erro as string | null) ?? null,
      quem: (l.enviado_por_nome as string | null) ?? null,
      criadoEm: l.criado_em as string,
    });
    if (l.contato_nome) nomeDoPerfil.set(contato, l.contato_nome as string);
    if (l.partner_id) parceiroDoContato.set(contato, l.partner_id as string);
  }

  // Cliente: quem não é parceiro, pelo telefone (os últimos 9 dígitos, como o parceiro).
  const semParceiro = [...porContato.keys()].filter((c) => !parceiroDoContato.has(c) && finalDoNumero(c).length >= 10);
  const { data: clientes } = semParceiro.length
    ? await sb
        .from("clients")
        .select("id, full_name, email, phone, address, postcode, source_account_id")
        .is("deleted_at", null)
        .or(semParceiro.map((c) => `phone.ilike.%${finalDoNumero(c).slice(-9)}%`).join(","))
        .limit(200)
    : { data: [] };
  const clienteDoContato = new Map<string, NonNullable<typeof clientes>[number]>();
  for (const c of semParceiro) {
    const achado = (clientes ?? []).find((x) => finalDoNumero(x.phone) === finalDoNumero(c));
    if (achado) clienteDoContato.set(c, achado);
  }

  const idsParceiros = [...new Set(parceiroDoContato.values())];
  const idsClientes = [...new Set([...clienteDoContato.values()].map((c) => c.id as string))];
  const idsContas = [...new Set([...clienteDoContato.values()].map((c) => c.source_account_id as string | null).filter((x): x is string => Boolean(x)))];
  const hoje = new Date().toISOString().slice(0, 10);
  const COLUNAS_JOB = "id, reference, title, partner_id, client_id, scheduled_date, scheduled_start_at, property_address, status, external_ref, partner_name";

  const [{ data: parceiros }, { data: jobsParceiros }, { data: jobsClientes }, { data: quotes }, { data: contas }] = await Promise.all([
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
          .not("status", "in", `(${ESTADOS_FECHADOS.join(",")})`)
          .order("scheduled_date", { ascending: true })
          .limit(300)
      : Promise.resolve({ data: [] as LinhaJob[] }),
    idsClientes.length
      ? sb.from("jobs").select(COLUNAS_JOB).in("client_id", idsClientes).is("deleted_at", null).order("created_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as LinhaJob[] }),
    idsClientes.length
      ? sb.from("quotes").select("id, reference, title, client_id, status, total_value, created_at").in("client_id", idsClientes).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsContas.length ? sb.from("accounts").select("id, company_name").in("id", idsContas) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
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
      const base = { contato, mensagens, ultimaEntradaEm: ultimaEntrada?.criadoEm ?? null, perfil: nomeDoPerfil.get(contato) ?? null };
      const pid = parceiroDoContato.get(contato);
      if (pid) {
        const p = parceiroPorId.get(pid);
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
          jobs: ((jobsParceiros ?? []) as LinhaJob[]).filter((j) => j.partner_id === pid).slice(0, 8).map(paraJob),
          quotes: [],
          faturas: [],
        };
      }
      const c = clienteDoContato.get(contato);
      const jobsDoCliente = c ? ((jobsClientes ?? []) as LinhaJob[]).filter((j) => j.client_id === c.id) : [];
      const refs = new Set(jobsDoCliente.map((j) => j.reference));
      return {
        ...base,
        tipo: "cliente",
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
        jobs: jobsDoCliente.slice(0, 8).map(paraJob),
        quotes: c
          ? (quotes ?? [])
              .filter((q) => q.client_id === c.id)
              .slice(0, 8)
              .map((q) => ({ id: q.id as string, ref: (q.reference as string | null) ?? "Quote", titulo: (q.title as string | null) ?? null, status: (q.status as string | null) ?? "", total: Number(q.total_value ?? 0) }))
          : [],
        faturas: (faturas ?? [])
          .filter((f) => refs.has(f.job_reference as string))
          .slice(0, 8)
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

  // Pela uazapi não há janela de 24h: a caixa sempre deixa escrever.
  return <CaixaAtendimento conversas={conversas} semJanela={provedorDaOperacao() === "uazapi"} />;
}
