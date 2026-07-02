/**
 * Cold-outbound B2B templates for Apify-sourced leads.
 *   partner_cold     → recruit tradespeople (sole traders) into the network
 *   b2b_client_cold  → pitch estate agents / letting agents / property managers
 *
 * Both are B2B (PECR/GDPR-compliant cold email) and always carry an
 * unsubscribe link via context.unsubscribeUrl. Context keys:
 *   name, company_name, town, category, applyUrl, callUrl, unsubscribeUrl
 */

import {
  renderClientEmail,
  clientP,
  clientCta,
  clientCallout,
  clientDivider,
  escapeHtml,
} from "@/lib/emails/client-email-layout";
import { type SequenceContext, ctxStr } from "./types";

function name(ctx: SequenceContext): string {
  // Prefer a contact name; fall back to the company, then a neutral greeting.
  return ctxStr(ctx, "name") || ctxStr(ctx, "company_name") || "there";
}
function town(ctx: SequenceContext): string {
  return ctxStr(ctx, "town");
}
function unsub(ctx: SequenceContext): string | undefined {
  return ctxStr(ctx, "unsubscribeUrl") || undefined;
}
const COLD_FOOTER =
  "You're receiving this because Fixfy works with home-service businesses in your area. If this isn't relevant, you can opt out below.";

/* ===================== PARTNER COLD (supply) ===================== */

const PARTNER_APPLY = "https://partners.getfixfy.com";

export function partnerColdIntro(ctx: SequenceContext): string {
  const where = town(ctx) ? ` in ${escapeHtml(town(ctx))}` : "";
  const trade = ctxStr(ctx, "category") || "trade";
  const url = ctxStr(ctx, "applyUrl") || PARTNER_APPLY;
  return renderClientEmail({
    name: name(ctx),
    preheader: `Pre-qualified ${trade} jobs${where} — no leads to chase, no quoting.`,
    heading: `Steady work${where} — without chasing leads`,
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`We run Fixfy, a home-services network connecting vetted pros with customers who've already decided to book. We're adding <strong>${escapeHtml(trade)}</strong> partners${where} and thought you'd be a great fit.`) +
      clientCallout("What partners get", [
        "Pre-qualified customers — no cold leads",
        "No quoting on selected jobs",
        "Weekly or scheduled payments",
        "Commercial & residential work",
        "Dedicated partner support",
      ]) +
      clientCta("See partner rates & apply", url) +
      clientP(`Takes a few minutes to join. Happy to answer any questions — just reply.`),
  });
}

export function partnerColdHowItWorks(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "applyUrl") || PARTNER_APPLY;
  return renderClientEmail({
    name: name(ctx),
    preheader: "How Fixfy works for pros — 60-second version.",
    heading: "How it works for pros",
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Quick follow-up. Here's the whole thing in three steps:`) +
      clientCallout("Simple by design", [
        "1. Apply & get verified once",
        "2. Accept jobs that suit you — work near you",
        "3. Get paid on schedule, no invoicing hassle",
      ]) +
      clientP(`No subscription, no lead fees — you only work the jobs you choose.`) +
      clientCta("Join the network", url),
  });
}

export function partnerColdBreakup(ctx: SequenceContext): string {
  const where = town(ctx) ? ` in ${escapeHtml(town(ctx))}` : "";
  const url = ctxStr(ctx, "applyUrl") || PARTNER_APPLY;
  return renderClientEmail({
    name: name(ctx),
    preheader: "Last one — should we keep your spot open?",
    heading: `Want your spot${where}?`,
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`I won't keep emailing — this is the last one. We're allocating partner slots${where} now, and I'd love to keep one for you.`) +
      clientCta("Yes, keep my spot", url) +
      clientDivider() +
      clientP(`Not for you right now? No problem at all — just ignore this and I'll close it off.`),
  });
}

/* ===================== B2B CLIENT COLD (demand) ===================== */

const B2B_CALL = "https://www.getfixfy.com/business";

export function b2bClientColdIntro(ctx: SequenceContext): string {
  const company = ctxStr(ctx, "company_name");
  const forCompany = company ? ` for ${escapeHtml(company)}` : "";
  const url = ctxStr(ctx, "callUrl") || B2B_CALL;
  return renderClientEmail({
    name: name(ctx),
    preheader: "One vetted partner for cleaning, gardening, repairs & certificates across your properties.",
    heading: "One partner for every property job",
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Managing maintenance across multiple properties means juggling trades, quotes and chasing. Fixfy gives agencies and property managers one vetted partner for cleaning, gardening, repairs, gas & electrical certificates — booked in a few clicks${forCompany}.`) +
      clientCallout("Built for property teams", [
        "Vetted, insured pros — one point of contact",
        "Upfront pricing, consolidated invoicing",
        "Fast turnaround on certificates & turnovers",
        "Coverage across your portfolio",
      ]) +
      clientCta("See how it works", url) +
      clientP(`Worth a quick look? Reply and I'll set you up with a trial job.`),
  });
}

export function b2bClientColdValue(ctx: SequenceContext): string {
  const company = ctxStr(ctx, "company_name") || "your team";
  const url = ctxStr(ctx, "callUrl") || B2B_CALL;
  return renderClientEmail({
    name: name(ctx),
    preheader: "Cut the admin around property maintenance.",
    heading: `Less admin for ${escapeHtml(company)}`,
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Following up — the teams we work with save the most time on the boring bits: sourcing trades, comparing quotes, and reconciling invoices.`) +
      clientCallout("What changes", [
        "One dashboard for all property jobs",
        "No more vetting trades yourself",
        "Predictable pricing & one monthly invoice",
        "An audit trail for compliance certs",
      ]) +
      clientCta("Book a 15-min walkthrough", url),
  });
}

export function b2bClientColdBreakup(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "callUrl") || B2B_CALL;
  return renderClientEmail({
    name: name(ctx),
    preheader: "Worth a quick chat — or should I close this off?",
    heading: "Worth a quick chat?",
    footerNote: COLD_FOOTER,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Last note from me. If keeping property maintenance simple is on your list this quarter, I'd love 15 minutes to show you how it works.`) +
      clientCta("Grab a time", url) +
      clientDivider() +
      clientP(`If now's not the time, no worries — just ignore this and I'll leave you to it.`),
  });
}
