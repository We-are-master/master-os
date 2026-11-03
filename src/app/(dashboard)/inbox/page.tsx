/**
 * Atendimento do WhatsApp de operação (+44 7983 182332): parceiros e equipe.
 * Lê `wa_mensagens` (o webhook grava; src/lib/whatsapp/operacao.ts) dos
 * últimos 30 dias, uma conversa por número, com o parceiro e os próximos jobs
 * dele ao lado. Só existe o que chegou depois da ligação do 7983 ao OS.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { OPS_PHONE_NUMBER_ID } from "@/lib/whatsapp/operacao";
import { CaixaAtendimento, type ConversaDaCaixa, type MensagemDaCaixa } from "./caixa-atendimento";

export const dynamic = "force-dynamic";

const ESTADOS_FECHADOS = ["cancelled", "completed", "closed", "paid", "archived", "deleted", "lost"];

export default async function InboxPage() {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: linhas } = await sb
    .from("wa_mensagens")
    .select("id, wamid, contato, contato_nome, direcao, origem, tipo, texto, status, erro, enviado_por_nome, partner_id, criado_em")
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
    porContato.get(contato)!.push({
      id: l.id as string,
      direcao: l.direcao as MensagemDaCaixa["direcao"],
      origem: l.origem as MensagemDaCaixa["origem"],
      tipo: l.tipo as string,
      texto: (l.texto as string | null) ?? null,
      status: (l.status as string | null) ?? null,
      erro: (l.erro as string | null) ?? null,
      quem: (l.enviado_por_nome as string | null) ?? null,
      criadoEm: l.criado_em as string,
    });
    if (l.contato_nome) nomeDoPerfil.set(contato, l.contato_nome as string);
    if (l.partner_id) parceiroDoContato.set(contato, l.partner_id as string);
  }

  const idsParceiros = [...new Set(parceiroDoContato.values())];
  const hoje = new Date().toISOString().slice(0, 10);
  const [{ data: parceiros }, { data: jobs }] = idsParceiros.length
    ? await Promise.all([
        sb.from("partners").select("id, contact_name, company_name, trade").in("id", idsParceiros),
        sb
          .from("jobs")
          .select("id, reference, title, partner_id, scheduled_date, scheduled_start_at, property_address, status, external_ref")
          .in("partner_id", idsParceiros)
          .gte("scheduled_date", hoje)
          .is("deleted_at", null)
          .not("status", "in", `(${ESTADOS_FECHADOS.join(",")})`)
          .order("scheduled_date", { ascending: true })
          .limit(300),
      ])
    : [{ data: [] }, { data: [] }];

  const parceiroPorId = new Map((parceiros ?? []).map((p) => [p.id as string, p]));
  const conversas: ConversaDaCaixa[] = [...porContato.entries()]
    .map(([contato, mensagens]) => {
      const pid = parceiroDoContato.get(contato) ?? null;
      const p = pid ? parceiroPorId.get(pid) : undefined;
      const ultimaEntrada = [...mensagens].reverse().find((m) => m.direcao === "entrada");
      return {
        contato,
        nome: (p?.contact_name as string | null) || (p?.company_name as string | null) || nomeDoPerfil.get(contato) || `+${contato}`,
        empresa: (p?.company_name as string | null) ?? null,
        oficio: (p?.trade as string | null) ?? null,
        partnerId: pid,
        ultimaEntradaEm: ultimaEntrada?.criadoEm ?? null,
        mensagens,
        jobs: (jobs ?? [])
          .filter((j) => j.partner_id === pid)
          .slice(0, 5)
          .map((j) => ({
            id: j.id as string,
            ref: (j.reference as string | null) ?? "Job",
            titulo: (j.title as string | null) ?? null,
            data: j.scheduled_date as string,
            inicio: (j.scheduled_start_at as string | null) ?? null,
            endereco: (j.property_address as string | null) ?? null,
            ticket: (j.external_ref as string | null) ?? null,
          })),
      };
    })
    .sort((a, b) => b.mensagens[b.mensagens.length - 1].criadoEm.localeCompare(a.mensagens[a.mensagens.length - 1].criadoEm));

  return <CaixaAtendimento conversas={conversas} />;
}
