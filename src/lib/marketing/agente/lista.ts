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
 * o jeito mais rápido de ir para o spam e não voltar. Então a lista cresce em
 * degraus: 1.000, depois +1.000 por dia até 5 mil (regra do dono em 14/10).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { classificar, type Classificado } from "@/lib/marketing/campanha";
import { contasNossas } from "@/lib/marketing/lifecycle";
import { bloquear, normalizarEmail } from "@/lib/marketing/suppressions";
import { toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { adicionarAoSegmento, contatosDoSegmento, criarContato, marcarSaida, removerDoSegmento, segmentoPeloNome, type ContatoResend } from "./resend";

/** Recebe o clube 2x por semana: lead demorando (B) e cliente (F). */
export const NOME_DO_SEGMENTO = "Fixfy Clients";
/** Recebe só a edição de terça: lead antigo (C). */
export const NOME_DO_SEGMENTO_SEMANAL = "Fixfy Clients · Weekly";

// Dono, 14/10/2026: até 1.000 de uma vez, depois +1.000 por dia, até 5 mil;
// dali para cima só quando ele mandar (MARKETING_CLUBE_TETO).
const RAMPA: Array<{ ate: string; teto: number }> = [
  { ate: "2026-10-15", teto: 1000 },
  { ate: "2026-10-16", teto: 2000 },
  { ate: "2026-10-17", teto: 3000 },
  { ate: "2026-10-18", teto: 4000 },
];
const TETO_FINAL = 5000;

/** Mais que isso numa rodada não é gente clicando em descadastrar: é marca do sistema. */
export const LIMITE_DE_DESCADASTROS_POR_RODADA = 50;

/** Quantos contatos a lista pode ter hoje. `MARKETING_CLUBE_TETO` passa por cima. */
export function tetoDaLista(agora = new Date()): number {
  const fixo = Number(process.env.MARKETING_CLUBE_TETO?.trim());
  if (Number.isFinite(fixo) && fixo > 0) return fixo;
  const degrau = RAMPA.find((d) => agora.getTime() < Date.parse(`${d.ate}T09:00:00Z`));
  return degrau ? degrau.teto : TETO_FINAL;
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

/* ═══════════════════ Posição do lead ═══════════════════ */

/**
 * Onde a pessoa está no funil, recalculado todo dia (dono, 14/10/2026):
 *
 *   A  lead novo, até 14 dias        nada do clube: o follow-up do lead no Zendesk cobre
 *   B  lead demorando, 15 a 90 dias  clube 2x por semana e relâmpagos
 *   C  lead antigo, mais de 90 dias  só a edição de terça e relâmpagos
 *   D  fechou, job em andamento      nenhuma promoção
 *   E  cliente, job há até 30 dias   pedido de avaliação e indicação (avaliacao.ts)
 *   F  cliente, job há mais de 30    clube 2x por semana, relâmpagos e ofertas de volta
 */
export type Posicao = "A" | "B" | "C" | "D" | "E" | "F";

const FEITO = new Set(["completed", "invoiced", "paid", "closed"]);
const FORA = new Set(["cancelled", "lost", "deleted"]);
const DIA_MS = 24 * 60 * 60 * 1000;

export function posicaoDoCliente(
  cliente: { created_at: string },
  jobs: Array<{ status: string | null; scheduled_date: string | null; created_at: string }>,
  agora = new Date(),
): { posicao: Posicao; ultimoJob: Date | null } {
  const validos = jobs.filter((j) => !FORA.has(String(j.status)));
  if (validos.some((j) => !FEITO.has(String(j.status)))) return { posicao: "D", ultimoJob: null };
  if (validos.length) {
    const ultimo = new Date(Math.max(...validos.map((j) => Date.parse(j.scheduled_date ?? j.created_at))));
    return { posicao: agora.getTime() - ultimo.getTime() <= 30 * DIA_MS ? "E" : "F", ultimoJob: ultimo };
  }
  const idade = (agora.getTime() - Date.parse(cliente.created_at)) / DIA_MS;
  return { posicao: idade <= 14 ? "A" : idade <= 90 ? "B" : "C", ultimoJob: null };
}

export type Alvo = Classificado & { posicao: Posicao; ultimoJob: Date | null };

/** A base com e-mail e a posição de cada um. A ordem é a de prioridade da rampa: cliente, lead recente, lead antigo. */
export async function publicoComPosicao(agora = new Date()): Promise<Alvo[]> {
  const sb = createServiceClient();
  const { alvos } = await publico({ ignorarJobRecente: true });
  const ids = new Set(alvos.map((a) => a.clientId));
  const [clientes, jobs] = await Promise.all([
    paginar<{ id: string; created_at: string }>((de, ate) => sb.from("clients").select("id, created_at").is("deleted_at", null).range(de, ate)),
    paginar<{ client_id: string; status: string | null; scheduled_date: string | null; created_at: string }>((de, ate) =>
      sb.from("jobs").select("client_id, status, scheduled_date, created_at").is("deleted_at", null).range(de, ate)),
  ]);
  const criado = new Map(clientes.filter((c) => ids.has(c.id)).map((c) => [c.id, c.created_at]));
  const porCliente = new Map<string, typeof jobs>();
  for (const j of jobs) if (ids.has(j.client_id)) (porCliente.get(j.client_id) ?? porCliente.set(j.client_id, []).get(j.client_id)!).push(j);
  const ordem: Record<Posicao, number> = { F: 0, E: 1, B: 2, C: 3, A: 4, D: 5 };
  return alvos
    .map((a) => ({ ...a, ...posicaoDoCliente({ created_at: criado.get(a.clientId) ?? new Date(0).toISOString() }, porCliente.get(a.clientId) ?? [], agora) }))
    .sort((x, y) => ordem[x.posicao] - ordem[y.posicao]);
}

/** Em que lista do clube a posição fica. */
export function segmentoDaPosicao(p: Posicao): "duas" | "semanal" | null {
  if (p === "B" || p === "F") return "duas";
  if (p === "C") return "semanal";
  return null;
}

/* ═══════════════════ Sincronização ═══════════════════ */

export type ResultadoDaLista = {
  segmentos: { duas: string | null; semanal: string | null };
  posicoes: Record<Posicao, number>;
  teto: number | null;
  naResend: number;
  entraram: number;
  mudaramDeLista: number;
  sairamDoClube: number;
  sairamNaResend: number;
  marcadosLa: number;
  faltamEntrar: number;
  erros: string[];
};

/**
 * Deixa as duas listas da Resend iguais ao OS. Anda nos dois sentidos:
 * descadastro na Resend vira bloqueio aqui (e-mail e WhatsApp), e bloqueio
 * aqui vira descadastro lá. Quem só mudou de posição muda de lista, sem
 * descadastro: o lead que fechou sai do clube enquanto o job anda e volta
 * como cliente. `maxOperacoes` existe porque cada contato é uma chamada e a
 * rota do cron tem 5 minutos.
 */
export async function sincronizarLista(opcoes: { aplicar: boolean; maxOperacoes?: number; agora?: Date }): Promise<ResultadoDaLista> {
  const max = opcoes.maxOperacoes ?? 350;
  const teto = tetoDaLista(opcoes.agora);
  const alvos = (await publicoComPosicao(opcoes.agora)).filter((a) => a.email) as Array<Alvo & { email: string }>;
  const porEmail = new Map(alvos.map((a) => [a.email, a]));

  const r: ResultadoDaLista = {
    segmentos: { duas: null, semanal: null },
    posicoes: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
    teto: Number.isFinite(teto) ? teto : null,
    naResend: 0, entraram: 0, mudaramDeLista: 0, sairamDoClube: 0, sairamNaResend: 0, marcadosLa: 0, faltamEntrar: 0, erros: [],
  };
  for (const a of alvos) r.posicoes[a.posicao]++;

  const seg = {
    duas: await segmentoPeloNome(NOME_DO_SEGMENTO, opcoes.aplicar),
    semanal: await segmentoPeloNome(NOME_DO_SEGMENTO_SEMANAL, opcoes.aplicar),
  };
  r.segmentos = seg;
  const atual = new Map<string, { contato: ContatoResend; lista: "duas" | "semanal" }>();
  for (const lista of ["duas", "semanal"] as const) {
    if (!seg[lista]) continue;
    for (const c of await contatosDoSegmento(seg[lista] as string)) {
      const e = normalizarEmail(c.email);
      if (e) atual.set(e, { contato: c, lista });
    }
  }
  r.naResend = atual.size;

  let operacoes = 0;
  const pode = () => opcoes.aplicar && operacoes < max;
  const erro = (e: unknown) => r.erros.push(String((e as Error).message ?? e));
  const sb = createServiceClient();

  // A rampa vale para o total do clube, na ordem de prioridade (cliente, lead
  // recente, lead antigo): quem está além do teto de hoje sai da lista sem
  // descadastro e volta quando o teto subir.
  const doClube = alvos.filter((a) => segmentoDaPosicao(a.posicao));
  const cabeHoje = new Set((Number.isFinite(teto) ? doClube.slice(0, teto) : doClube).map((a) => a.email));

  /**
   * Trava contra descadastro em massa (16/10/2026). Até o dia 14 a própria
   * sincronização marcava como descadastrado quem passava do teto do dia, e 700
   * contatos que nunca receberam nada ficaram com a marca. Ler isso como pedido
   * do cliente bloquearia 700 pessoas de vez no OS, e-mail e WhatsApp. Pedido de
   * verdade chega aos poucos: passou do limite numa rodada, nada é gravado e a
   * rodada avisa para conferir.
   */
  const descadastrados = [...atual].filter(([email, { contato }]) => contato.unsubscribed && porEmail.has(email)).length;
  const muitos = descadastrados > LIMITE_DE_DESCADASTROS_POR_RODADA;
  if (muitos) r.erros.push(`${descadastrados} descadastrados na Resend de uma vez (limite ${LIMITE_DE_DESCADASTROS_POR_RODADA}): nada gravado no OS, conferir antes`);

  for (const [email, { contato, lista }] of atual) {
    const alvo = porEmail.get(email);
    if (contato.unsubscribed) {
      if (!alvo) continue;
      // Saiu pelo link do broadcast: o OS ainda não sabia.
      r.sairamNaResend++;
      if (!opcoes.aplicar || muitos) continue;
      await bloquear(email, "unsubscribed", "resend-broadcast");
      const fone = toWhatsAppNumber(alvo.phone);
      if (fone) await sb.from("whatsapp_suppressions").upsert({ phone: fone, reason: "stopped", source: "resend-broadcast" }, { onConflict: "phone", ignoreDuplicates: true });
      continue;
    }
    if (!alvo) {
      // Não pode mais receber (bloqueio, tag, apagado, virou plataforma).
      r.marcadosLa++;
      if (pode()) { operacoes++; await marcarSaida(seg[lista] as string, contato.id).catch(erro); }
      continue;
    }
    const devia = cabeHoje.has(email) ? segmentoDaPosicao(alvo.posicao) : null;
    if (devia === lista) continue;
    if (!devia) {
      r.sairamDoClube++;
      if (pode()) { operacoes++; await removerDoSegmento(contato.id, seg[lista] as string).catch(erro); }
      continue;
    }
    r.mudaramDeLista++;
    if (pode() && seg[devia]) {
      operacoes += 2;
      await adicionarAoSegmento(contato.id, seg[devia] as string).catch(erro);
      await removerDoSegmento(contato.id, seg[lista] as string).catch(erro);
    }
  }

  const entrando = doClube.filter((a) => !atual.has(a.email));
  for (const a of entrando.filter((x) => cabeHoje.has(x.email))) {
    const destino = seg[segmentoDaPosicao(a.posicao) as "duas" | "semanal"];
    if (!opcoes.aplicar || !destino) { r.entraram++; continue; }
    if (operacoes >= max) break;
    operacoes++;
    try {
      await criarContato(destino, { email: a.email, ...(a.nome && a.nome !== "there" ? { first_name: a.nome } : {}) });
      r.entraram++;
    } catch (e) {
      erro(e);
      // Cota de contatos do plano ou chave sem permissão: insistir só repete o erro.
      if (r.erros.length >= 5) break;
    }
  }
  r.faltamEntrar = entrando.length - r.entraram;
  return r;
}
