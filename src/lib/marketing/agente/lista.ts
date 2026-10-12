/**
 * A lista do clube na Resend ("Fixfy Clients") e quem pode estar nela.
 *
 * Quem entra é a mesma regra da campanha de setembro: base própria, caixa de
 * e-mail pessoal, sem a tag `no-marketing`, fora da lista de bloqueio. Quem já
 * comprou entra primeiro.
 *
 * A sincronização anda nos dois sentidos, porque agora existem dois lugares
 * onde a pessoa pode sair:
 *
 *   Resend → OS   quem clicou "unsubscribe" num broadcast vira bloqueio aqui
 *                 (e-mail E WhatsApp: quem não quer promoção não quer um canal
 *                 a menos).
 *   OS → Resend   quem foi bloqueado, apagado ou marcado aqui é marcado como
 *                 saída lá, para o próximo broadcast não o alcançar.
 *
 * ── A rampa ────────────────────────────────────────────────────────────────
 *
 * `news.getfixfy.com` só mandou 527 e-mails na vida. Soltar 3.000 de uma vez é
 * o jeito mais rápido de ir para o spam e não voltar. Então a lista cresce a
 * cada edição: 600, 1.000, 1.500, 2.200, e só em novembro a base inteira.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { classificar, type Classificado } from "@/lib/marketing/campanha";
import { contasNossas } from "@/lib/marketing/lifecycle";
import { bloquear, normalizarEmail } from "@/lib/marketing/suppressions";
import { toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { contatosDoSegmento, criarContato, marcarSaida, segmentoPeloNome } from "./resend";

export const NOME_DO_SEGMENTO = "Fixfy Clients";

const RAMPA: Array<{ ate: string; teto: number }> = [
  { ate: "2026-10-20", teto: 600 },
  { ate: "2026-10-23", teto: 1000 },
  { ate: "2026-10-27", teto: 1500 },
  { ate: "2026-11-03", teto: 2200 },
];

/** Quantos contatos a lista pode ter hoje. `MARKETING_CLUBE_TETO` passa por cima. */
export function tetoDaLista(agora = new Date()): number {
  const fixo = Number(process.env.MARKETING_CLUBE_TETO?.trim());
  if (Number.isFinite(fixo) && fixo > 0) return fixo;
  const degrau = RAMPA.find((d) => agora.getTime() < Date.parse(`${d.ate}T09:00:00Z`));
  return degrau ? degrau.teto : Number.POSITIVE_INFINITY;
}

type ClienteBruto = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  source_account_id: string | null;
  last_job_date: string | null;
  created_at: string;
};

async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    tudo.push(...(data ?? []));
    if ((data ?? []).length < 1000) return tudo;
  }
}

/**
 * A base própria, classificada, já na ordem de prioridade (quem comprou
 * primeiro). `ignorarJobRecente` é para o clube: quem teve visita esta semana
 * fica fora de promoção relâmpago, mas não sai da lista do clube por isso.
 */
export async function publico(opcoes: { ignorarJobRecente: boolean }): Promise<{ alvos: Classificado[]; fora: Record<string, number> }> {
  const sb = createServiceClient();
  const clientes = await paginar<ClienteBruto>((de, ate) =>
    sb
      .from("clients")
      .select("id, full_name, email, phone, tags, source_account_id, last_job_date, created_at")
      .is("deleted_at", null)
      .order("last_job_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(de, ate),
  );
  // A lista de bloqueio inteira, cruzada em memória: `in(...)` com milhares de
  // e-mails estoura a URL do PostgREST.
  const [emails, fones] = await Promise.all([
    paginar<{ email: string }>((de, ate) => sb.from("email_suppressions").select("email").range(de, ate)),
    paginar<{ phone: string }>((de, ate) => sb.from("whatsapp_suppressions").select("phone").range(de, ate)),
  ]);
  const bloqueio = { emails: new Set(emails.map((e) => e.email)), phones: new Set(fones.map((f) => f.phone)) };
  const lista = opcoes.ignorarJobRecente ? clientes.map((c) => ({ ...c, last_job_date: null })) : clientes;
  return classificar(lista, bloqueio, contasNossas());
}

export type ResultadoDaLista = {
  segmento: string | null;
  elegiveis: number;
  teto: number | null;
  naResend: number;
  novos: number;
  sairamNaResend: number;
  marcadosLa: number;
  faltamEntrar: number;
  erros: string[];
};

/**
 * Deixa a lista da Resend igual à do OS. `maxOperacoes` existe porque cada
 * contato é uma chamada e a rota do cron tem 5 minutos: a carga inicial roda
 * pelo script, as voltas diárias só carregam a diferença.
 */
export async function sincronizarLista(opcoes: { aplicar: boolean; maxOperacoes?: number; agora?: Date }): Promise<ResultadoDaLista> {
  const max = opcoes.maxOperacoes ?? 350;
  const teto = tetoDaLista(opcoes.agora);
  const { alvos } = await publico({ ignorarJobRecente: true });
  const elegiveis = alvos.filter((a) => a.email) as Array<Classificado & { email: string }>;
  const porEmail = new Map(elegiveis.map((a) => [a.email, a]));

  const r: ResultadoDaLista = {
    segmento: null, elegiveis: elegiveis.length, teto: Number.isFinite(teto) ? teto : null,
    naResend: 0, novos: 0, sairamNaResend: 0, marcadosLa: 0, faltamEntrar: 0, erros: [],
  };

  const segmento = await segmentoPeloNome(NOME_DO_SEGMENTO, opcoes.aplicar);
  r.segmento = segmento;
  const la = segmento ? await contatosDoSegmento(segmento) : [];
  r.naResend = la.length;
  const jaEsta = new Set<string>();
  let operacoes = 0;
  const sb = createServiceClient();

  for (const c of la) {
    const email = normalizarEmail(c.email);
    if (!email) continue;
    jaEsta.add(email);
    const alvo = porEmail.get(email);
    if (c.unsubscribed && alvo) {
      // Saiu pelo link do broadcast: o OS ainda não sabia.
      r.sairamNaResend++;
      if (!opcoes.aplicar) continue;
      await bloquear(email, "unsubscribed", "resend-broadcast");
      const fone = toWhatsAppNumber(alvo.phone);
      if (fone) await sb.from("whatsapp_suppressions").upsert({ phone: fone, reason: "stopped", source: "resend-broadcast" }, { onConflict: "phone", ignoreDuplicates: true });
    } else if (!c.unsubscribed && !alvo) {
      // Não pode mais receber (bloqueio, tag, apagado, virou plataforma).
      r.marcadosLa++;
      if (!opcoes.aplicar || !segmento || operacoes >= max) continue;
      operacoes++;
      await marcarSaida(segmento, c.id).catch((e) => r.erros.push(String(e.message ?? e)));
    }
  }

  const vagas = Math.max(0, teto - la.length);
  const entrando = elegiveis.filter((a) => !jaEsta.has(a.email));
  const cabem = entrando.slice(0, Number.isFinite(vagas) ? vagas : entrando.length);
  for (const a of cabem) {
    if (!opcoes.aplicar || !segmento) { r.novos++; continue; }
    if (operacoes >= max) break;
    operacoes++;
    try {
      await criarContato(segmento, { email: a.email, ...(a.nome && a.nome !== "there" ? { first_name: a.nome } : {}) });
      r.novos++;
    } catch (e) {
      r.erros.push(String((e as Error).message ?? e));
      // Cota de contatos do plano ou chave sem permissão: insistir só repete o erro.
      if (r.erros.length >= 5) break;
    }
  }
  r.faltamEntrar = entrando.length - r.novos;
  return r;
}
