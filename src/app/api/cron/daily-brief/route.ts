import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { getZonedWallClock, hasLocalTimeReachedSchedule, isInTimeWindow } from "@/lib/wall-clock-tz";
import { fetchOpsSnapshot, snapshotToPromptBlock } from "@/lib/master-brain-metrics";
import { buildDailyBriefHtml, insightsTextToHtml } from "@/lib/daily-brief-email";
import { isOpenAIConfigured, MASTER_BRAIN_SYSTEM_PROMPT, openaiChat } from "@/lib/openai-client";

const WINDOW_MIN = 20;

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function slotDue(
  wall: { hour: number; minute: number },
  scheduleHHmm: string,
  lastYmd: string | null,
  todayYmd: string
): boolean {
  if (lastYmd === todayYmd) return false;
  return (
    isInTimeWindow(wall, scheduleHHmm, WINDOW_MIN) ||
    hasLocalTimeReachedSchedule(wall, scheduleHHmm)
  );
}

/**
 * Scheduled operational brief (morning / evening). Secure with CRON_SECRET.
 * Vercel Cron sends Authorization: Bearer CRON_SECRET when env is set.
 *
 * - **Vercel Hobby:** `vercel.json` uses one run per day (e.g. 20:00 UTC). Any slot whose
 *   local time has passed and was not yet sent today may be delivered in that run (often both).
 * - **Vercel Pro:** use a 15-minute cron schedule in vercel.json so each slot is sent near its configured time.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const secret = bearer || req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: settings, error: settingsError } = await admin.from("company_settings").select("*").limit(1).maybeSingle();

  if (settingsError || !settings) {
    return NextResponse.json({ ok: false, reason: "no_company_settings" }, { status: 200 });
  }

  const row = settings as Record<string, unknown>;
  const enabled = Boolean(row.daily_brief_enabled);
  const emailsRaw = String(row.daily_brief_emails ?? "").trim();
  const tz = String(row.daily_brief_timezone ?? "Europe/London");
  const morningT = String(row.daily_brief_morning_time ?? "08:00");
  const eveningT = String(row.daily_brief_evening_time ?? "18:00");

  if (!enabled || !emailsRaw) {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled_or_no_emails" });
  }

  const recipients = parseEmails(emailsRaw);
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_valid_emails" });
  }

  const now = new Date();
  const wall = getZonedWallClock(now, tz);
  if (!wall.ymd) {
    return NextResponse.json({ ok: false, reason: "timezone_parse" }, { status: 500 });
  }

  const lastM = (row.daily_brief_last_morning_ymd as string | null) ?? null;
  const lastE = (row.daily_brief_last_evening_ymd as string | null) ?? null;

  const kinds: ("morning" | "evening")[] = [];
  if (slotDue(wall, morningT, lastM, wall.ymd)) kinds.push("morning");
  if (slotDue(wall, eveningT, lastE, wall.ymd)) kinds.push("evening");

  if (kinds.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_window_or_already_sent",
      ymd: wall.ymd,
    });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.warn("daily-brief: RESEND_API_KEY missing");
    return NextResponse.json({ ok: false, reason: "resend_not_configured" }, { status: 500 });
  }

  const snapshot = await fetchOpsSnapshot(admin);
  const companyName = String(row.company_name ?? "Master OS");
  const resend = new Resend(resendKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? `${companyName} <onboarding@resend.dev>`;

  const sent: ("morning" | "evening")[] = [];

  for (const kind of kinds) {
    let insightsHtml = "";
    if (isOpenAIConfigured()) {
      try {
        const block = snapshotToPromptBlock(snapshot);
        const text = await openaiChat(
          [
            { role: "system", content: MASTER_BRAIN_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Write a ${kind} operational brief for leadership (max 8 bullet points). Data:\n${block}`,
            },
          ],
          { maxTokens: 700, temperature: 0.45 },
        );
        insightsHtml = insightsTextToHtml(text);
      } catch (e) {
        console.error("daily-brief OpenAI:", e);
      }
    }

    const html = buildDailyBriefHtml({ companyName, kind, snapshot, insightsHtml });
    const subject = `${companyName} — ${kind === "morning" ? "Morning" : "End of day"} brief`;

    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      html,
    });

    if (sendErr) {
      console.error("daily-brief Resend:", sendErr);
      return NextResponse.json(
        { ok: false, error: sendErr.message, partial: sent },
        { status: 500 },
      );
    }

    const patch =
      kind === "morning"
        ? { daily_brief_last_morning_ymd: wall.ymd }
        : { daily_brief_last_evening_ymd: wall.ymd };

    await admin.from("company_settings").update(patch).eq("id", settings.id as string);
    sent.push(kind);
  }

  return NextResponse.json({
    ok: true,
    kinds: sent,
    recipients: recipients.length,
    ymd: wall.ymd,
  });
}
