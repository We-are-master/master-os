/**
 * Disparador local da WEEK10 (28/09/2026), no lugar do n8n enquanto a produção
 * não tem as variáveis da campanha. Pode ser ligado na véspera: fora das
 * janelas ele só espera. Roda até a oferta vencer (sexta 02/10, 22h de Londres).
 *
 * O ritmo (decisão do dono em 28/09, horas de Londres; as regras moram no OS,
 * em src/lib/marketing/ritmo.ts e triagem.ts, aqui é só o relógio):
 *
 *   e-mail     SÓ DE MANHÃ, 9h às 12h: uma volta de MARKETING_EMAIL_POR_VOLTA
 *              (75) em cada quarto de hora do relógio (9h00, 9h15 ... 11h45),
 *              12 voltas e 900 e-mails por manhã. Os 2.629 que faltam acabam na
 *              quinta 01/10 perto das 11h45. Começa terça 29/09 às 9h
 *   whatsapp   SÓ DE TARDE, 15h às 18h: uma leva de até 50 a cada 10 min do
 *              relógio (15h00, 15h10 ... 17h50) pela Cloud API, até 900 por
 *              tarde. O follow-up de quem recebeu e-mail sai às 15h do MESMO dia
 *              do e-mail (o e-mail só sai até 12h: 3 horas ou mais depois)
 *   triagem    antes de cada e-mail e cada WhatsApp: pula quem comprou desde
 *              28/09 (lead do site pago ou job novo), quem saiu da lista e, no
 *              follow-up, quem respondeu ao e-mail (toque com replied_at ou
 *              ticket no Zendesk vindo do e-mail dela depois do envio). "Se ela
 *              comprou, não sai nada"
 *   oferta v3  a cada 30 min vê se a Meta aprovou fixfy_week10_offer_v3; se
 *              sim, agenda as 95 ofertas de quem só tem telefone para a próxima
 *              abertura do WhatsApp (terça 29/09 15h), não para agora
 *   lembrete   na quinta 01/10, a partir das 9h, monta UMA vez "WEEK10 ends
 *              tomorrow" para quem chegou no checkout do site e não pagou
 *              (sai 9h30, antes do resto da fila; o que sobrar depois da
 *              quinta vira pulado). Rodar de novo não duplica
 *   zendesk    a cada 10 min lê as respostas: WhatsApp (Stop bloqueia) e
 *              e-mail. Resposta de quem recebeu a campanha ganha UMA nota
 *              interna no mesmo ticket (o que recebeu, hora de Londres, código
 *              e link) e a tag campanha-week10, e carimba replied_at
 *   freio      a cada 30 min: bounce acima de 5% (com 100+ enviados) ou 3+
 *              reclamações nas últimas 24h param o e-mail
 *
 * Log só com contagem, sem dado pessoal.
 */
import { appendFileSync, readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const LOG = new URL("./campanha-week10.log", import.meta.url).pathname;
const hora = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const log = (...p: unknown[]) => appendFileSync(LOG, `${hora()} ${p.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`);

const { voltaDeEmail, proximaLevaWhatsApp, registrarResultadoWhatsApp, soltarReservasPresas, ofertaNoAr, montarLembrete } = await import("./src/lib/marketing/campanha");
const { varrerRespostasDoZendesk } = await import("./src/lib/marketing/zendesk-respostas");
const { aberturaDoWhatsApp, ehDiaDoLembrete, emLondres, emailNaJanela, quandoEmLondres, whatsappNaJanela } = await import("./src/lib/marketing/ritmo");
const { createServiceClient } = await import("./src/lib/supabase/service");
const sb = createServiceClient();

const MIN = 60_000;
// Cada passo roda uma vez por fatia do relógio (9h00, 9h15, 9h30...), não "15 min
// depois da última vez": contando do fim da última, cada volta escorregaria um
// pouco e a manhã fecharia com 11 voltas em vez de 12.
const ultimaFatia: Record<string, number> = {};
let emailPausado = false;
let v3Liberada = false;
let lembreteMontado = false;

async function rodadaEmail() {
  if (emailPausado || !emailNaJanela()) return;
  const r = await voltaDeEmail();
  if (r.enviados || r.falhas || r.pulados || (r.parou && r.parou !== "fora da janela")) log("email", r);
}

// WHATSAPP_DESLIGADO=1: o token da Cloud API está dando #200 (29/09). Sem isso a
// fila da tarde inteira viraria "falhou". E-mail e Zendesk seguem normais.
const whatsappDesligado = process.env.WHATSAPP_DESLIGADO === "1";

async function rodadaWhatsApp() {
  if (whatsappDesligado) return;
  const presas = await soltarReservasPresas();
  if (presas) log("whatsapp reservas soltas", presas);
  if (!whatsappNaJanela()) return;
  const leva = await proximaLevaWhatsApp({ n: 50 });
  if (leva.pulados) log("whatsapp pulados pela triagem", leva.pulados);
  if (!leva.itens.length) {
    if (leva.motivo && leva.motivo !== "fora da janela") log("whatsapp parado:", leva.motivo);
    return;
  }
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION?.trim() || "v21.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const resultados: Array<{ id: string; wamid?: string | null; erro?: string | null; codigo?: number | null }> = [];
  for (const item of leva.itens) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(item.corpo),
      });
      const j = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
      if (res.ok && j.messages?.[0]?.id) resultados.push({ id: item.id, wamid: j.messages[0].id });
      else resultados.push({ id: item.id, erro: j.error?.message ?? `HTTP ${res.status}`, codigo: j.error?.code ?? null });
    } catch (e) {
      resultados.push({ id: item.id, erro: e instanceof Error ? e.message : String(e), codigo: 368 });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const r = await registrarResultadoWhatsApp(resultados);
  const erros = [...new Set(resultados.filter((x) => x.erro).map((x) => `${x.codigo}: ${x.erro}`.slice(0, 90)))];
  log("whatsapp", r, erros.length ? erros : "");
}

async function checarV3() {
  if (v3Liberada || whatsappDesligado) return;
  const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_WABA_ID}/message_templates?name=fixfy_week10_offer_v3&fields=name,status`;
  const j = (await (await fetch(url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } })).json()) as { data?: Array<{ status: string }> };
  const status = j.data?.[0]?.status ?? "?";
  if (status === "APPROVED") {
    // Não solta agora: agenda para a abertura do WhatsApp (15h de hoje se a janela de hoje não fechou, senão 15h de amanhã).
    const quando = aberturaDoWhatsApp();
    const { count } = await sb.from("marketing_queue").update({ agendado_para: quando.toISOString() }, { count: "exact" })
      .eq("campanha", "week10").eq("passo", "wa_oferta").eq("status", "planejado").is("agendado_para", null);
    v3Liberada = true;
    log(`oferta v3 aprovada pela Meta: agendadas para ${quandoEmLondres(quando)} (Londres)`, count);
  } else if (status === "REJECTED") {
    v3Liberada = true;
    log("oferta v3 REJEITADA pela Meta: as 95 ofertas por WhatsApp ficam seguradas");
  }
}

async function lembrete() {
  // Quinta 01/10, das 9h ao fim da janela do e-mail: depois disso o lembrete já não sairia.
  if (lembreteMontado || !ehDiaDoLembrete() || emLondres(new Date()).hora < 9 || !emailNaJanela()) return;
  const r = await montarLembrete({ aplicar: true });
  lembreteMontado = true;
  log("lembrete montado", { candidatos: r.candidatos, lembretes: r.lembretes, inseridas: r.inseridas, fora: r.fora, para: r.agendadoPara });
}

async function freio() {
  // Últimos e-mails do remetente de marketing nas últimas 24h, pelo Resend.
  const desde = Date.now() - 24 * 60 * MIN;
  let after: string | null = null;
  let total = 0, bounce = 0, reclam = 0, entregues = 0, abertos = 0, clicados = 0;
  for (let pagina = 0; pagina < 30; pagina++) {
    const q = `https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ""}`;
    const j = (await (await fetch(q, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })).json()) as { data?: Array<{ id: string; created_at: string; from: string; last_event: string }>; has_more?: boolean };
    const d = j.data ?? [];
    let parar = false;
    for (const e of d) {
      if (Date.parse(e.created_at.replace(" ", "T")) < desde) { parar = true; break; }
      if (!/news\.getfixfy\.com/.test(e.from)) continue;
      total++;
      if (e.last_event === "bounced") bounce++;
      if (e.last_event === "complained") reclam++;
      if (["delivered", "opened", "clicked"].includes(e.last_event)) entregues++;
      if (["opened", "clicked"].includes(e.last_event)) abertos++;
      if (e.last_event === "clicked") clicados++;
    }
    if (parar || !j.has_more || !d.length) break;
    after = d[d.length - 1].id;
  }
  log("resend 24h", { total, entregues, abertos, clicados, bounce, reclam });
  if (!emailPausado && ((total >= 100 && bounce / total > 0.05) || reclam >= 3)) {
    emailPausado = true;
    log("EMAIL PAUSADO pelo freio", { total, bounce, reclam });
  }
}

log("disparador ligado", {
  replyTo: process.env.RESEND_MARKETING_REPLY_TO,
  from: (process.env.RESEND_MARKETING_FROM ?? "").replace(/.*@/, "@"),
  porVolta: Number(process.env.MARKETING_EMAIL_POR_VOLTA?.trim() || "75"),
});

for (;;) {
  if (!ofertaNoAr()) { log("oferta vencida: disparador desligado"); break; }
  const agora = Date.now();
  const passos: Array<[string, number, () => Promise<void>]> = [
    ["lembrete", 5, lembrete],
    ["email", 15, rodadaEmail],
    ["wa", 10, rodadaWhatsApp],
    ["v3", 30, checarV3],
    ["zendesk", 10, async () => {
      const r = (await varrerRespostasDoZendesk({ aplicar: true, minutos: 30 })) as { ok?: boolean; motivo?: string; stops?: number; respostas?: number; respostasEmail?: number; notas?: number; detalhes?: unknown };
      if (!r?.ok) log("zendesk:", r?.motivo ?? "falhou");
      else if ((r.stops ?? 0) + (r.respostas ?? 0) + (r.respostasEmail ?? 0) > 0) {
        log("zendesk", { stops: r.stops, respostas: r.respostas, respostasEmail: r.respostasEmail, notas: r.notas, detalhes: r.detalhes });
      }
    }],
    ["freio", 30, freio],
  ];
  for (const [nome, cada, fn] of passos) {
    const fatia = Math.floor(agora / (cada * MIN));
    if (ultimaFatia[nome] === fatia) continue;
    ultimaFatia[nome] = fatia;
    try { await fn(); } catch (e) { log(`erro em ${nome}:`, e instanceof Error ? e.message : String(e)); }
  }
  // Acorda no começo do próximo minuto, para a volta cair perto da hora cheia da fatia.
  await new Promise((r) => setTimeout(r, MIN - (Date.now() % MIN) + 1000));
}
