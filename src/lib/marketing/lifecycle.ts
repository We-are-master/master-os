/**
 * A varredura que põe cada contato na sequência certa. Uma porta só.
 *
 * A alternativa seria instrumentar as seis portas por onde um contato nasce
 * (site, Checkatrade, Housekeep, quote, ticket, mão). Já sabemos como isso
 * termina: a sétima porta aparece em novembro e ninguém lembra de plugar.
 * Então o funil não escuta evento nenhum, ele OLHA a base:
 *
 *   jobs_count = 0 e contato novo   → nurture de 30 dias (o aperto)
 *   jobs_count = 0 e contato velho  → fogo baixo semanal
 *   jobs_count > 0                  → clube, começando 14 dias após o job
 *
 * Quem compra sai do nurture na volta seguinte, sem ninguém avisar nada.
 *
 * As travas, na ordem em que valem:
 *
 *   1. `deleted_at`                 apagado não recebe
 *   2. tag `no-marketing`           plataforma, fornecedor, concorrente, teste
 *   3. lista de bloqueio            quem pediu para sair
 *   4. conta de origem              CLIENTE DE PLATAFORMA NUNCA ENTRA. O
 *                                   morador que a Housekeep, a Fantastic ou
 *                                   uma imobiliária mandou é cliente DELAS;
 *                                   mandar promoção para ele é quebrar
 *                                   contrato, não é marketing agressivo.
 *                                   Nosso é quem não tem conta de origem e
 *                                   quem veio pela conta "Fixfy", que é a do
 *                                   próprio site (`FIXFY_ACCOUNT_ID`).
 *   5. teto por dia                 domínio novo que dispara mil e-mails numa
 *                                   tarde vai para spam e leva a cobrança
 *                                   junto.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { bloqueados, normalizarEmail } from "./suppressions";
import { enrollInSequence, sequenciasAtivas, markConverted } from "@/lib/email-sequences/enroll";
import { FUNIL } from "@/lib/email-sequences/definitions";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O interruptor. Fechado por padrão, e de propósito.
 *
 * Subir este código não pode começar a mandar e-mail para novecentas pessoas
 * porque um deploy passou. Ligar é uma decisão, tomada uma vez, escrevendo
 * `MARKETING_LIFECYCLE=on` no ambiente. Desligar é apagar a variável, e vale na
 * volta seguinte do cron sem precisar de deploy.
 *
 * O ensaio (`?dry-run=1`) funciona com o funil desligado: dá para ver o plano
 * inteiro antes de ligar.
 */
export function funilLigado(): boolean {
  return process.env.MARKETING_LIFECYCLE?.trim().toLowerCase() === "on";
}

/** Até quantos dias de idade um lead ainda merece o aperto dos 30 dias. */
const LEAD_FRESCO_DIAS = 45;

/** A segunda semana. É daqui que o clube começa, nunca antes. */
const CLUBE_COMECA_DIAS = 14;

/**
 * As contas de origem que SÃO nossas.
 *
 * `source_account_id` nulo é contato direto, e a conta "Fixfy" é o que o site
 * B2C carimba em toda reserva (`FIXFY_ACCOUNT_ID`). Qualquer outra conta é
 * relação comercial de outra empresa: Housekeep, Fantastic, imobiliária. O
 * contato é delas, e a lista também.
 *
 * Exceção, por decisão do dono em 22/09/2026: **Checkatrade e Checkatrade
 * Express entram**. São 817 contatos, 640 que pediram preço e nunca fecharam e
 * 177 que fecharam. O raciocínio dele: o lead foi comprado por nós, a pessoa
 * falou direto conosco, e a Checkatrade nos desativou em 07/10/2026
 * ([[checkatrade-desativacao-jobs-realocados]]). Está escrito aqui em vez de
 * numa variável de ambiente para a decisão ficar visível a quem ler o código,
 * junto com o porquê.
 *
 * Housekeep continua fora, e não é o mesmo caso: lá o morador é cliente DELES,
 * o contrato assinado em 22/09 fala disso, e nós somos o subcontratado.
 *
 * `MARKETING_CONTAS_EXTRA` segue abrindo exceção por id, separado por vírgula.
 */
const CONTAS_POR_DECISAO = [
  "38b48520-f116-4263-90e5-8cd5a7d39ecf", // Checkatrade
  "8060fcf3-a538-4e5a-9318-1b49ee59f432", // Express (o Express da própria Checkatrade)
];

function contasNossas(): Set<string> {
  const ids = [
    process.env.FIXFY_ACCOUNT_ID,
    ...CONTAS_POR_DECISAO,
    ...(process.env.MARKETING_CONTAS_EXTRA ?? "").split(","),
  ];
  return new Set(ids.map((i) => String(i ?? "").trim()).filter(Boolean));
}

/** Teto de inscrições NOVAS por dia. Aquecimento de domínio, não timidez. */
function tetoPorDia(): number {
  const n = Number(process.env.MARKETING_NOVOS_POR_DIA?.trim());
  return Number.isFinite(n) && n > 0 ? n : 150;
}

type ClienteBruto = {
  id: string;
  full_name: string | null;
  email: string | null;
  postcode: string | null;
  city: string | null;
  jobs_count: number | null;
  last_job_date: string | null;
  created_at: string;
  tags: string[] | null;
  source_account_id: string | null;
};

export type Decisao = {
  clientId: string;
  email: string;
  nome: string | null;
  sequencia: string;
  /** Quando o primeiro e-mail deve sair. */
  primeiroEnvio: string;
  motivo: string;
};

export type ResultadoDaVarredura = {
  ensaio: boolean;
  olhados: number;
  alcancaveis: number;
  jaNoFunil: number;
  bloqueados: number;
  plataforma: number;
  semEmail: number;
  novos: { nurture: number; fogoBaixo: number; clube: number };
  saiuDoNurture: number;
  /** Tirados do clube por nunca abrir. Ver `pararQuemNuncaAbre`. */
  semEngajamento: number;
  /** O que o operador precisa ver na resposta do cron. Nunca é fatal. */
  avisos: string[];
  tetoAtingido: boolean;
  amostra: Decisao[];
};

/**
 * Quem já comprou, a data que conta é a do job, não a da inscrição.
 *
 * Cliente que fechou há três meses e nunca entrou no clube tem que receber
 * hoje, não daqui a duas semanas. Cliente que fechou anteontem espera.
 */
function quandoOClubeComeca(c: ClienteBruto): Date {
  const base = c.last_job_date ? new Date(c.last_job_date) : new Date(c.created_at);
  const alvo = new Date(base.getTime() + CLUBE_COMECA_DIAS * DIA_MS);
  return alvo.getTime() > Date.now() ? alvo : new Date();
}

/**
 * Tira do clube quem nunca abriu nada.
 *
 * Duas mensagens por semana para sempre, para quem nunca abriu uma, não é
 * marketing agressivo: é a receita da marcação de spam. E a marcação não cai
 * sobre a promoção, cai sobre o domínio que manda a cobrança.
 *
 * A regra só roda quando o rastreio de abertura está PROVADAMENTE funcionando
 * (existem aberturas registradas na base). Sem essa checagem, um dia com o
 * rastreio desligado no Resend esvaziaria o clube inteiro de uma vez.
 */
async function pararQuemNuncaAbre(ensaio: boolean): Promise<number> {
  const sb = createServiceClient();

  const { count: aberturas } = await sb
    .from("marketing_touches")
    .select("id", { count: "exact", head: true })
    .not("opened_at", "is", null);
  if ((aberturas ?? 0) < 20) return 0; // rastreio sem prova de vida: não mexe

  const desde = new Date(Date.now() - 45 * DIA_MS).toISOString();
  const { data } = await sb
    .from("marketing_touches")
    .select("email, opened_at, clicked_at")
    .like("campaign", "client_customer_club%")
    .gte("sent_at", desde)
    .limit(20000);

  const porEmail = new Map<string, { enviados: number; engajou: boolean }>();
  for (const t of data ?? []) {
    const e = String(t.email ?? "").toLowerCase();
    if (!e) continue;
    const atual = porEmail.get(e) ?? { enviados: 0, engajou: false };
    atual.enviados++;
    if (t.opened_at || t.clicked_at) atual.engajou = true;
    porEmail.set(e, atual);
  }

  const mortos = [...porEmail.entries()].filter(([, v]) => v.enviados >= 10 && !v.engajou).map(([e]) => e);
  if (mortos.length === 0 || ensaio) return mortos.length;

  for (const email of mortos) {
    await sb
      .from("email_sequence_enrollments")
      .update({ status: "stopped", updated_at: new Date().toISOString() })
      .eq("sequence_key", FUNIL.jaComprou)
      .eq("contact_email", email)
      .eq("status", "active");
  }
  return mortos.length;
}

export async function varrerFunil(opcoes: { aplicar: boolean; limite?: number }): Promise<ResultadoDaVarredura> {
  const sb = createServiceClient();
  const ensaio = !opcoes.aplicar;

  const { data, error } = await sb
    .from("clients")
    .select("id, full_name, email, postcode, city, jobs_count, last_job_date, created_at, tags, source_account_id")
    .is("deleted_at", null)
    .not("email", "is", null)
    .order("last_job_date", { ascending: false, nullsFirst: false })
    .limit(opcoes.limite ?? 10000);
  if (error) throw new Error(`varredura: ${error.message}`);

  const brutos = (data ?? []) as ClienteBruto[];
  const res: ResultadoDaVarredura = {
    ensaio,
    olhados: brutos.length,
    alcancaveis: 0,
    jaNoFunil: 0,
    bloqueados: 0,
    plataforma: 0,
    semEmail: 0,
    novos: { nurture: 0, fogoBaixo: 0, clube: 0 },
    saiuDoNurture: 0,
    semEngajamento: 0,
    avisos: [],
    tetoAtingido: false,
    amostra: [],
  };

  const nossas = contasNossas();
  /**
   * Sem `FIXFY_ACCOUNT_ID` no ambiente, os contatos do próprio site viram
   * "plataforma" e ficam de fora. A falha é segura, porque errar para menos
   * não manda e-mail para quem não devia, mas ela é silenciosa: o funil ficaria
   * com um terço do tamanho e ninguém entenderia por quê.
   */
  if (!process.env.FIXFY_ACCOUNT_ID?.trim()) {
    res.avisos.push("FIXFY_ACCOUNT_ID não está no ambiente: os contatos vindos do site estão sendo tratados como de plataforma e ficam de fora.");
  }

  const candidatos: Array<{ c: ClienteBruto; email: string }> = [];
  for (const c of brutos) {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (tags.includes("no-marketing")) continue;

    // Trava 4, e ela vem antes de qualquer consulta cara.
    if (c.source_account_id && !nossas.has(c.source_account_id)) { res.plataforma++; continue; }

    const email = normalizarEmail(c.email);
    if (!email) { res.semEmail++; continue; }
    candidatos.push({ c, email });
  }

  const barrados = await bloqueados(candidatos.map((x) => x.email));
  const limpos = candidatos.filter((x) => {
    if (barrados.has(x.email)) { res.bloqueados++; return false; }
    return true;
  });
  res.alcancaveis = limpos.length;

  res.semEngajamento = await pararQuemNuncaAbre(ensaio);

  const ativos = await sequenciasAtivas(limpos.map((x) => x.email));

  /**
   * Quantas inscrições novas cabem ainda hoje.
   *
   * Conta o que foi criado nas últimas 24 horas em vez de zerar à meia-noite:
   * a varredura roda de hora em hora, e um contador que zera faria a base
   * inteira entrar em duas madrugadas.
   */
  let cabem = tetoPorDia();
  if (!ensaio) {
    const { count } = await sb
      .from("email_sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - DIA_MS).toISOString());
    cabem = Math.max(0, tetoPorDia() - (count ?? 0));
  }

  const agora = Date.now();
  const decisoes: Decisao[] = [];

  for (const { c, email } of limpos) {
    const comprou = Number(c.jobs_count ?? 0) > 0;
    const jaAtivo = ativos.get(email) ?? new Set<string>();

    if (comprou) {
      /**
       * Comprou: sai do nurture e entra no clube.
       *
       * As duas coisas na mesma volta, e nesta ordem. Deixar o nurture vivo
       * faria o cliente receber "ainda não fechou?" na semana em que o
       * parceiro esteve na casa dele.
       */
      if (jaAtivo.has(FUNIL.naoComprou) || jaAtivo.has(FUNIL.naoComprouFogoBaixo)) {
        if (!ensaio) {
          await markConverted(FUNIL.naoComprou, email);
          await markConverted(FUNIL.naoComprouFogoBaixo, email);
        }
        res.saiuDoNurture++;
      }
      if (jaAtivo.has(FUNIL.jaComprou)) { res.jaNoFunil++; continue; }

      decisoes.push({
        clientId: c.id,
        email,
        nome: c.full_name,
        sequencia: FUNIL.jaComprou,
        primeiroEnvio: quandoOClubeComeca(c).toISOString(),
        motivo: c.last_job_date ? `comprou em ${String(c.last_job_date).slice(0, 10)}` : "comprou",
      });
      continue;
    }

    if (jaAtivo.has(FUNIL.naoComprou) || jaAtivo.has(FUNIL.naoComprouFogoBaixo)) { res.jaNoFunil++; continue; }

    const idadeDias = (agora - new Date(c.created_at).getTime()) / DIA_MS;
    const fresco = idadeDias <= LEAD_FRESCO_DIAS;

    /**
     * Lead velho não recebe "obrigado por entrar em contato".
     *
     * O nurture abre com um e-mail que só faz sentido para quem pediu preço
     * esta semana. Mandar isso para quem perguntou em março é o tipo de erro
     * que a pessoa lê como disparo automático, porque é.
     */
    decisoes.push({
      clientId: c.id,
      email,
      nome: c.full_name,
      sequencia: fresco ? FUNIL.naoComprou : FUNIL.naoComprouFogoBaixo,
      primeiroEnvio: new Date().toISOString(),
      motivo: fresco ? `lead de ${Math.round(idadeDias)} dia(s)` : `lead de ${Math.round(idadeDias)} dias, fogo baixo`,
    });
  }

  /**
   * Quem entra primeiro quando o teto do dia não cabe todo mundo.
   *
   * Cliente que comprou na frente, depois lead fresco, depois a base velha.
   * É a ordem do dinheiro: o clube vende para quem já provou que compra.
   */
  const peso = (d: Decisao) => (d.sequencia === FUNIL.jaComprou ? 0 : d.sequencia === FUNIL.naoComprou ? 1 : 2);
  decisoes.sort((a, b) => peso(a) - peso(b));

  for (const d of decisoes) {
    if (cabem <= 0) { res.tetoAtingido = true; break; }

    if (!ensaio) {
      const r = await enrollInSequence({
        sequenceKey: d.sequencia,
        email: d.email,
        name: d.nome ?? undefined,
        clientId: d.clientId,
        firstSendAt: d.primeiroEnvio,
        context: {
          name: (d.nome ?? "").trim().split(/\s+/)[0] || undefined,
          unsubscribeUrl: unsubscribeUrl(d.email),
        },
      });
      if (!r.ok || r.alreadyActive) continue;
    }

    cabem--;
    if (d.sequencia === FUNIL.jaComprou) res.novos.clube++;
    else if (d.sequencia === FUNIL.naoComprou) res.novos.nurture++;
    else res.novos.fogoBaixo++;
    if (res.amostra.length < 10) res.amostra.push(d);
  }

  return res;
}
