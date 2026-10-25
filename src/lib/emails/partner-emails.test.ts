/**
 * O padrão dos e-mails ao parceiro (dono, 23/10/2026): chip do tipo, título
 * curto, a barra no passo certo, sem saudação, sem travessão, um botão, e o
 * assunto com a referência inteira.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPartnerQuoteBidInviteEmail } from "./partner-quote-bid-invite";
import {
  buildJobRescheduledEmail,
  buildPartnerJobConfirmationEmail,
  buildPartnerJobConfirmationRequestEmail,
  buildPartnerJobOnHoldEmail,
  buildPartnerJobStatusUpdateEmail,
} from "./partner-job-confirmation";
import { buildPartnerTomorrowEmail } from "./partner-tomorrow-email";
import { buildPartnerReportRequestEmail, partnerReportRequestSubject } from "./partner-report-request-email";
import { buildPartnerMissingReportsEmail } from "./partner-missing-reports-email";
import { buildSelfBillEmail, buildSelfBillSideConvHtml } from "./self-bill-statement";
import { areaDoEndereco, pagaDoParceiro, trabalhoCurto } from "./partner-shell";
import { resolvePartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import { htmlDaPergunta } from "@/lib/quote-lance-escopo";
import { motivoSemEmailDoSelfBill } from "./self-bill-statement";
import type { SelfBill } from "@/types/database";

const ENDERECO = "12 Example Road, London E1 6AN";
const ESCOPO = "Rehang bedroom door.\nAdjust kitchen cabinet hinges.";
const AGENDA = { scheduledDate: "2026-10-28", scheduledStartAt: "2026-10-28T08:00:00Z", scheduledEndAt: "2026-10-28T11:00:00Z" };

/** Chip (pílula), título e passo atual da barra (o rótulo depois da régua laranja). */
function cabeca(html: string): { chip: string | null; titulo: string | null; passo: string | null } {
  // Faixa do topo (cores do OS) ou, sem ela, a pílula de sempre.
  const chip = html.match(/font-weight:600;color:#[0-9A-F]+;vertical-align:middle;">([^<]+)<\/span>/)?.[1] ?? html.match(/border-radius:999px;">([^<]+)</)?.[1] ?? null;
  const titulo = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.replace(/&#39;/g, "'") ?? null;
  // Passo atual da régua: o traço laranja.
  const passo = html.match(/background:#ED4B00;[^>]*>&nbsp;<\/div><p[^>]*>([^<]+)</)?.[1] ?? null;
  return { chip, titulo, passo };
}

function regrasComuns(e: { html: string; text: string; subject?: string }) {
  for (const t of [e.html, e.text, e.subject ?? ""]) assert.doesNotMatch(t, /[—–]|\{\{|inc VAT|Maximum 3 hours/i);
  assert.doesNotMatch(e.html, /Need a hand\?|On the day/);
  assert.doesNotMatch(e.html, /font-weight:700;color:#020040;">[^<]*<\/p><\/div>/, "valores do quadro sem negrito");
  assert.ok((e.html.match(/padding:15px 0;border-radius:10px/g) ?? []).length <= 1, "um botão só");
}

describe("e-mails ao parceiro", () => {
  test("quote request: conteúdo antigo na moldura nova", () => {
    const e = buildPartnerQuoteBidInviteEmail({
      partnerFirstName: "TM Handyman", quoteReference: "QT-2026-1200", typeOfWork: "General Maintenance", clientName: "Sarah Jones",
      propertyAddress: ENDERECO, scope: ESCOPO, photoUrls: ["https://x.test/1.png"], bidUrl: "https://p.test/bid/1",
      deepLinkUrl: "fixfypartner://bid/1", officeQuoteUrl: "https://os.test/q/1", invitedAt: new Date("2026-10-23T10:00:00Z"),
    });
    regrasComuns(e);
    assert.equal(e.subject, "Quote request · General Maintenance · E1 6AN");
    assert.deepEqual(cabeca(e.html), { chip: "New opportunity", titulo: "You have been invited to bid", passo: "Offered" });
    assert.match(e.html, />Hi TM Handyman,</);
    assert.match(e.html, /#FFF8EB[\s\S]*Bid deadline[\s\S]*Fri 23 Oct 26, 23:00 \(UK time\)/);
    assert.match(e.html, /Required to submit your bid[\s\S]*Two start date options/);
    assert.match(e.html, /Rehang bedroom door\.<br>Adjust kitchen cabinet hinges\./);
    assert.doesNotMatch(e.html + e.text, /Sarah|12 Example Road/);
    assert.match(e.html, />E1 6AN · London</);
    assert.ok(e.html.indexOf("1.png") < e.html.indexOf(">Submit your bid<"));
    assert.ok(e.html.indexOf(">Scope<") < e.html.indexOf("1.png"));
    assert.match(e.html, /#EFF4FF[\s\S]*Questions\?/);
  });

  test("pergunta de escopo: nome na saudação, sem botão", () => {
    const h = htmlDaPergunta("QT-2026-1200", "Timber <not> filler?", "TM Handyman");
    assert.match(h, />Hi TM Handyman,</);
    assert.match(h, /Quick check on your price for QT-2026-1200 before we send it to the customer\./);
    assert.match(h, />Quick check on your price</);
    assert.match(h, /Timber &lt;not&gt; filler\?/);
    assert.doesNotMatch(h, /padding:15px 0;border-radius:10px|[—–]/);
  });

  test("job to accept: data e pagamento, sem cliente", () => {
    const e = buildPartnerJobConfirmationRequestEmail({
      partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "General Maintenance", clientName: "Sarah Jones",
      propertyAddress: ENDERECO, ...AGENDA, scope: ESCOPO, priceDisplay: "Hourly · £35.00/hr", acceptUrl: "https://os.test/p/1",
      partnerNotes: resolvePartnerJobEmailNotes({ jobType: "hourly" }),
    });
    regrasComuns(e);
    assert.equal(e.subject, "Job offer · General Maintenance · Wed 28 Oct 26 · E1 6AN");
    assert.deepEqual(cabeca(e.html), { chip: "New job available", titulo: "A new job is available. Interested?", passo: null });
    assert.match(e.html, />Location<[\s\S]*>E1 6AN</);
    assert.doesNotMatch(e.html, /Scope of work|Rehang|Hi TM/);
    assert.match(e.html, />£35\.00\/h</);
    assert.doesNotMatch(e.html, /Hourly/);
    assert.doesNotMatch(e.html + e.text, /Sarah|Note:/);
    assert.match(e.html, />Accept this job →</);
  });

  test("job booked e visita extra: cliente, telefone, View job, Accepted", () => {
    const base = {
      partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "General Maintenance", clientName: "Sarah Jones", clientPhone: "+44 7700 900123",
      propertyAddress: ENDERECO, ...AGENDA, scope: ESCOPO, jobType: "fixed" as const, priceDisplay: "Fixed · £70.00",
      reportUrl: "https://os.test/r/1", jobUrl: "https://partners.test",
    };
    const e = buildPartnerJobConfirmationEmail(base);
    regrasComuns(e);
    assert.equal(e.subject, "Job booked · General Maintenance · Wed 28 Oct 26 · E1 6AN · JOB-9800");
    assert.deepEqual(cabeca(e.html), { chip: "Job booked", titulo: "New job booked for you", passo: "Accepted" });
    assert.match(e.html, />Sarah Jones<[\s\S]*>\+44 7700 900123</);
    assert.match(e.html, />Your earnings<[\s\S]*>£70\.00<[\s\S]*>Fixed price</);
    assert.match(e.html, /href="https:\/\/os\.test\/r\/1"[^>]*>Submit job report</);
    assert.match(e.html, /href="https:\/\/partners\.test"[^>]*>Open job in app</);
    assert.match(e.html, />Scope of work<[\s\S]*Rehang bedroom door\.<br>Adjust kitchen cabinet hinges\./);
    assert.match(e.html, />08:00-11:00</);
    assert.match(e.html, />Hi TM,</);
    assert.match(e.html, />Here&#39;s everything you need to get started\.</);
    const v = buildPartnerJobConfirmationEmail({ ...base, visitNumber: 2, jobUrl: null });
    assert.equal(v.subject, "Visit 2 booked · General Maintenance · Wed 28 Oct 26 · E1 6AN · JOB-9800");
    assert.equal(cabeca(v.html).chip, "Visit 2 booked");
    assert.match(v.html, />#JOB-9800 · Visit 2</);
    assert.match(v.html, /href="https:\/\/os\.test\/r\/1"[^>]*>Submit job report</);
    // Referência antiga com " · Visit N" continua lida.
    assert.equal(buildPartnerJobConfirmationEmail({ ...base, jobReference: "JOB-9800 · Visit 3" }).subject.split(" · ")[0], "Visit 3 booked");
  });

  test("nota do catálogo: só o texto próprio, nunca o padrão", () => {
    const e = buildPartnerJobConfirmationEmail({
      partnerFirstName: "TM", jobReference: "JOB-1", jobTitle: "Gas Safety", clientName: "A", propertyAddress: ENDERECO, scope: "x",
      jobType: "hourly", priceDisplay: "Hourly · £35.00/hr", reportUrl: null,
      partnerNotes: resolvePartnerJobEmailNotes({ jobType: "hourly", catalog: { partner_email_notes_default: "Bring the CP12 pad.", partner_email_notes_hourly: null, partner_email_notes_fixed: null } }),
    });
    assert.match(e.html, /Note: Bring the CP12 pad\./);
    assert.doesNotMatch(e.html, /Paid by the hour/);
  });

  test("rescheduled: data nova e a antiga riscada, passo Accepted", () => {
    const e = buildJobRescheduledEmail({
      recipientFirstName: "TM", jobReference: "JOB-9800", jobTitle: "General Maintenance", propertyAddress: ENDERECO,
      oldDateLine: "Wed 28 Oct 26 · Arrival time 9AM – 12PM", newDateLine: "Fri 30 Oct 26 · Arrival time 1PM – 5PM", jobUrl: "https://partners.test",
    });
    regrasComuns(e);
    assert.equal(e.subject, "Booking rescheduled · JOB-9800");
    assert.deepEqual(cabeca(e.html), { chip: "Rescheduled", titulo: "Your booking has been rescheduled", passo: "Accepted" });
    assert.match(e.html, />13:00-17:00</);
    assert.match(e.html, /line-through[^>]*>Wed 28 Oct 26</);
  });

  test("on hold, complaint e cancelled: chips e sem barra", () => {
    const hold = buildPartnerJobOnHoldEmail({ partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "Carpentry", propertyAddress: ENDERECO, presetId: "awaiting_materials", resolveUrl: "https://os.test/h" });
    regrasComuns(hold);
    assert.equal(hold.subject, "Job on hold · JOB-9800");
    assert.deepEqual(cabeca(hold.html), { chip: "On hold", titulo: "This job is on hold", passo: null });
    const queixa = buildPartnerJobOnHoldEmail({ partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "Carpentry", propertyAddress: ENDERECO, presetId: "complaint", resolveUrl: "https://os.test/h", complaintReason: "Sealant <peeling>" });
    for (const t of [queixa.html, queixa.text, queixa.subject]) assert.doesNotMatch(t, /[—–]/);
    assert.equal(queixa.subject, "Action required · Complaint for JOB-9800");
    // Exatamente o antigo (dono, 23/10/2026): faixa vermelha, saudação como título, cartão, quadros.
    assert.ok(queixa.html.indexOf("Action required · reply within 12 hours") < queixa.html.indexOf("Hi TM,"));
    assert.match(queixa.html, /background-color:#C8102E[\s\S]*⚠ Action required · reply within 12 hours/);
    assert.match(queixa.html, /Hi TM,/);
    // Copy do dono (25/10/2026): título "New Complaint", depois o Hi e o parágrafo.
    assert.match(queixa.html, />New Complaint</);
    assert.ok(queixa.html.indexOf("New Complaint") < queixa.html.indexOf("Hi TM,"));
    assert.doesNotMatch(queixa.html, /A complaint was raised on this job/);
    assert.match(queixa.html, /Job #JOB-9800/);
    assert.match(queixa.html, /⏸ On hold/);
    assert.match(queixa.html, /What the customer reported[\s\S]*Sealant &lt;peeling&gt;/);
    assert.match(queixa.html, /Payment on hold until resolved\./);
    assert.match(queixa.html, /What we need from you[\s\S]*Photos<\/strong> of the work area \/ completed work/);
    assert.match(queixa.html, />Reply in the journal</);
    assert.match(queixa.html, /width:100%; max-width:600px/);
    assert.match(queixa.html, /class="container email-card" width="100%"/);
    const canc = buildPartnerJobStatusUpdateEmail({
      kind: "cancelled", partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "Carpentry", scheduledDate: "2026-10-28",
      clientName: "Sarah Jones", clientPhone: "+44 7700 900123", propertyAddress: ENDERECO, scope: "Secret scope", newStatusLabel: "Cancelled", reason: "internal", reportUrl: "https://os.test/r",
    });
    regrasComuns(canc);
    assert.equal(canc.subject, "Job cancelled · Carpentry · Wed 28 Oct 26 · JOB-9800");
    assert.deepEqual(cabeca(canc.html), { chip: "Cancelled", titulo: "This job has been cancelled", passo: null });
    assert.match(canc.html, /#FDECEC/);
    assert.doesNotMatch(canc.html + canc.text, /Sarah|7700|Secret scope|internal|12 Example Road|href="https:\/\/os/);
  });

  test("job complete e report: passo Report", () => {
    const fim = buildPartnerJobStatusUpdateEmail({
      kind: "completed", partnerFirstName: "TM", jobReference: "JOB-9800", jobTitle: "Carpentry", scheduledDate: "2026-10-28",
      clientName: "S", propertyAddress: ENDERECO, scope: "x", newStatusLabel: "Completed", reportUrl: "https://os.test/r",
    });
    regrasComuns(fim);
    assert.equal(fim.subject, "Job marked complete · JOB-9800");
    assert.deepEqual(cabeca(fim.html), { chip: "Completed", titulo: "Job marked complete", passo: "Report" });
    const pedido = buildPartnerReportRequestEmail({ jobReference: "JOB-9800", jobTitle: "Carpentry", propertyAddress: ENDERECO, reportUrl: "https://os.test/r", jobDate: "2026-10-28" });
    regrasComuns(pedido);
    assert.equal(partnerReportRequestSubject("JOB-9800", "Carpentry", "2026-10-28"), "Submit work report · JOB-9800");
    assert.deepEqual(cabeca(pedido.html), { chip: "Report needed", titulo: "Please submit the work report", passo: "Report" });
    const um = buildPartnerMissingReportsEmail({
      partnerFirstName: "TM", portalUrl: "https://partners.test", onHoldDisplay: "£70.00",
      jobs: [{ reference: "JOB-9800", title: "Carpentry", address: ENDERECO, clientFirstName: "S", dateLabel: "Wed 28 Oct", dateYmd: "2026-10-28", daysWaiting: 2, reportUrl: "https://os.test/r", payDisplay: "£70.00" }],
    });
    regrasComuns(um);
    assert.equal(um.subject, "Submit your job report · JOB-9800");
    assert.deepEqual(cabeca(um.html), { chip: "Action required", titulo: "1 job report waiting", passo: "Report" });
    assert.match(um.html, />2d</);
    const dois = buildPartnerMissingReportsEmail({
      partnerFirstName: "TM", portalUrl: "https://partners.test", onHoldDisplay: null,
      jobs: [
        { reference: "JOB-1", title: "A", address: "x", clientFirstName: null, dateLabel: "d", daysWaiting: 0, reportUrl: "https://os.test/1", payDisplay: null },
        { reference: "JOB-2", title: "B", address: "y", clientFirstName: null, dateLabel: "d", daysWaiting: 3, reportUrl: "https://os.test/2", payDisplay: null },
      ],
    });
    assert.equal(dois.subject, "2 job reports awaiting submission");
    assert.equal(cabeca(dois.html).titulo, "2 job reports waiting");
  });

  test("tomorrow: o antigo na moldura nova, sem barra, sem emoji", () => {
    const e = buildPartnerTomorrowEmail({
      partnerFirstName: "TM", dateLabel: "x", dateYmd: "2026-10-28", showRoute: true, totalDriveSec: 1560, firstArrivalLabel: "9:00 AM",
      earningsLabel: "Earnings", earningsDisplay: "£70.00", portalUrl: "https://partners.test",
      stops: [{ windowLabel: "9:00 AM – 12:00 PM", title: "Carpentry", address: ENDERECO, clientFirstName: "Sarah", payDisplay: "Fixed · £70.00", portalUrl: "https://partners.test/j/1", drive: { durationSec: 1560, distanceM: 9200 }, slot: "morning" }],
    });
    regrasComuns(e);
    assert.deepEqual(cabeca(e.html), { chip: "Tomorrow", titulo: "Your jobs for Wed 28 Oct 26", passo: null });
    // Sem saudação nem frase: o título e os números já dizem (dono, 25/10/2026).
    assert.doesNotMatch(e.html, />Hi TM,<|Here&#39;s your day/);
    assert.match(e.html, />09:00</);
    assert.match(e.html, />09:00-12:00</);
    assert.match(e.html, />Morning slot</);
    assert.match(e.html, />Sarah · £70\.00 fixed</);
    assert.match(e.html, /href="https:\/\/partners\.test\/j\/1"[^>]*>Open</);
    assert.match(e.html, />Open my day in Fixfy Trade</);
    assert.doesNotMatch(e.html, /\p{Extended_Pictographic}/u);
  });

  test("self-bill: conteúdo antigo, Paid por vir; pago e payout statement não saem", () => {
    const sb = { reference: "SB-1", net_payout: 70, week_start: "2026-10-26", week_end: "2026-11-01", partner_name: "TM" } as SelfBill;
    const agendado = buildSelfBillEmail(sb, "2026-11-06", { partnerName: "TM Handyman" });
    regrasComuns(agendado);
    assert.deepEqual(cabeca(agendado.html), { chip: "Payout scheduled", titulo: "Self-bill issued", passo: null });
    assert.match(agendado.html, />Hi TM Handyman,</);
    assert.match(agendado.html, /Your self-bill is attached\. Review the period/);
    assert.match(agendado.html, /Questions about your payout\?/);
    assert.match(agendado.html, />Fri 6 Nov 26</);
    const lateral = buildSelfBillSideConvHtml(sb, "2026-11-06", "a@b.test", "TM");
    assert.equal((lateral.match(/<table/g) ?? []).length, 0);
    assert.equal(motivoSemEmailDoSelfBill(sb), null);
    assert.match(motivoSemEmailDoSelfBill({ paid_at: "2026-11-06T10:00:00Z" }) ?? "", /paid/i);
    assert.match(motivoSemEmailDoSelfBill(sb, { payoutStatement: true }) ?? "", /Payout statement/);
  });

  test("sem fotos: linha neutra no lugar das miniaturas (01 e 04)", () => {
    const q = buildPartnerQuoteBidInviteEmail({
      partnerFirstName: "TM", quoteReference: "QT-1", typeOfWork: "Carpentry", clientName: "A", propertyAddress: ENDERECO, scope: "x",
      photoUrls: [], bidUrl: "https://p.test/bid/1", deepLinkUrl: "x://1", officeQuoteUrl: "https://os.test/q/1",
    });
    assert.match(q.html, /border:1px dashed[^>]*><p[^>]*>No site photos available</);
    assert.match(q.text, /No site photos available/);
    const b = buildPartnerJobConfirmationEmail({
      partnerFirstName: "TM", jobReference: "JOB-1", jobTitle: "Carpentry", clientName: "A", propertyAddress: ENDERECO, scope: "x",
      jobType: "fixed", priceDisplay: "Fixed · £70.00", reportUrl: "https://os.test/r",
    });
    assert.ok(b.html.indexOf("No site photos available") < b.html.indexOf(">Submit job report<"));
    const comFoto = buildPartnerJobConfirmationEmail({
      partnerFirstName: "TM", jobReference: "JOB-1", jobTitle: "Carpentry", clientName: "A", propertyAddress: ENDERECO, scope: "x",
      jobType: "fixed", priceDisplay: "Fixed · £70.00", reportUrl: "https://os.test/r", photoUrls: ["https://x.test/1.png"],
    });
    assert.doesNotMatch(comFoto.html, /No site photos available/);
  });

  test("barra do parceiro: Approved no lugar de Paid; verde no self-bill", () => {
    const b = buildPartnerJobConfirmationEmail({
      partnerFirstName: "TM", jobReference: "JOB-1", jobTitle: "Carpentry", clientName: "A", propertyAddress: ENDERECO, scope: "x",
      jobType: "fixed", priceDisplay: "Fixed · £70.00", reportUrl: "https://os.test/r",
    });
    assert.match(b.html, />Approved</);
    assert.doesNotMatch(b.html, />Paid</);
    const sb = buildSelfBillEmail({ reference: "SB-1", net_payout: 70, week_start: "2026-10-26", week_end: "2026-11-01" } as SelfBill, "2026-11-06");
    assert.match(sb.html, /background:#22C55E;[^>]*>&nbsp;<\/div><p[^>]*color:#4ADE80;">Approved</);
  });

  test("helpers: pagamento, área e trabalho curto", () => {
    assert.deepEqual(pagaDoParceiro("Hourly · £35.00/hr"), { valor: "£35.00/h", tipo: null, linha: "£35.00/h" });
    assert.deepEqual(pagaDoParceiro("£249.00 inc VAT"), { valor: "£249.00", tipo: "Fixed price", linha: "£249.00 fixed" });
    assert.equal(pagaDoParceiro("Half day · £180.00")?.linha, "Half day · £180.00");
    assert.equal(areaDoEndereco(ENDERECO), "E1 6AN · London");
    assert.equal(areaDoEndereco("SE8 3AJ"), "SE8 3AJ");
    assert.ok(trabalhoCurto("General Maintenance", "word ".repeat(80)).length <= 121);
  });
});

test("Save all photos no convite e no job booked, só com foto", async () => {
  const { buildPartnerQuoteBidInviteEmail } = await import("./partner-quote-bid-invite");
  const { buildPartnerJobConfirmationEmail } = await import("./partner-job-confirmation");
  const convite = buildPartnerQuoteBidInviteEmail({
    partnerFirstName: "G", quoteReference: "QT-1290", typeOfWork: "Painting", clientName: "S", propertyAddress: "1 A St, London SW11 5RW",
    scope: "x", photoUrls: ["https://x.supabase.co/a.jpg", "https://x.supabase.co/b.jpg"], bidUrl: "https://p/bid", deepLinkUrl: "fixfy://b", officeQuoteUrl: "https://o",
  });
  assert.match(convite.html, /href="[^"]*\/api\/public\/fotos-zip\/[^"]+"[^>]*>Save all photos \(2\)</);
  const base = { partnerFirstName: "G", jobReference: "JOB-1", jobTitle: "T", clientName: "S", propertyAddress: "1 A St, London SW11 5RW", scope: "x", jobType: "fixed" as const, priceDisplay: "£90.00", reportUrl: null };
  assert.match(buildPartnerJobConfirmationEmail({ ...base, photoUrls: ["https://x.supabase.co/a.jpg"] }).html, />Save all photos \(1\)</);
  assert.doesNotMatch(buildPartnerJobConfirmationEmail(base).html, /Save all photos/);
});
