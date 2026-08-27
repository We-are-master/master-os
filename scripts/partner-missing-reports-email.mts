/**
 * O disparo das 20h (Londres): cobra do parceiro os relatórios que faltam.
 *
 *   npx tsx scripts/partner-missing-reports-email.mts            # ENSAIO: lista e não manda
 *   npx tsx scripts/partner-missing-reports-email.mts --enviar   # manda de verdade
 *
 * Sem `--enviar` nada sai. É a mesma trava do email das 17h e existe pelo
 * mesmo motivo: rodar isto para "ver se funciona" acorda parceiro de verdade.
 *
 * Um email por parceiro por dia (estado em `.missing-reports-sent.json`, como
 * o Harvey). Ninguém com report pendente = silêncio, nenhum email vazio.
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}

const ENVIAR = process.argv.includes("--enviar");
const SO_ESTE = process.argv.find((a) => a.startsWith("--parceiro="))?.split("=")[1]?.toLowerCase();
const MAX_ENVIOS_POR_RODADA = 30;
const SENT_PATH = "scripts/.missing-reports-sent.json";

const [{ createServiceClient }, { buildPartnerMissingReportsEmail }, { resolvePartnerTradePortalBaseUrl }, { createPartnerReportToken }, { appBaseUrl }] =
  await Promise.all([
    import("../src/lib/supabase/service"),
    import("../src/lib/emails/partner-missing-reports-email"),
    import("../src/lib/trade-auth"),
    import("../src/lib/quote-response-token"),
    import("../src/lib/app-base-url"),
  ]);

const supabase = createServiceClient();
const portalUrl = resolvePartnerTradePortalBaseUrl();
const base = appBaseUrl();

/**
 * A janela é de LONDRES, não da máquina.
 *
 * O Mac roda em UTC-3 e o Reino Unido troca de BST para GMT no fim de outubro,
 * então uma hora fixa no launchd escorrega uma hora no inverno. O launchd
 * dispara nas duas horas candidatas (16h e 17h locais) e quem decide se é hora
 * é este guarda, lendo o relógio de Londres. A trava de um-por-dia impede que
 * as duas passadas mandem dois emails.
 *
 * A janela começa às 20h EXATAS e não às 19h de propósito: no inverno a
 * passada das 16h locais cai às 19h de Londres, e se a janela abrisse ali o
 * email sairia uma hora cedo o inverno inteiro. Assim, no verão quem manda é a
 * passada das 16h (20h em Londres) e no inverno a das 17h. O teto às 22h é
 * para um Mac que acordou tarde ainda mandar, sem cobrar ninguém de
 * madrugada.
 */
const horaLondres = Number(
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()),
);
const foraDaJanela = ENVIAR && (horaLondres < 20 || horaLondres >= 22);
const ENVIAR_AGORA = ENVIAR && !foraDaJanela;
if (foraDaJanela) {
  console.log(`[reports] fora da janela (20h-22h de Londres, agora ${horaLondres}h): só listando, nada sai.`);
}

/** O dia em Londres, que é a chave da trava de um-por-dia. */
const partes = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const peca = (t: string) => partes.find((p) => p.type === t)!.value;
const hojeLondres = `${peca("year")}-${peca("month")}-${peca("day")}`;

let enviados: Record<string, boolean> = {};
try {
  enviados = JSON.parse(readFileSync(SENT_PATH, "utf8")) as Record<string, boolean>;
} catch { /* primeiro dia */ }

/**
 * Quem entra na cobrança: SÓ quem está em Final check.
 *
 * O status é a fronteira do que ainda é do parceiro. Job que já passou dali
 * (awaiting payment, completed) seguiu adiante por outro caminho, e cobrar
 * relatório de trabalho que o escritório já fechou é pedir o que ninguém mais
 * espera: o parceiro abre o link, não entende, e para de ler o email na
 * próxima vez. Sem nada em Final check, ninguém recebe nada.
 *
 * `final_report_skipped` fica de FORA pelo mesmo motivo: dispensa é decisão do
 * escritório, e cobrar o que a gente mesmo dispensou queima o email inteiro.
 * `report_submitted` é o campo legado dos jobs anteriores à mig 168.
 */
const { data: jobs, error } = await supabase
  .from("jobs")
  .select(
    "id, reference, title, property_address, client_name, scheduled_date, partner_id, partner_cost, " +
      "final_report_submitted, report_submitted, final_report_skipped",
  )
  .not("partner_id", "is", null)
  .eq("status", "final_check")
  .is("deleted_at", null)
  .order("scheduled_date", { ascending: true })
  .limit(500);
if (error) throw new Error(error.message);

const pendentes = (jobs ?? []).filter(
  (j) => !j.final_report_submitted && !j.report_submitted && !j.final_report_skipped,
);

const porParceiro = new Map<string, typeof pendentes>();
for (const j of pendentes) {
  const k = String(j.partner_id);
  porParceiro.set(k, [...(porParceiro.get(k) ?? []), j]);
}

console.log(
  `[reports] ${hojeLondres}: ${pendentes.length} report(s) pendente(s) em ${porParceiro.size} parceiro(s) · modo ${ENVIAR_AGORA ? "ENVIO" : "ENSAIO"}`,
);
if (porParceiro.size === 0) {
  console.log("[reports] nada pendente, nenhum email.");
  process.exit(0);
}

const { data: parceiros } = await supabase
  .from("partners")
  .select("id, contact_name, company_name, email")
  .in("id", [...porParceiro.keys()]);

const hoje = new Date();
const diasDesde = (iso: string | null): number => {
  if (!iso) return 0;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return Math.max(0, Math.round((hoje.getTime() - d.getTime()) / 86_400_000));
};
const rotuloDeData = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${String(iso).slice(0, 10)}T12:00:00Z`))
    : "No date";
/** £1121 sai "£1,121.00": numero de milhar sem separador no assunto le mal. */
const libras = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const { Resend } = await import("resend");
const resendKey = process.env.RESEND_API_KEY?.trim();
if (ENVIAR_AGORA && !resendKey) throw new Error("RESEND_API_KEY ausente: não dá para enviar");

let ok = 0;
let pulados = 0;
let falhas = 0;

for (const p of parceiros ?? []) {
  const lista = porParceiro.get(String(p.id)) ?? [];
  const nome = (p.company_name as string | null)?.trim() || (p.contact_name as string | null)?.trim() || "Partner";
  if (SO_ESTE && !nome.toLowerCase().includes(SO_ESTE)) continue;

  const email = (p.email as string | null)?.trim();
  if (!email) {
    pulados++;
    console.log(`· ${nome}: ${lista.length} report(s) pendente(s), SEM EMAIL cadastrado`);
    continue;
  }

  const chave = `${hojeLondres}:${p.id}`;
  if (ENVIAR_AGORA && enviados[chave]) {
    pulados++;
    console.log(`· ${nome}: já recebeu hoje, pulando`);
    continue;
  }
  if (ok >= MAX_ENVIOS_POR_RODADA) {
    console.log("[reports] teto da rodada atingido, o resto sai amanhã");
    break;
  }

  const total = lista.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0);
  const montado = buildPartnerMissingReportsEmail({
    partnerFirstName: ((p.contact_name as string | null)?.trim() || nome).split(" ")[0]!,
    onHoldDisplay: total > 0 ? libras(total) : null,
    portalUrl,
    jobs: lista.map((j) => ({
      reference: String(j.reference ?? ""),
      title: String(j.title ?? "Job"),
      address: String(j.property_address ?? ""),
      clientFirstName: String(j.client_name ?? "").trim().split(" ")[0] || null,
      dateLabel: rotuloDeData(j.scheduled_date as string | null),
      daysWaiting: diasDesde(j.scheduled_date as string | null),
      payDisplay: Number(j.partner_cost ?? 0) > 0 ? libras(Number(j.partner_cost)) : null,
      reportUrl: `${base}/job/report?token=${encodeURIComponent(
        createPartnerReportToken(String(j.id), String(j.partner_id)),
      )}`,
    })),
  });

  if (!ENVIAR_AGORA) {
    console.log(`· ${nome} <${email}>: ${lista.length} report(s) · ${libras(total)} · assunto: "${montado.subject}"`);
    const htmlDir = process.env.REPORTS_HTML_DIR?.trim();
    if (htmlDir) {
      writeFileSync(`${htmlDir}/reports-${nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`, montado.html);
    }
    continue;
  }

  try {
    const { error: erroEnvio } = await new Resend(resendKey!).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
      to: [email],
      // A resposta volta para o Zendesk, onde o time e o Harvey já trabalham.
      replyTo: "support@getfixfy.com",
      subject: montado.subject,
      html: montado.html,
      text: montado.text,
    });
    if (erroEnvio) throw new Error(erroEnvio.message ?? "send failed");
    enviados[chave] = true;
    writeFileSync(SENT_PATH, JSON.stringify(enviados));
    ok++;
    console.log(`✓ ${nome} <${email}>: ${lista.length} report(s) cobrados`);
  } catch (err) {
    falhas++;
    console.error(`✗ ${nome}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`[reports] fim: ${ok} enviado(s), ${pulados} pulado(s), ${falhas} falha(s)`);
