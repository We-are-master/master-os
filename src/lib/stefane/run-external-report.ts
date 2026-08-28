/**
 * STEFANE — orquestra um envio: monta o payload, submete, grava e avisa.
 *
 * Só entra job em `final_check` cujo relatório final chegou hoje. As duas
 * condições existem pelo mesmo motivo: em 2026-08-13 a fila crua tinha dez jobs
 * `completed` de semanas atrás, e submeter relatório retroativo por cima de um
 * que já foi entregue à mão cria confusão do lado deles. A Housekeep pede o
 * relatório no mesmo dia da visita, então "hoje" também é a regra deles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { payloadDoReport, payloadLimpeza } from "./housekeep-report-form";
import { submeterRelatorioHousekeep } from "./submit-housekeep-report";
import {
  buscarFormulario,
  ehLinkHousekeep,
  faltasDeFoto,
  formaDoFormularioAPI,
  slotsDeFoto,
  confirmarSubmissao,
} from "./housekeep-api";
import {
  photoSlotsForTemplate,
  pickReportTemplate,
  usesCleaningForm,
  type ReportTemplate,
} from "@/lib/public-report-templates";
import { isReportTemplate } from "@/lib/report-submission";
import {
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailHeadBlock,
  partnerEmailLogoHeaderRow,
  partnerEmailOuterTableClose,
  partnerEmailOuterTableOpen,
  partnerEmailPreheaderHtml,
} from "@/lib/emails/partner-email-layout";

const AVISAR = "victor@getfixfy.com";
const MAX_TENTATIVAS = 3;

/**
 * Depois disto, um envio que começou e não terminou está MORTO, não em
 * andamento. O envio mais pesado que existe (limpeza com 124 fotos) leva
 * poucos minutos; dez é folgado o bastante para não matar um envio vivo e
 * curto o bastante para ninguém ficar olhando um "enviando" que não anda.
 */
export const ENVIO_TRAVADO_MS = 10 * 60_000;

/** `started_at` recente = alguém está enviando agora. Velho = processo morreu. */
export function envioEmAndamento(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false;
  const t = new Date(startedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < ENVIO_TRAVADO_MS;
}

export type EstadoEnvio = "enviando" | "enviado" | "falhou" | "nao_elegivel";

export type OpcoesDeEnvio = {
  /** Preenche o formulário deles inteiro e NÃO aperta Submit. */
  simular?: boolean;
  /**
   * Pula o nosso mínimo de fotos por cômodo e deixa a página deles julgar.
   * Ignorado fora do dry run: ver o bloco que o consome.
   */
  ignorarMinimoDeFotos?: boolean;
};

const JOB_SELECT =
  "id, reference, title, status, report_link, start_report, final_report, final_report_submitted, " +
  "partner_timer_started_at, partner_timer_ended_at, partner_name, client_name, property_address, " +
  "external_report_started_at, external_report_submitted_at, external_report_manual_at, external_report_attempts";

/**
 * Qual dos dois formulários da Housekeep preencher.
 *
 * Manda o **relatório que foi realmente digitado**, não o título do job. Um
 * relatório escrito no template chapado não tem os campos por cômodo, e
 * submetê-lo no formulário de limpeza produziria um envio com metade das
 * respostas em branco. O título só decide quando ainda não há relatório.
 *
 * Até 14/08/2026 esta função tinha a sua própria regex, que discordava da
 * lista de palavras do OS em `tenancy`: o escritório digitava plano e a
 * Stefane submetia por cômodo. Agora as duas pontas leem a mesma fonte.
 */
function ehLimpeza(job: { title?: unknown; final_report?: unknown; start_report?: unknown }): boolean {
  for (const r of [job.final_report, job.start_report]) {
    const t = (r as { template?: unknown } | null)?.template;
    if (typeof t === "string" && isReportTemplate(t)) return usesCleaningForm(t);
  }
  return usesCleaningForm(pickReportTemplate({ title: String(job.title ?? "") }));
}

/**
 * Aceita as duas formas de link da Housekeep, e não só a canônica.
 *
 * Seis jobs guardam `links.housekeep.com/ls/click?upn=...`, o rastreador de
 * email deles, porque é isso que chega no ticket que o Harvey lê. A regex
 * antiga só casava `housekeep.com/job-reports`, então esses seis eram
 * reportados como "plataforma ainda não automatizada" e ninguém enviou nada.
 * Quem resolve o redirect é `buscarFormulario`, na hora do envio.
 */
function ehHousekeep(link: string | null): boolean {
  return ehLinkHousekeep(link);
}

/** Checkatrade/Express: quem completa lá é o robô do RPA, não este processo. */
function ehCheckatrade(link: string | null): boolean {
  return /checkatrade/i.test(String(link ?? ""));
}

/**
 * Achata as fotos de um report para uma lista de URLs.
 *
 * O envelope guarda duas formas: array plano (general, gardener) e mapa por
 * cômodo (cleaner, certificate). Aqui os dois viram lista, na ordem em que
 * foram gravados.
 */
export function urlsDeFoto(report: unknown): string[] {
  const p = (report as { photos?: unknown } | null)?.photos;
  const limpa = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
  if (Array.isArray(p)) return limpa(p);
  if (p && typeof p === "object") return Object.values(p as Record<string, unknown>).flatMap(limpa);
  return [];
}

/**
 * As fotos de um report AINDA separadas por cômodo.
 *
 * `urlsDeFoto` acima achata, e achatar é o certo para o formulário de trade,
 * que tem dois campos. O de limpeza tem treze, um por cômodo, e para ele o
 * mapa precisa chegar inteiro — foi exatamente essa perda que fazia o
 * relatório de End of Tenancy chegar vazio do outro lado.
 *
 * Devolve null quando o envelope é lista plana (report antigo ou template de
 * trade): quem chama volta para o caminho de dois blocos.
 */
export function fotosPorComodo(report: unknown): Record<string, string[]> | null {
  const p = (report as { photos?: unknown } | null)?.photos;
  if (!p || Array.isArray(p) || typeof p !== "object") return null;
  const out: Record<string, string[]> = {};
  for (const [chave, valor] of Object.entries(p as Record<string, unknown>)) {
    const urls = Array.isArray(valor)
      ? valor.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : [];
    if (urls.length > 0) out[chave] = urls;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const BUCKET_FOTOS = "job-reports";

/**
 * Troca as URLs guardadas no report por URLs assinadas, que abrem de fato.
 *
 * O bucket `job-reports` é privado, mas o que fica gravado no envelope é o
 * `getPublicUrl` — um endereço que responde 400 para quem não é o service role.
 * Sem assinar, o Playwright baixava zero foto e o relatório subia vazio.
 *
 * Dez minutos bastam: o envio inteiro leva de 25 a 35 segundos.
 */
export async function assinarFotos(supabase: SupabaseClient, urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const marcador = `/${BUCKET_FOTOS}/`;
  const caminhos = urls
    .map((u) => {
      const i = u.indexOf(marcador);
      return i === -1 ? null : decodeURIComponent(u.slice(i + marcador.length).split("?")[0]);
    })
    .filter((p): p is string => !!p);
  if (caminhos.length === 0) return urls;

  const { data, error } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(caminhos, 600);
  if (error) {
    console.error("[stefane] não consegui assinar as fotos:", error.message);
    return [];
  }
  return (data ?? [])
    .map((d) => d.signedUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
}

/**
 * Template gravado no envelope do relatório, com `general` como padrão.
 *
 * Serve só para saber se aquele template tem seção de chegada, ou seja, se faz
 * sentido exigir foto de "antes".
 */
function templateDoReport(job: { final_report?: unknown; start_report?: unknown }): ReportTemplate {
  for (const r of [job.final_report, job.start_report]) {
    const t = (r as { template?: unknown } | null)?.template;
    if (typeof t === "string" && isReportTemplate(t)) return t;
  }
  return "general";
}

/** Motivo pelo qual o job não pode ser enviado agora, ou null se pode. */
export function motivoNaoElegivel(job: {
  status?: string | null;
  report_link?: string | null;
  final_report_submitted?: boolean | null;
  external_report_submitted_at?: string | null;
  external_report_manual_at?: string | null;
  external_report_attempts?: number | null;
  partner_timer_started_at?: string | null;
  partner_timer_ended_at?: string | null;
  start_report?: unknown;
  final_report?: unknown;
}): string | null {
  if (job.external_report_submitted_at) return "the report has already been sent";
  // Marcado como enviado à mão: as colunas da migração 249 existem para isto.
  // Sem esta linha o job continuava "pendente" para sempre depois de alguém
  // ter feito o trabalho no site — e o robô ainda tentava por cima.
  if (job.external_report_manual_at) return "marked as sent manually";
  if (!job.final_report_submitted) return "the partner has not sent the final report yet";
  if (!job.report_link) return "this job has no platform link: nowhere to upload";
  /**
   * FOTO: o mínimo é de cada plataforma, não um número nosso (dono, 27/08).
   *
   * Uma foto resolve no Checkatrade — o robô do Express anexa o que tiver e
   * conclui. Exigir antes E depois ali barrava job pronto por uma regra que só
   * existe do outro lado: o JOB do print ficou parado em "no before photos"
   * com foto de sobra para o que o Checkatrade pede.
   *
   * A Housekeep é que recusa relatório pela metade, e por isso mantém as duas
   * metades. O guarda antigo somava as duas e só exigia total maior que zero,
   * então três do antes e nenhuma do depois passava direto.
   *
   * A exigência do "antes" só vale para template que TEM seção de chegada. O de
   * certificado não tem: o anexo dele mora na conclusão, e exigir antes ali
   * recusaria todo certificado por um motivo que não existe.
   */
  const antes = urlsDeFoto(job.start_report).length;
  const depois = urlsDeFoto(job.final_report).length;
  const ehExpress = ehCheckatrade(job.report_link);
  if (antes + depois === 0) {
    return "no photos on the report: the client platform needs at least one";
  }
  if (!ehExpress) {
    const temSecaoDeChegada = photoSlotsForTemplate(templateDoReport(job)).start.length > 0;
    if (temSecaoDeChegada && antes === 0) return "no before photos: the client platform requires both";
    if (depois === 0) return "no after photos: the client platform requires both";
  }
  /**
   * Horário impossível bloqueia AQUI, com instrução — descoberto no JOB-9437.
   *
   * O timer do parceiro tinha virado a noite (start 23:48, finish 11:31) e a
   * Housekeep valida a SEÇÃO no servidor: o Save falha com "Validation error
   * has occurred", nada da seção persiste, e o Submit finaliza sem descrição
   * nem foto. Três recusas seguidas, todas por causa disto, nenhuma dizendo
   * isto. Comparar como HH:MM em Londres, igual ao formulário: é assim que o
   * outro lado enxerga.
   */
  if (job.partner_timer_started_at && job.partner_timer_ended_at) {
    const hhmm = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .format(new Date(iso));
    const ini = hhmm(job.partner_timer_started_at);
    const fim = hhmm(job.partner_timer_ended_at);
    if (fim <= ini) {
      return `impossible on-site times (start ${ini}, finish ${fim}): fix them in Edit report first`;
    }
  }
  if ((job.external_report_attempts ?? 0) >= MAX_TENTATIVAS) return "out of attempts: needs a person";
  // Express NÃO é "not automated": o robô do RPA completa na plataforma na
  // próxima passada dele. Dizer "not automated" fazia parecer trabalho manual
  // pendente, e alguém ia fazer à mão o que o robô já ia fazer sozinho.
  if (ehCheckatrade(job.report_link)) {
    return "queued for the Express robot: it completes it on the platform on its next pass";
  }
  if (!ehHousekeep(job.report_link)) return "platform not automated yet (Housekeep only for now)";
  return null;
}

/**
 * Grava a falha e devolve em que tentativa estamos.
 *
 * Estava escrito em três lugares com três textos diferentes; um deles esquecia
 * de incrementar o contador, e um job podia bater a cabeça sem nunca chegar no
 * teto de três.
 */
async function marcarFalha(
  supabase: SupabaseClient,
  job: { id: string; external_report_attempts?: number | null },
  motivo: string,
): Promise<number> {
  const tentativas = Number(job.external_report_attempts ?? 0) + 1;
  await supabase
    .from("jobs")
    .update({
      external_report_started_at: null,
      external_report_error: motivo,
      external_report_attempts: tentativas,
    })
    .eq("id", job.id);
  return tentativas;
}

/**
 * Escreve o motivo no card SEM gastar tentativa.
 *
 * A rota HTTP dispara o envio e devolve 202 na hora, porque preencher demora
 * meio minuto. Só que os bloqueios descobertos DEPOIS desse 202 (foto faltando,
 * relatório sem descrição) não tinham como voltar: o motivo era calculado,
 * devolvido para ninguém, e o card continuava mostrando o erro da véspera. Do
 * lado de quem clicou, o botão não fazia nada.
 *
 * Tentativa não conta porque não houve tentativa: ninguém abriu a Housekeep.
 * O teto de três existe para o robô não bater a cabeça, e bater a cabeça é
 * outra coisa: é chegar lá e ser recusado.
 */
async function gravarMotivo(supabase: SupabaseClient, jobId: string, motivo: string): Promise<void> {
  await supabase
    .from("jobs")
    .update({ external_report_error: motivo, external_report_started_at: null })
    .eq("id", jobId);
}

/**
 * Quantas fotos temos, na mesma chave que a Housekeep usa para cobrar.
 *
 * No formulário de limpeza a conta é por cômodo, porque a exigência é por
 * cômodo. No de trade existe um balde só por metade, e a chave é `all`.
 *
 * Relatório de limpeza com lista plana (o caso do JOB-9450, digitado no
 * template chapado) cai em `all` de propósito: aí toda contagem por cômodo dá
 * zero, e a mensagem de falta diz cômodo a cômodo o que precisa chegar. É
 * exatamente o que se quer saber antes de mandar alguém voltar na casa.
 */
function contarPorChave(report: unknown, limpeza: boolean): Record<string, number> {
  if (limpeza) {
    const mapa = fotosPorComodo(report);
    if (mapa) {
      return Object.fromEntries(Object.entries(mapa).map(([chave, urls]) => [chave, urls.length]));
    }
  }
  return { all: urlsDeFoto(report).length };
}

/** "26 Aug, 10:47" em Londres — o ISO cru com microssegundos era ilegível. */
export function quandoLondres(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** 106.2 → "1m 46s"; 34 → "34s". */
function duracao(segundos: number | undefined): string | null {
  if (!segundos || !Number.isFinite(segundos)) return null;
  const s = Math.round(segundos);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const CORES = {
  ok: { faixa: "#12704F", fundo: "#E9F7F0", selo: "OK" },
  erro: { faixa: "#A32D2D", fundo: "#FDECEA", selo: "FAILED" },
} as const;

/**
 * O aviso interno com a cara da casa, em inglês.
 *
 * Era um `<p>` cru em português — funcionava, mas destoava de todo email que
 * sai daqui e o Gmail ainda oferecia tradução em cima. Mesmo layout dos emails
 * do parceiro (band navy + logo), um selo de cor dizendo o desfecho antes de
 * qualquer leitura, e o botão como única ação.
 */
export function avisoHtml(opts: {
  tom: keyof typeof CORES;
  titulo: string;
  jobLinha: string;
  detalhes: string[];
  link?: string | null;
  rotuloDoLink?: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cor = CORES[opts.tom];
  const fonte = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const detalhes = opts.detalhes
    .map((d) => `<p style="margin:0 0 8px 0; ${fonte}; font-size:14px; line-height:21px; color:#3E3E4A;">${esc(d)}</p>`)
    .join("");
  const botao =
    opts.link && opts.rotuloDoLink
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
           <td align="center" bgcolor="#020040" style="border-radius:8px;">
             <a href="${esc(opts.link)}" target="_blank" style="display:inline-block; padding:11px 22px; ${fonte}; font-size:13.5px; font-weight:600; color:#FFFFFF; text-decoration:none;">${esc(opts.rotuloDoLink)}</a>
           </td></tr></table>`
      : "";
  return `<!DOCTYPE html>
<html lang="en"><head>${partnerEmailHeadBlock()}${partnerEmailBaseStyles()}</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(opts.titulo)}
${partnerEmailOuterTableOpen()}
${partnerEmailLogoHeaderRow()}
      <tr><td class="px-mobile" style="padding:28px 40px 32px 40px;">
        <p style="margin:0 0 12px 0;"><span style="display:inline-block; padding:3px 10px; border-radius:999px; background:${cor.fundo}; ${fonte}; font-size:11px; font-weight:700; letter-spacing:0.6px; color:${cor.faixa};">${cor.selo}</span></p>
        <h1 class="h1-mobile" style="margin:0 0 6px 0; ${fonte}; font-size:24px; line-height:31px; font-weight:700; color:#0A0A1F; letter-spacing:-0.4px;">${esc(opts.titulo)}</h1>
        <p style="margin:0 0 16px 0; ${fonte}; font-size:13px; line-height:19px; color:#6B6B70;">${esc(opts.jobLinha)}</p>
        ${detalhes}
        ${botao}
      </td></tr>
${partnerEmailOuterTableClose()}
</body></html>`;
}

export async function avisar(assunto: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return;
  try {
    await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
      to: [AVISAR],
      subject: assunto,
      html,
    });
  } catch (err) {
    console.error("[stefane] email falhou:", err);
  }
}

/**
 * Roda o envio de um job. Retorna quando termina, e quem chama decide se
 * espera: a rota HTTP dispara sem aguardar para não segurar o clique por meio
 * minuto, e o card acompanha pelas colunas.
 */
export async function enviarRelatorioExterno(
  supabase: SupabaseClient,
  jobId: string,
  opcoes?: OpcoesDeEnvio,
): Promise<{ estado: EstadoEnvio; motivo?: string; segundos?: number }> {
  const marca: MarcaDeTrava = { travou: false };
  try {
    return await executarEnvio(supabase, jobId, opcoes, marca);
  } catch (err) {
    return registrarEnvioExplodido(supabase, jobId, err, marca, opcoes?.simular);
  }
}

/** Quem chama sabe se a trava chegou a ser tomada. Ver `registrarEnvioExplodido`. */
type MarcaDeTrava = { travou: boolean };

/**
 * O envio que explodiu por fora do fluxo previsto, escrito no card em vez de
 * sumir.
 *
 * `enviarRelatorioExterno` sempre foi disparada e esquecida (`void ... .catch`)
 * porque preencher demora meio minuto e ninguém segura o clique. Só que o
 * `.catch` da rota apenas imprimia no console: um `throw` daqui de dentro
 * (Playwright pendurado, storage recusando assinatura, Housekeep fora do ar)
 * deixava `started_at` gravado, `external_report_error` nulo e tentativa em
 * zero. Do lado de fora era um "enviando" silencioso, sem email e sem log no
 * card. Foi o que aconteceu com o JOB-9520 em 27/08.
 *
 * Tentativa só conta se a trava chegou a ser tomada: explodir antes disso é
 * não ter tentado, e gastar tentativa por isso empurraria o job para o teto de
 * três sem nunca ter aberto a Housekeep.
 */
async function registrarEnvioExplodido(
  supabase: SupabaseClient,
  jobId: string,
  err: unknown,
  marca: MarcaDeTrava,
  simular?: boolean,
): Promise<{ estado: EstadoEnvio; motivo: string }> {
  const motivo = `unexpected error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400);
  console.error("[stefane] envio explodiu:", err);

  const { data: job } = await supabase
    .from("jobs")
    .select("id, reference, title, client_name, report_link, external_report_attempts")
    .eq("id", jobId)
    .maybeSingle();
  const j = (job ?? {}) as Record<string, unknown>;

  // Dry run não conta tentativa nem grava erro: ele não tocou na Housekeep.
  if (simular) {
    await supabase.from("jobs").update({ external_report_started_at: null }).eq("id", jobId);
    return { estado: "falhou", motivo };
  }

  const tentativas = marca.travou
    ? await marcarFalha(supabase, (job ?? { id: jobId }) as never, motivo)
    : (await gravarMotivo(supabase, jobId, motivo), null);

  await avisar(
    `${j.reference ?? "job"} · report did NOT land on Housekeep`,
    avisoHtml({
      tom: "erro",
      titulo: "Report did not land on Housekeep",
      jobLinha: [j.reference, j.title, j.client_name].filter(Boolean).join(" · "),
      detalhes: [
        `Reason: ${motivo}`,
        tentativas === null
          ? "It broke before opening the form, so no attempt was used."
          : `Attempt ${tentativas} of ${MAX_TENTATIVAS}.`,
      ],
      link: (j.report_link as string | null) ?? null,
      rotuloDoLink: "Open the form and send it by hand",
    }),
  );
  return { estado: "falhou", motivo };
}

async function executarEnvio(
  supabase: SupabaseClient,
  jobId: string,
  opcoes: OpcoesDeEnvio | undefined,
  marca: MarcaDeTrava,
): Promise<{ estado: EstadoEnvio; motivo?: string; segundos?: number }> {
  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return { estado: "nao_elegivel", motivo: "job not found" };

  const bloqueio = motivoNaoElegivel(job as never);
  if (bloqueio) return { estado: "nao_elegivel", motivo: bloqueio };

  /**
   * Na VERCEL ninguém envia: o Playwright não existe numa function serverless.
   *
   * O clique de produção (27/08, JOB-9519) tentava mesmo assim e explodia com
   * "Cannot find module /var/task/.../browsers.json" — queimando tentativa
   * atrás de tentativa num erro que nunca vai mudar. É o mesmo desenho do
   * Express: o site diz o que fazer, quem tem o navegador faz. O worker do Mac
   * (`scripts/stefane-worker.mts`, launchd) varre os elegíveis e envia daqui a
   * pouco; devolver "enviando" é verdade, só que o remetente é outro processo.
   *
   * ANTES da trava, de propósito: enfileirar não é tentar, e não pode nem
   * gastar tentativa nem deixar `started_at` armado para o worker esbarrar.
   */
  if (process.env.VERCEL) {
    return {
      estado: "enviando",
      motivo: "queued for the office sender (the browser only runs there); it picks the job up within 2 minutes",
    };
  }

  const j = job as unknown as Record<string, unknown>;

  /**
   * O formulário DELES antes de qualquer coisa, e sem browser.
   *
   * Três perguntas se respondem aqui, e nenhuma delas a tela sabia responder:
   * já foi submetido, qual dos dois formulários é, e quanta foto cada campo
   * exige. Fazer isso antes de abrir o Playwright é o que impede gastar 35
   * segundos e uma tentativa para descobrir no fim que faltava foto.
   */
  const busca = await buscarFormulario(String(j.report_link));
  if (!busca.ok) {
    // 404 é relatório que sumiu do lado deles: retentar não traz de volta.
    if (busca.sumiu) {
      await marcarFalha(supabase, job as never, busca.motivo);
      return { estado: "falhou", motivo: busca.motivo };
    }
    // Rede ruim não gasta tentativa: o job continua na fila como estava.
    return { estado: "nao_elegivel", motivo: busca.motivo };
  }
  const form = busca.form;

  /**
   * Já entrou lá: sucesso de verdade, com a data deles, sem submeter por cima.
   *
   * É o `jaEstava` que a tela tentava adivinhar por ausência de campo. A
   * diferença é que agora vem do `submitted_at` da Housekeep.
   */
  if (form.submetidoEm) {
    await supabase
      .from("jobs")
      .update({
        external_report_submitted_at: form.submetidoEm,
        external_report_started_at: null,
        external_report_error: null,
      })
      .eq("id", jobId);
    await avisar(
      `${j.reference} · report was already on Housekeep`,
      avisoHtml({
        tom: "ok",
        titulo: "Report already on Housekeep",
        jobLinha: [j.reference, j.title, j.client_name].filter(Boolean).join(" · "),
        detalhes: [
          `Housekeep already had this report since ${quandoLondres(String(form.submetidoEm))}. Nothing was re-sent.`,
        ],
        link: form.url,
        rotuloDoLink: "Open the report on Housekeep",
      }),
    );
    return { estado: "enviado" };
  }

  /**
   * A FORMA vem da página, não do template que alguém digitou.
   *
   * Esta linha é o conserto do JOB-9450. Antes, `ehLimpeza` lia o template do
   * relatório para escolher o payload, enquanto o preenchimento escolhia o
   * formulário pela página: relatório `general` num job de limpeza produzia um
   * payload de trade entrando no formulário de limpeza com um `as`. Todo campo
   * de limpeza virava `undefined`, ou seja "No", inclusive "Is the job
   * complete?", e a Housekeep recusava o envio inteiro.
   */
  const forma = formaDoFormularioAPI(form);
  if (!forma) {
    const motivo = `the client platform form changed: ${form.perguntas.length} questions, none recognised`;
    await marcarFalha(supabase, job as never, motivo);
    return { estado: "falhou", motivo };
  }
  const limpeza = forma === "limpeza";
  if (limpeza !== ehLimpeza(j)) {
    console.warn(
      `[stefane] ${j.reference}: relatório digitado como ${ehLimpeza(j) ? "limpeza" : "trade"} ` +
        `mas o formulário da plataforma é ${forma}. Seguindo o formulário.`,
    );
  }

  const base = {
    inicio: (j.partner_timer_started_at as string | null) ?? null,
    fim: (j.partner_timer_ended_at as string | null) ?? null,
  };
  const montado = limpeza
    ? payloadLimpeza({ start: j.start_report as never, final: j.final_report as never, ...base })
    : payloadDoReport({ final: j.final_report as never, start: j.start_report as never, ...base });

  if (!montado.ok) {
    await gravarMotivo(supabase, jobId, montado.motivo);
    return { estado: "nao_elegivel", motivo: montado.motivo };
  }

  /**
   * Foto conferida contra o mínimo DELES, campo a campo, antes de submeter.
   *
   * O formulário de limpeza pede 5 de sala, 3 de corredor, 5 de cozinha, 5 de
   * banheiro e 5 de quarto. Um relatório com 20 fotos soltas não passa, e até
   * aqui a gente só descobria isso depois do Submit, com uma recusa que não
   * dizia qual campo. Bloquear antes devolve a lista exata do que falta, que é
   * o que dá para pedir ao parceiro no mesmo dia.
   */
  /**
   * Cliente recusou foto: a Housekeep some com os treze campos, então
   * `slotsDeFoto` já devolve lista vazia e `faltasDeFoto` não acha nada para
   * cobrar. A checagem explícita fica aqui mesmo assim, porque depender de um
   * efeito colateral do formulário deles é depender de coisa que eles mudam.
   */
  const recusouFotos = Boolean((j.start_report as { photos_refused?: unknown } | null)?.photos_refused);
  const faltas = recusouFotos ? [] : faltasDeFoto(form, {
    antes: contarPorChave(j.start_report, limpeza),
    depois: contarPorChave(j.final_report, limpeza),
  });
  /**
   * O mínimo por cômodo é NOSSO, lido do formulário deles uma vez. Quando ele
   * barra um job que não dá para consertar (foto de chegada não se refaz), a
   * pergunta que sobra é se a Housekeep recusaria mesmo, ou se a nossa tabela é
   * que está mais dura que a página.
   *
   * `ignorarMinimoDeFotos` responde isso perguntando à fonte: preenche o
   * formulário deles e conta os campos que a PÁGINA marca como inválidos.
   *
   * Só vale em dry run, e isso é trava de desenho, não conveniência: valendo,
   * ele mandaria um relatório que já sabemos incompleto, e a checagem existe
   * justamente para isso não acontecer. Quem quer enviar assim mesmo tem o
   * formulário deles e a mão.
   */
  const pularMinimo = Boolean(opcoes?.ignorarMinimoDeFotos && opcoes?.simular);
  if (faltas.length > 0 && !pularMinimo) {
    // Cinco linhas cabem no card. O resto vira contagem, porque a lista inteira
    // de treze campos empurra o motivo para fora da tela e ninguém lê nenhum.
    const mostrar = faltas.slice(0, 5).join("; ");
    const resto = faltas.length > 5 ? ` and ${faltas.length - 5} more` : "";
    const motivo = `the client platform requires more photos. ${mostrar}${resto}`;
    await gravarMotivo(supabase, jobId, motivo);
    return { estado: "nao_elegivel", motivo };
  }
  if (faltas.length > 0) {
    console.log(`[stefane] ensaio ignorando o nosso mínimo: ${faltas.join("; ")}`);
  }

  /**
   * Trava de concorrência COM VALIDADE: só um envio por job por vez, mas trava
   * de processo morto não é trava, é beco.
   *
   * A condição era `started_at IS NULL` e mais nada. Bastava o processo morrer
   * no meio do envio (deploy, reload do dev server, Playwright pendurado) para
   * `started_at` ficar gravado para sempre: o card mostrava "enviando" eterno,
   * e toda tentativa seguinte batia aqui e voltava "a submission is already
   * running". Sem erro, sem tentativa contada, sem saída — o JOB-9520 entrou
   * nisso em 27/08 e a Housekeep nunca recebeu nada.
   *
   * Agora a trava vale por `ENVIO_TRAVADO_MS`. Passou disso, quem chega assume.
   *
   * Em DOIS passos, e isso não é preciosismo: `.or()` num UPDATE do PostgREST
   * escreve a linha e devolve representação VAZIA. O primeiro desenho disto
   * era um `.or(is.null, lt.limite)` só, e o `data` voltava nulo mesmo tendo
   * gravado: o código lia "não travei", devolvia "a submission is already
   * running" e ia embora, deixando a trava recém-carimbada para trás. Cada
   * tentativa re-armava a trava e desistia. Era isso que fazia o relatório não
   * subir sozinho de jeito nenhum.
   *
   * Passo 1 solta a trava vencida. Passo 2 é o CAS de sempre, com filtro
   * simples, que o PostgREST devolve direito. Dois processos podem soltar a
   * mesma trava vencida; só um ganha o passo 2, que é o que importa.
   */
  const limiteDeTrava = new Date(Date.now() - ENVIO_TRAVADO_MS).toISOString();
  await supabase
    .from("jobs")
    .update({ external_report_started_at: null })
    .eq("id", jobId)
    .lt("external_report_started_at", limiteDeTrava);

  const { data: travado } = await supabase
    .from("jobs")
    .update({ external_report_started_at: new Date().toISOString(), external_report_error: null })
    .eq("id", jobId)
    .is("external_report_started_at", null)
    .select("id")
    .maybeSingle();
  if (!travado) return { estado: "enviando", motivo: "a submission is already running" };
  // Daqui para a frente, explodir gasta tentativa: a Housekeep foi aberta.
  marca.travou = true;

  // O bloco "before" da Housekeep é o report de chegada; o "after", o final.
  const [fotosAntes, fotosDepois] = await Promise.all([
    assinarFotos(supabase, urlsDeFoto(j.start_report)),
    assinarFotos(supabase, urlsDeFoto(j.final_report)),
  ]);

  // Mapa por cômodo quando o report foi preenchido no formulário de limpeza:
  // é ele que alimenta os treze campos da Housekeep. Assinar cada lista, e não
  // a lista achatada, porque a URL assinada é por arquivo.
  const assinarMapa = async (mapa: Record<string, string[]> | null) => {
    if (!mapa) return undefined;
    const out: Record<string, string[]> = {};
    for (const [chave, urls] of Object.entries(mapa)) out[chave] = await assinarFotos(supabase, urls);
    return out;
  };
  const [antesPorComodo, depoisPorComodo] = await Promise.all([
    assinarMapa(fotosPorComodo(j.start_report)),
    assinarMapa(fotosPorComodo(j.final_report)),
  ]);

  /**
   * O teto de cada campo, tirado do formulário deles e não de um número nosso.
   * "Cleaning equipment" aceita duas fotos; o teto global de 20 mandaria cinco
   * e o campo voltaria recusado.
   */
  const maxPorChave: Record<string, number> = {};
  for (const slot of slotsDeFoto(form)) {
    maxPorChave[slot.chave] = Math.min(maxPorChave[slot.chave] ?? slot.max, slot.max);
  }

  const res = await submeterRelatorioHousekeep({
    url: form.url,
    forma,
    payload: montado.payload,
    fotos: { antes: fotosAntes, depois: fotosDepois, antesPorComodo, depoisPorComodo, maxPorChave },
    simular: opcoes?.simular,
  });

  const ref = String(j.reference);
  const link = form.url;

  /**
   * O veredito é da Housekeep, não do Playwright.
   *
   * Mesmo quando o Submit parece ter dado certo, quem diz que entrou é o
   * `submitted_at` da API deles. É a diferença entre carimbar um job como
   * entregue e ter entregue: até 20/08/2026 a tela adivinhava pelo texto da
   * página, e adivinhou errado pelo menos uma vez (JOB-9437).
   */
  const confirmado = opcoes?.simular ? null : await confirmarSubmissao(link);

  if (confirmado) {
    await supabase
      .from("jobs")
      .update({
        external_report_submitted_at: confirmado,
        external_report_started_at: null,
        external_report_error: null,
      })
      .eq("id", jobId);

    await avisar(
      `${ref} · report submitted on Housekeep`,
      avisoHtml({
        tom: "ok",
        titulo: "Report submitted on Housekeep",
        jobLinha: [ref, j.title, j.client_name].filter(Boolean).join(" · "),
        detalhes: [
          `Housekeep confirmed it at ${quandoLondres(confirmado)}${duracao(res.segundos) ? ` · took ${duracao(res.segundos)}` : ""}.`,
        ],
        link,
        rotuloDoLink: "Open the report on Housekeep",
      }),
    );
    return { estado: "enviado", segundos: res.segundos };
  }

  /**
   * Playwright feliz e Housekeep sem `submitted_at` é FALHA, e é a falha mais
   * cara que existe aqui: é exatamente o caso em que o job saía da fila com o
   * relatório para trás. Vale a pena o falso negativo, porque retentar é
   * barato e um relatório perdido não volta.
   */
  const motivo = res.ok
    ? "the submit went through on screen but the client platform has no report: it did not land"
    : res.motivo;

  // Dry run não conta tentativa nem grava erro: ele não tocou na Housekeep.
  if (opcoes?.simular) {
    await supabase.from("jobs").update({ external_report_started_at: null }).eq("id", jobId);
    return { estado: "falhou", motivo, segundos: res.segundos };
  }

  const tentativas = await marcarFalha(supabase, job as never, motivo);

  await avisar(
    `${ref} · report did NOT land on Housekeep`,
    avisoHtml({
      tom: "erro",
      titulo: "Report did not land on Housekeep",
      jobLinha: [ref, j.title, j.client_name].filter(Boolean).join(" · "),
      detalhes: [`Reason: ${motivo}`, `Attempt ${tentativas} of ${MAX_TENTATIVAS}.`],
      link,
      rotuloDoLink: "Open the form and send it by hand",
    }),
  );
  return { estado: "falhou", motivo, segundos: res.segundos };
}

/**
 * O que a Stefane vai preencher, sem abrir browser e sem tocar na Housekeep.
 *
 * Existe para os primeiros jobs, em que ver antes vale mais que velocidade: o
 * dono confere campo a campo na tela do OS e só então manda enviar. Depois de
 * confiar, o mesmo botão pode ir direto.
 */
export async function previewEnvio(
  supabase: SupabaseClient,
  jobId: string,
): Promise<
  | { ok: true; forma: "trade" | "limpeza"; campos: Array<{ rotulo: string; valor: string }>; avisos: string[] }
  | { ok: false; motivo: string }
> {
  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, motivo: "job not found" };

  const bloqueio = motivoNaoElegivel(job as never);
  if (bloqueio) return { ok: false, motivo: bloqueio };

  const j = job as unknown as Record<string, unknown>;
  const limpeza = ehLimpeza(j);
  const base = {
    inicio: (j.partner_timer_started_at as string | null) ?? null,
    fim: (j.partner_timer_ended_at as string | null) ?? null,
  };
  const montado = limpeza
    ? payloadLimpeza({ start: j.start_report as never, final: j.final_report as never, ...base })
    : payloadDoReport({ final: j.final_report as never, start: j.start_report as never, ...base });
  if (!montado.ok) return { ok: false, motivo: montado.motivo };

  const p = montado.payload as Record<string, unknown>;
  const simNao = (v: unknown) => (v ? "Yes" : "No");
  const CONCLUSOES = [
    "Yes, no further work required",
    "No, more time is needed",
    "No, specialist materials needed",
    "No, job scope different to booked work",
  ];
  const FEEDBACKS = ["Bad", "Okay", "Good"];

  const campos: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Start time", valor: String(p.inicio ?? "(blank)") },
    { rotulo: "Finish time", valor: String(p.fim ?? "(blank)") },
  ];

  if (limpeza) {
    campos.push(
      { rotulo: "Changes to original job scope?", valor: simNao(p.escopoMudou) },
      { rotulo: "Any pre-existing damage?", valor: simNao(p.danoPrevio) },
      { rotulo: "Customer refused photos?", valor: simNao(p.recusouFotos) },
      { rotulo: "Is the job complete?", valor: simNao(p.jobCompleto) },
      { rotulo: "Customer/landlord inspected?", valor: simNao(p.clienteInspecionou) },
    );
  } else {
    campos.push(
      { rotulo: "Description of work done", valor: String(p.descricao ?? "") },
      { rotulo: "Any additional charges?", valor: simNao(p.cobrancaExtra) },
      { rotulo: "Job complete?", valor: CONCLUSOES[Number(p.conclusao) || 0] },
      { rotulo: "What still needs completing?", valor: String(p.faltaFazer ?? "(blank)") },
      { rotulo: "Follow up required?", valor: simNao(p.precisaRetorno) },
    );
  }

  campos.push(
    { rotulo: "Recommend additional services?", valor: simNao(p.recomendaServicos) },
    { rotulo: "Feedback for Housekeep", valor: FEEDBACKS[Number(p.feedback) ?? 2] },
  );

  // Dado que passa na validação mas embaraça na frente do cliente. Não bloqueia
  // o envio, porque a decisão é do dono: o JOB-9123 tinha "K" como descrição do
  // trabalho e o timer terminando antes de começar, e nenhum dos dois é
  // impedimento técnico, só coisa que ninguém quer mandar para a Housekeep.
  const avisos: string[] = [];
  const desc = String(p.descricao ?? "");
  if (!limpeza && desc.length > 0 && desc.trim().length < 15) {
    avisos.push(`the work description is only ${desc.trim().length} characters: "${desc.trim()}"`);
  }
  if (p.inicio && p.fim && String(p.fim) < String(p.inicio)) {
    avisos.push(`the finish time is before the start (${p.inicio} → ${p.fim}): the partner timer was left running`);
  }
  if (!p.inicio || !p.fim) {
    avisos.push("no start or finish time: the client platform will get the field blank");
  }

  return { ok: true, forma: limpeza ? "limpeza" : "trade", campos, avisos };
}

/**
 * A fila do dia: job em `final_check` cujo relatório final chegou hoje e que
 * ainda não subiu. É o que o botão do card oferece e o que uma varredura futura
 * poderia percorrer sem tocar em histórico antigo.
 */
export async function filaDeHoje(supabase: SupabaseClient): Promise<Array<{ id: string; reference: string }>> {
  const hoje = new Date();
  const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
  const { data } = await supabase
    .from("jobs")
    .select("id, reference, final_report_submitted, report_link, external_report_submitted_at, updated_at")
    .eq("status", "final_check")
    .eq("final_report_submitted", true)
    .is("external_report_submitted_at", null)
    .is("external_report_manual_at", null)
    .not("report_link", "is", null)
    .gte("updated_at", inicioDoDia);
  return (data ?? []).map((j) => ({ id: String(j.id), reference: String(j.reference) }));
}
