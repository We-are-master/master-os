/**
 * O email das 17h: cada parceiro com job AMANHÃ recebe o dia dele, na ordem.
 *
 *   npx tsx scripts/partner-tomorrow-email.mts             # ensaio: mostra, não envia
 *   npx tsx scripts/partner-tomorrow-email.mts --enviar    # envia de verdade
 *
 * Regras da casa: nasce em ensaio (lição de 20/08); um envio por parceiro por
 * dia (estado em .tomorrow-sent.json, como o Harvey); dia vazio = silêncio.
 * Parceiro com casa cadastrada vê a rota (Directions multi-parada); sem casa,
 * a lista limpa em ordem de chegada. Earnings exato quando o dia é todo de
 * preço combinado; "Potential earnings £X+" quando tem hourly no meio.
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
const MAX_ENVIOS_POR_RODADA = 30;
const SENT_PATH = "scripts/.tomorrow-sent.json";

const [{ createServiceClient }, { formatPartnerJobPriceDisplay }, { buildPartnerTomorrowEmail }, { resolvePartnerTradePortalBaseUrl }, { getOptimizedStopOrder }, { geocodeUkAddressServer }] =
  await Promise.all([
    import("../src/lib/supabase/service"),
    import("../src/lib/job-pricing-resolver"),
    import("../src/lib/emails/partner-tomorrow-email"),
    import("../src/lib/trade-auth"),
    import("../src/lib/mapbox-directions"),
    import("../src/lib/job-geocode-server"),
  ]);

const supabase = createServiceClient();
const portalUrl = resolvePartnerTradePortalBaseUrl();

// Amanhã em LONDRES, imune ao fuso da máquina (o Mac roda em UTC-3 e o
// truque de re-parsear toLocaleString somava o deslocamento DUAS vezes no
// rótulo: em 25/08 os parceiros receberam os jobs certos de quarta com o
// cabeçalho dizendo quinta). Agora: partes do calendário via Intl direto no
// fuso de Londres, +1 dia em aritmética UTC, e o rótulo formatado em UTC a
// partir do meio-dia — sem segunda conversão em lugar nenhum.
const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const pega = (t: string) => Number(parts.find((x) => x.type === t)?.value);
const hojeLondresYmd = `${pega("year")}-${String(pega("month")).padStart(2, "0")}-${String(pega("day")).padStart(2, "0")}`;
const dataForcada = process.argv.find((a) => a.startsWith("--data="))?.slice(7) ?? null;
const alvoUtc = dataForcada
  ? new Date(`${dataForcada}T12:00:00Z`)
  : new Date(Date.UTC(pega("year"), pega("month") - 1, pega("day"), 12) + 24 * 3600 * 1000);
const ymd = alvoUtc.toISOString().slice(0, 10);
const dateLabel = alvoUtc.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** "today" quando o alvo já é o dia corrente em Londres (correção pós-meia-noite). */
const dayWord: "today" | "tomorrow" = ymd === hojeLondresYmd ? "today" : "tomorrow";
const MODO_CORRECAO = process.argv.includes("--corrigir");

/**
 * O envio normal só sai das 16h às 20h DE LONDRES (mesma lição do lembrete de
 * véspera): o disparo é 17h, e um Mac que acordou tarde não pode acordar
 * parceiro às 23h com "your jobs for tomorrow". Fora da janela o script LISTA
 * e não manda. E o email é uma FOTO das 17h: job alocado ou reordenado depois
 * do disparo não gera reenvio — quem alocou tarde fica sem email (decisão do
 * dono, 26/08). --corrigir ignora a janela: correção é gesto humano, sai na
 * hora que precisar.
 */
const horaLondres = Number(
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()),
);
const foraDaJanela = ENVIAR && !MODO_CORRECAO && (horaLondres < 16 || horaLondres >= 20);
const ENVIAR_AGORA = ENVIAR && !foraDaJanela;
if (foraDaJanela) {
  console.log(`[amanha] fora da janela de envio (16h-20h de Londres, agora são ${horaLondres}h): só listando, nada sai.`);
}

const hm = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London" });
};

/** Morning = janela começa antes do meio-dia DE LONDRES; sem horário, sem slot. */
const slotDe = (iso: string | null | undefined): "morning" | "afternoon" | null => {
  if (!iso) return null;
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date(iso)),
  );
  return h < 12 ? "morning" : "afternoon";
};

type JobRow = Record<string, unknown> & {
  id: string;
  reference: string;
  title: string | null;
  partner_id: string;
  client_name: string | null;
  property_address: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  job_type: string | null;
  hourly_partner_rate: number | null;
  partner_cost: number | null;
  billed_hours: number | null;
  route_seq?: number | null;
};

const { data: jobData } = await supabase
  .from("jobs")
  .select("*")
  .eq("scheduled_date", ymd)
  .not("partner_id", "is", null)
  .is("deleted_at", null)
  .not("status", "in", "(cancelled,deleted)")
  .order("scheduled_start_at", { ascending: true, nullsFirst: false });
const jobs = (jobData ?? []) as JobRow[];

const porParceiro = new Map<string, JobRow[]>();
for (const j of jobs) {
  const lista = porParceiro.get(j.partner_id) ?? [];
  lista.push(j);
  porParceiro.set(j.partner_id, lista);
}
console.log(`[amanha] ${ymd}: ${jobs.length} job(s) em ${porParceiro.size} parceiro(s) · modo ${ENVIAR_AGORA ? "ENVIO" : foraDaJanela ? "ensaio (fora da janela)" : "ensaio"}`);
if (porParceiro.size === 0) process.exit(0);

let enviados: Record<string, boolean> = {};
try { enviados = JSON.parse(readFileSync(SENT_PATH, "utf8")) as Record<string, boolean>; } catch { /* primeiro uso */ }

const { Resend } = await import("resend");
const resendKey = process.env.RESEND_API_KEY?.trim();
if (ENVIAR && !resendKey) { console.error("[amanha] RESEND_API_KEY ausente"); process.exit(1); }

let ok = 0, pulados = 0, falhas = 0;
for (const [partnerId, lista] of porParceiro) {
  if (ok >= MAX_ENVIOS_POR_RODADA) { console.log("[amanha] teto da rodada atingido"); break; }
  const chave = `${ymd}:${partnerId}`;
  if (enviados[chave] && !MODO_CORRECAO) { pulados++; continue; }

  const { data: partnerRow } = await supabase
    .from("partners")
    .select("id, company_name, contact_name, email, partner_address_latitude, partner_address_longitude")
    .eq("id", partnerId)
    .maybeSingle();
  const p = partnerRow as { company_name: string | null; contact_name: string | null; email: string | null; partner_address_latitude: number | null; partner_address_longitude: number | null } | null;
  const nome = p?.company_name?.trim() || p?.contact_name?.trim() || "Partner";
  if (!p?.email?.trim()) { console.log(`· ${nome}: SEM EMAIL — pulado`); pulados++; continue; }

  /**
   * A rota manda na ORDEM, mas não aparece (dono, 25/08): "faça a rota mesmo
   * sem mostrar que é uma rota". Janelas iguais deixavam a sequência
   * arbitrária e o job do meio do caminho ia parar no fim. A otimização
   * decide a visita (partindo da casa quando cadastrada), e a trava de
   * janela garante que nunca se põe um job DEPOIS de outro cuja janela já
   * fechou — aí vale o horário, não a geografia.
   */
  for (const j of lista) {
    if (j.latitude != null && j.longitude != null) continue;
    const geo = await geocodeUkAddressServer(j.property_address);
    if (!geo) continue;
    j.latitude = geo.latitude; j.longitude = geo.longitude;
    await supabase.from("jobs").update({ latitude: geo.latitude, longitude: geo.longitude }).eq("id", j.id);
  }
  // Ordem decidida À MÃO no drag do Live View (route_seq, mig 282) é lei:
  // um humano olhou o dia e disse a sequência — o otimizador não opina.
  const ordemManual = lista.some((j) => j.route_seq != null);
  if (ordemManual) {
    lista.sort((a, b) => {
      const sa = a.route_seq ?? Number.MAX_SAFE_INTEGER;
      const sb = b.route_seq ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      const ta = a.scheduled_start_at ? new Date(a.scheduled_start_at).getTime() : Infinity;
      const tb = b.scheduled_start_at ? new Date(b.scheduled_start_at).getTime() : Infinity;
      return ta === tb ? 0 : ta - tb;
    });
  } else if (lista.length >= 2 && lista.every((j) => j.latitude != null && j.longitude != null)) {
    const ordem = await getOptimizedStopOrder(
      lista.map((j) => ({ latitude: j.latitude!, longitude: j.longitude! })),
      {
        start:
          p.partner_address_latitude != null && p.partner_address_longitude != null
            ? { latitude: p.partner_address_latitude, longitude: p.partner_address_longitude }
            : null,
      },
    );
    if (ordem) {
      const otimizada = ordem.map((i) => lista[i]!);
      const violaJanela = otimizada.some((j, i) => {
        if (i === 0) return false;
        const anterior = otimizada[i - 1]!;
        return (
          j.scheduled_end_at != null &&
          anterior.scheduled_start_at != null &&
          new Date(j.scheduled_end_at).getTime() < new Date(anterior.scheduled_start_at).getTime()
        );
      });
      if (!violaJanela) lista.splice(0, lista.length, ...otimizada);
    }
  }

  let fixo = 0, horista = 0, temHourly = false;
  const stops = lista.map((j, i) => {
    const basis = (j as { rate_basis?: string | null }).rate_basis ?? null;
    const isHourly = j.job_type === "hourly";
    if (isHourly) {
      temHourly = true;
      horista += Math.max(0, Number(j.hourly_partner_rate) || 0) * Math.max(1, Number(j.billed_hours) || 1);
    } else {
      fixo += Math.max(0, Number(j.partner_cost) || 0);
    }
    const ini = hm(j.scheduled_start_at);
    const fim = hm(j.scheduled_end_at);
    return {
      windowLabel: ini ? `${ini}${fim ? ` – ${fim}` : ""}` : "Time to be confirmed",
      title: j.title?.trim() || j.reference,
      address: j.property_address?.trim() || "Address in the portal",
      clientFirstName: j.client_name?.trim().split(/\s+/)[0] ?? null,
      payDisplay: formatPartnerJobPriceDisplay(
        (j.job_type as "hourly" | "fixed" | null) ?? null,
        j.hourly_partner_rate,
        j.partner_cost,
        null,
        basis,
      ),
      portalUrl,
      drive: null,
      slot: slotDe(j.scheduled_start_at),
    };
  });

  const total = fixo + horista;
  const email = buildPartnerTomorrowEmail({
    dayWord,
    correctionNote: MODO_CORRECAO
      ? `Correction: our earlier email showed the wrong date in the heading. These jobs are for ${dayWord.toUpperCase()}, ${dateLabel} — times and details below are unchanged. Sorry for the confusion.`
      : null,
    partnerFirstName: (p.contact_name?.trim() || p.company_name?.trim() || "there").split(/\s+/)[0]!,
    dateLabel,
    stops,
    showRoute: false,
    totalDriveSec: null,
    firstArrivalLabel: hm(lista[0]?.scheduled_start_at) ?? "TBC",
    earningsLabel: temHourly ? "Potential earnings" : "Earnings",
    earningsDisplay: `£${total.toFixed(2)}${temHourly ? "+" : ""}`,
    portalUrl,
  });

  if (!ENVIAR_AGORA) {
    console.log(`· ${nome} <${p.email}>: ${lista.length} job(s) · ${temHourly ? "Potential earnings" : "Earnings"} £${total.toFixed(2)}${temHourly ? "+" : ""} · assunto: "${email.subject}"`);
    const htmlDir = process.env.AMANHA_HTML_DIR?.trim();
    if (htmlDir) writeFileSync(`${htmlDir}/amanha-${nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`, email.html);
    continue;
  }

  try {
    const { error } = await new Resend(resendKey!).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
      to: [p.email.trim()],
      // A resposta do parceiro vira ticket: o digest sai pelo Resend (vários
      // jobs, nenhum ticket para pendurar side conversation), mas a conversa
      // volta para o Zendesk, onde o time e o Harvey já trabalham.
      replyTo: "support@getfixfy.com",
      subject: MODO_CORRECAO ? `Correction — ${email.subject}` : email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) throw new Error(error.message ?? "send failed");
    enviados[chave] = true;
    writeFileSync(SENT_PATH, JSON.stringify(enviados));
    ok++;
    console.log(`✓ ${nome} <${p.email}>: ${lista.length} job(s) enviados`);
  } catch (err) {
    falhas++;
    console.error(`✗ ${nome}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`[amanha] fim: ${ok} enviado(s), ${pulados} pulado(s), ${falhas} falha(s)`);
