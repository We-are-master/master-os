/**
 * Client-facing lifecycle email templates (demand side).
 * Each builder takes the enrollment context and returns full HTML via the
 * shared client layout. Context keys used:
 *   name, service, town, quoteUrl, bookingUrl, reviewUrl, rebookUrl,
 *   amount, code, partnerName, jobDate, reminderLabel, unsubscribeUrl
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

const HOW_IT_WORKS = [
  "Vetted, insured local pros",
  "Upfront, transparent pricing — no surprises",
  "Pick a slot that suits you",
  "Backed by the Fixfy guarantee",
];

function service(ctx: SequenceContext): string {
  return ctxStr(ctx, "service", "home service");
}
function unsub(ctx: SequenceContext): string | undefined {
  const u = ctxStr(ctx, "unsubscribeUrl");
  return u || undefined;
}

/* ---------------- C1 · Welcome / quote received (t+0) ---------------- */
export function clientWelcomeQuote(ctx: SequenceContext): string {
  const svc = escapeHtml(service(ctx));
  const url = ctxStr(ctx, "quoteUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: `Your ${service(ctx)} request is in — here's what happens next.`,
    heading: "We've got your request",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Thanks for choosing Fixfy for your <strong>${svc}</strong>. Your request is in and we're matching you with vetted local pros right now.`) +
      clientP(`To lock in your slot and see your price, just pick up where you left off:`) +
      clientCta("Complete my booking", url) +
      clientCallout("Why homeowners pick Fixfy", HOW_IT_WORKS) +
      clientP(`Questions? Just reply to this email — a real person will help.`),
  });
}

/* ---------------- C2 · Social proof (t+24h) ---------------- */
export function clientSocialProof(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "quoteUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  const town = ctxStr(ctx, "town");
  const where = town ? ` in ${escapeHtml(town)}` : " near you";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "Real homeowners, real results — and pros ready when you are.",
    heading: `Trusted by homeowners${where}`,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Still thinking it over? You're in good company. Thousands of UK homeowners book their ${escapeHtml(service(ctx))} through Fixfy because every pro is checked, insured and rated.`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px; background:#F7F7FB; border-radius:8px;"><tr><td style="padding:18px 20px;">
        <p style="margin:0 0 8px; font-size:15px; line-height:24px; color:#0A0A1F; font-style:italic;">&ldquo;Booked in minutes, the pro turned up on time and the price was exactly as quoted. Faultless.&rdquo;</p>
        <p style="margin:0; font-size:13px; color:#78716C;">&#9733;&#9733;&#9733;&#9733;&#9733; &nbsp;Verified Fixfy customer</p>
      </td></tr></table>` +
      clientCta("See my price", url) +
      clientP(`Slots fill up fast — secure yours while your local pros are available.`),
  });
}

/* ---------------- C3 · Transparent pricing (t+72h) ---------------- */
export function clientTransparency(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "quoteUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "No call-out surprises. See exactly what you'll pay.",
    heading: "No surprises, ever",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Worried about hidden costs? With Fixfy you see the price <strong>before</strong> you book your ${escapeHtml(service(ctx))} — no vague call-out fees, no haggling on the doorstep.`) +
      clientCallout("What's always included", [
        "A fixed, upfront price",
        "Vetted & insured professionals",
        "Free rescheduling if plans change",
        "The Fixfy satisfaction guarantee",
      ]) +
      clientCta("View my transparent quote", url),
  });
}

/* ---------------- C4 · Incentive (t+120h) ---------------- */
export function clientIncentive(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "quoteUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  const amount = ctxStr(ctx, "amount", "£20");
  const code = ctxStr(ctx, "code", "WELCOME20");
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: `A little something to get you started: ${amount} off your first job.`,
    heading: `Here's ${amount} off your first job`,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`We'd love to help with your ${escapeHtml(service(ctx))}. To make it easy, here's <strong>${escapeHtml(amount)} off</strong> when you book.`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td align="center" style="padding:18px; background:#FFF8F4; border:2px dashed #ED4B00; border-radius:10px;">
        <p style="margin:0 0 4px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#78716C;">Your code</p>
        <p style="margin:0; font-size:26px; font-weight:700; color:#020040; letter-spacing:2px;">${escapeHtml(code)}</p>
      </td></tr></table>` +
      clientCta(`Claim ${amount} off`, url) +
      clientP(`Applied automatically at checkout. Don't leave it too long — your match may move on.`),
  });
}

/* ---------------- C5 · Break-up (t+192h) ---------------- */
export function clientBreakup(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "quoteUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "Should we close your request, or are you still keen?",
    heading: "Still need a hand?",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`We don't want to clutter your inbox, so this is the last we'll nudge you about your ${escapeHtml(service(ctx))}.`) +
      clientP(`If you're still keen, your pros are ready whenever you are:`) +
      clientCta("Yes, I'm still interested", url) +
      clientDivider() +
      clientP(`Not the right time? No worries — just ignore this and we'll quietly close the request. We'll be here when you need us.`),
  });
}

/* ---------------- C6 · Booking confirmed (transactional, t+0) ---------------- */
export function clientBookingConfirmed(ctx: SequenceContext): string {
  const manageUrl = ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  const jobDate = ctxStr(ctx, "jobDate");
  const partner = ctxStr(ctx, "partnerName");
  const lines = [
    `<strong>Service:</strong> ${escapeHtml(service(ctx))}`,
    jobDate ? `<strong>When:</strong> ${escapeHtml(jobDate)}` : "",
    partner ? `<strong>Your pro:</strong> ${escapeHtml(partner)}` : "",
  ].filter(Boolean);
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "You're booked — here are the details.",
    heading: "You're all booked in",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Brilliant — your ${escapeHtml(service(ctx))} is confirmed. Here are the details:`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px; background:#F7F7FB; border-radius:8px;"><tr><td style="padding:18px 20px; font-size:15px; line-height:26px; color:#0A0A1F;">${lines.join("<br>")}</td></tr></table>` +
      clientCta("Manage my booking", manageUrl) +
      clientP(`Need to reschedule? It's free — just use the link above. See you soon!`),
  });
}

/* ---------------- C7 · Review request (post-job, t+24h) ---------------- */
export function clientReviewRequest(ctx: SequenceContext): string {
  const reviewUrl = ctxStr(ctx, "reviewUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "How did your Fixfy job go? It takes 30 seconds.",
    heading: "How did it go?",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`We hope your ${escapeHtml(service(ctx))} went perfectly. Your feedback helps other homeowners — and your pro — so we'd love a quick rating.`) +
      clientCta("Leave a quick review", reviewUrl) +
      clientP(`Something not right? Reply to this email and we'll make it right.`),
  });
}

/* ---------------- C8 · Cross-sell (post-job, t+14d) ---------------- */
export function clientCrossSell(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "rebookUrl") || "https://www.getfixfy.com";
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: "One job done — here's how to keep your home in top shape.",
    heading: "What's next for your home?",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`Now your ${escapeHtml(service(ctx))} is sorted, it's a great time to tick off the next thing on the list. Popular with homeowners like you:`) +
      clientCallout("Book in a few taps", [
        "Cleaning & end-of-tenancy",
        "Gardening & outdoor maintenance",
        "Gas, electrical & safety certificates",
        "Handyman & repairs",
      ]) +
      clientCta("Book another service", url),
  });
}

/* ---------------- C9 · Seasonal / cert reminder (recurring) ---------------- */
export function clientSeasonalReminder(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "rebookUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  const label = ctxStr(ctx, "reminderLabel", `your ${service(ctx)}`);
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: `Time to sort ${label} — book before it's due.`,
    heading: `It's time for ${label}`,
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`A friendly heads-up: <strong>${escapeHtml(label)}</strong> is coming due. Staying ahead keeps your home safe, compliant and stress-free.`) +
      clientP(`Book now and we'll match you with the same quality of vetted pro you had last time.`) +
      clientCta("Book it now", url) +
      clientP(`We'll remind you again next time, so you never have to keep track.`),
  });
}

/* ---------------- C10 · Win-back (t+0 of winback enrollment) ---------------- */
export function clientWinback(ctx: SequenceContext): string {
  const url = ctxStr(ctx, "rebookUrl") || ctxStr(ctx, "bookingUrl") || "https://www.getfixfy.com";
  const amount = ctxStr(ctx, "amount", "£25");
  const code = ctxStr(ctx, "code", "COMEBACK25");
  return renderClientEmail({
    name: ctxStr(ctx, "name"),
    preheader: `We've missed you — here's ${amount} to welcome you back.`,
    heading: "We've missed you",
    unsubscribeUrl: unsub(ctx),
    bodyHtml:
      clientP(`It's been a while! Whatever your home needs next, our vetted pros are ready — and here's <strong>${escapeHtml(amount)} off</strong> to make it easy.`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td align="center" style="padding:18px; background:#FFF8F4; border:2px dashed #ED4B00; border-radius:10px;">
        <p style="margin:0 0 4px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#78716C;">Welcome-back code</p>
        <p style="margin:0; font-size:26px; font-weight:700; color:#020040; letter-spacing:2px;">${escapeHtml(code)}</p>
      </td></tr></table>` +
      clientCta(`Use my ${amount} credit`, url),
  });
}
