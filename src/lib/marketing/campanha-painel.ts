/**
 * O que o painel ao vivo mostra, num objeto só. A página pede de 5 em 5
 * segundos, então tudo aqui é agregação barata sobre a fila da campanha (uns
 * seis mil registros) e sobre os toques dela.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { saudeDoNumero } from "@/lib/whatsapp/cloud";
import { normalizarEmail } from "./suppressions";
import { WEEK10 } from "./week10-copy";

type Linha = {
  id: string;
  client_id: string | null;
  grupo: string;
  canal: string;
  passo: string;
  status: string;
  email: string | null;
  phone: string | null;
  primeiro_nome: string;
  agendado_para: string | null;
  reservado_em: string | null;
  enviado_em: string | null;
  provider_id: string | null;
  erro: string | null;
  custo_estimado: number | null;
};

let saudeCache: { em: number; valor: { qualidade: string; limite: string | null } | null } = { em: 0, valor: null };
async function saude() {
  if (Date.now() - saudeCache.em < 60_000) return saudeCache.valor;
  try {
    saudeCache = { em: Date.now(), valor: await saudeDoNumero() };
  } catch {
    saudeCache = { em: Date.now(), valor: null };
  }
  return saudeCache.valor;
}

function mascarar(l: Linha): string {
  if (l.email) {
    const [u, d] = l.email.split("@");
    return `${u.slice(0, 2)}…@${d}`;
  }
  return l.phone ? `+${l.phone.slice(0, 4)}…${l.phone.slice(-3)}` : "";
}

export async function painelDaCampanha(campanha = WEEK10.campanha) {
  const sb = createServiceClient();

  const linhas: Linha[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb
      .from("marketing_queue")
      .select("id, client_id, grupo, canal, passo, status, email, phone, primeiro_nome, agendado_para, reservado_em, enviado_em, provider_id, erro, custo_estimado")
      .eq("campanha", campanha)
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as Linha[]));
    if ((data ?? []).length < 1000) break;
  }

  const inicio = linhas.reduce<string | null>((m, l) => (l.enviado_em && (!m || l.enviado_em < m) ? l.enviado_em : m), null);

  // Toques da campanha (entrega, abertura, clique, resposta, rejeição).
  const toques: Array<{ campaign: string; channel: string; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; replied_at: string | null; bounced_at: string | null; complained_at: string | null }> = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb
      .from("marketing_touches")
      .select("campaign, channel, delivered_at, opened_at, clicked_at, replied_at, bounced_at, complained_at")
      .like("campaign", `${campanha}:%`)
      .range(de, de + 999);
    toques.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const PASSOS = ["email_quente", "wa_followup", "email_oferta", "wa_oferta", "email_lembrete"] as const;
  const porPasso = PASSOS.map((passo) => {
    const ls = linhas.filter((l) => l.passo === passo);
    const ts = toques.filter((t) => t.campaign === `${campanha}:${passo}`);
    const conta = (s: string) => ls.filter((l) => l.status === s).length;
    return {
      passo,
      canal: passo.startsWith("wa_") ? "whatsapp" : "email",
      total: ls.length,
      aguardando: ls.filter((l) => l.status === "planejado" && !l.agendado_para).length,
      planejado: conta("planejado"),
      reservado: conta("reservado"),
      enviado: conta("enviado"),
      falhou: conta("falhou"),
      pulado: conta("pulado"),
      entregue: ts.filter((t) => t.delivered_at).length,
      aberto: ts.filter((t) => t.opened_at).length,
      clicado: ts.filter((t) => t.clicked_at).length,
      respondido: ts.filter((t) => t.replied_at).length,
      rejeitado: ts.filter((t) => t.bounced_at).length,
      spam: ts.filter((t) => t.complained_at).length,
      custo: ls.reduce((s, l) => s + Number(l.custo_estimado ?? 0), 0),
    };
  }).filter((p) => p.total > 0);

  const grupos = ["os_dois", "so_numero", "so_email", "teste"].map((g) => ({
    grupo: g,
    pessoas: new Set(linhas.filter((l) => l.grupo === g).map((l) => l.client_id)).size,
  })).filter((g) => g.pessoas > 0);

  // Disparos por hora, últimas 72h, por canal.
  const horas = new Map<string, { email: number; whatsapp: number }>();
  const corte = Date.now() - 72 * 3600_000;
  for (const l of linhas) {
    if (!l.enviado_em || Date.parse(l.enviado_em) < corte) continue;
    const h = l.enviado_em.slice(0, 13) + ":00:00Z";
    const atual = horas.get(h) ?? { email: 0, whatsapp: 0 };
    atual[l.canal as "email" | "whatsapp"]++;
    horas.set(h, atual);
  }
  const porHora = [...horas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hora, v]) => ({ hora, ...v }));

  const feed = linhas
    .filter((l) => l.enviado_em || l.reservado_em || l.status === "falhou" || l.status === "pulado")
    .sort((a, b) => String(b.enviado_em ?? b.reservado_em ?? "").localeCompare(String(a.enviado_em ?? a.reservado_em ?? "")))
    .slice(0, 30)
    .map((l) => ({ quando: l.enviado_em ?? l.reservado_em, nome: l.primeiro_nome, contato: mascarar(l), canal: l.canal, passo: l.passo, status: l.status, erro: l.erro }));

  // Saídas desde o início.
  const desde = inicio ?? new Date().toISOString();
  const [{ count: saiuEmail }, { count: saiuWa }] = await Promise.all([
    sb.from("email_suppressions").select("email", { count: "exact", head: true }).gte("created_at", desde),
    sb.from("whatsapp_suppressions").select("phone", { count: "exact", head: true }).gte("created_at", desde),
  ]);

  // Resultado: job criado desde o início por quem recebeu mensagem.
  const enviados = linhas.filter((l) => l.status === "enviado");
  const idsQueReceberam = new Set(enviados.map((l) => l.client_id).filter(Boolean) as string[]);
  const emailsQueReceberam = new Set(enviados.map((l) => normalizarEmail(l.email)).filter(Boolean) as string[]);
  let reservas = 0, receita = 0;
  if (inicio) {
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, client_id, client_price, total_client_price, created_at, clients(email)")
      .gte("created_at", inicio)
      .is("deleted_at", null)
      .limit(2000);
    for (const j of (jobs ?? []) as unknown as Array<{ client_id: string | null; client_price: number | null; total_client_price: number | null; clients: { email: string | null } | null }>) {
      const email = normalizarEmail(j.clients?.email);
      if ((j.client_id && idsQueReceberam.has(j.client_id)) || (email && emailsQueReceberam.has(email))) {
        reservas++;
        receita += Number(j.total_client_price ?? j.client_price ?? 0);
      }
    }
  }

  const custoEmail = linhas.filter((l) => l.canal === "email").reduce((s, l) => s + Number(l.custo_estimado ?? 0), 0);
  const custoWa = linhas.filter((l) => l.canal === "whatsapp").reduce((s, l) => s + Number(l.custo_estimado ?? 0), 0);
  const custoCopy = Number(process.env.MARKETING_COPY_CUSTO_GBP ?? "0");
  const custoTotal = custoEmail + custoWa + custoCopy;

  const emailEnviados = porPasso.filter((p) => p.canal === "email").reduce((s, p) => s + p.enviado, 0);
  const emailRejeitados = porPasso.filter((p) => p.canal === "email").reduce((s, p) => s + p.rejeitado, 0);
  const emailSpam = porPasso.filter((p) => p.canal === "email").reduce((s, p) => s + p.spam, 0);

  return {
    campanha,
    codigo: WEEK10.codigo,
    expiraEm: WEEK10.expiraEm,
    inicio,
    ligada: process.env.MARKETING_CAMPANHA?.trim().toLowerCase() === "on",
    atualizadoEm: new Date().toISOString(),
    grupos,
    porPasso,
    porHora,
    feed,
    saidas: { email: saiuEmail ?? 0, whatsapp: saiuWa ?? 0 },
    saude: {
      whatsapp: await saude(),
      taxaRejeicao: emailEnviados ? emailRejeitados / emailEnviados : 0,
      taxaSpam: emailEnviados ? emailSpam / emailEnviados : 0,
    },
    custos: { email: custoEmail, whatsapp: custoWa, copy: custoCopy, total: custoTotal },
    resultado: { reservas, receita, custoPorReserva: reservas ? custoTotal / reservas : null },
  };
}

export type PainelDaCampanha = Awaited<ReturnType<typeof painelDaCampanha>>;
