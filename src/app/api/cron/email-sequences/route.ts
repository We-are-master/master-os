import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { getSequence } from "@/lib/email-sequences/definitions";
import type { SequenceContext } from "@/lib/email-sequences/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
const BATCH = 100; // enrollments processed per run

/** Constant-time secret comparison (matches the daily-brief cron). */
function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type EnrollmentRow = {
  id: string;
  sequence_key: string;
  contact_email: string;
  contact_name: string | null;
  current_step: number;
  cycle: number;
  context: SequenceContext;
  enrolled_at: string;
};

/**
 * Lifecycle email engine. Vercel Cron (Authorization: Bearer CRON_SECRET) hits
 * this on a schedule (every 15 min on Pro). Each run sends every due step and
 * advances the enrollment. Recurring sequences loop back to step 0 forever.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ ok: false, reason: "resend_not_configured" }, { status: 500 });
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("email_sequence_enrollments")
    .select("id, sequence_key, contact_email, contact_name, current_step, cycle, context, enrolled_at")
    .eq("status", "active")
    .lte("next_send_at", nowIso)
    .order("next_send_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const resend = new Resend(resendKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <hello@getfixfy.com>";

  let sent = 0;
  let completed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of due as EnrollmentRow[]) {
    const seq = getSequence(row.sequence_key);
    if (!seq) {
      // Unknown sequence (e.g. removed from code) — park it so it stops cycling.
      await admin.from("email_sequence_enrollments")
        .update({ status: "stopped", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      skipped++;
      continue;
    }

    const step = seq.steps[row.current_step];
    if (!step) {
      await admin.from("email_sequence_enrollments")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      completed++;
      continue;
    }

    const ctx: SequenceContext = { ...row.context, name: row.context?.name ?? row.contact_name ?? undefined };

    // Idempotency: claim this (enrollment, step, cycle) before sending. If the
    // unique index rejects it, another run already handled it — just advance.
    const { error: claimErr } = await admin.from("email_sequence_sends").insert({
      enrollment_id: row.id,
      sequence_key: seq.key,
      step_key: step.key,
      step_index: row.current_step,
      cycle: row.cycle,
      contact_email: row.contact_email,
      subject: step.subject(ctx),
    });

    if (claimErr) {
      if (claimErr.code === "23505") {
        skipped++;
      } else {
        errors.push(`${row.id}: claim ${claimErr.message}`);
        continue;
      }
    } else {
      // Claim won — actually send.
      const unsubUrl = typeof ctx.unsubscribeUrl === "string" ? ctx.unsubscribeUrl : null;
      try {
        const { data: sendData, error: sendErr } = await resend.emails.send({
          from: fromEmail,
          to: [row.contact_email],
          subject: step.subject(ctx),
          html: step.html(ctx),
          // RFC 8058 one-click unsubscribe for cold/marketing sends.
          ...(unsubUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${unsubUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        });
        if (sendErr) {
          // Release the claim so a later run retries this step.
          await admin.from("email_sequence_sends")
            .delete()
            .eq("enrollment_id", row.id)
            .eq("step_index", row.current_step)
            .eq("cycle", row.cycle);
          errors.push(`${row.id}: resend ${sendErr.message}`);
          continue;
        }
        if (sendData?.id) {
          await admin.from("email_sequence_sends")
            .update({ resend_id: sendData.id })
            .eq("enrollment_id", row.id)
            .eq("step_index", row.current_step)
            .eq("cycle", row.cycle);
        }
        sent++;
      } catch (e) {
        await admin.from("email_sequence_sends")
          .delete()
          .eq("enrollment_id", row.id)
          .eq("step_index", row.current_step)
          .eq("cycle", row.cycle);
        errors.push(`${row.id}: ${e instanceof Error ? e.message : "send_failed"}`);
        continue;
      }
    }

    // Advance the enrollment.
    const nextStep = seq.steps[row.current_step + 1];
    const enrolledMs = new Date(row.enrolled_at).getTime();
    const patch: Record<string, unknown> = { last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    if (nextStep) {
      patch.current_step = row.current_step + 1;
      patch.next_send_at = new Date(enrolledMs + nextStep.offsetHours * HOUR_MS).toISOString();
    } else if (seq.recurring) {
      // Loop: reset to step 0, bump the cycle, schedule the next round.
      patch.current_step = 0;
      patch.cycle = row.cycle + 1;
      patch.next_send_at = new Date(Date.now() + (seq.recurEveryHours ?? 365 * 24) * HOUR_MS).toISOString();
    } else {
      patch.status = "completed";
      completed++;
    }

    await admin.from("email_sequence_enrollments").update(patch).eq("id", row.id);
  }

  return NextResponse.json({
    ok: true,
    processed: due.length,
    sent,
    completed,
    skipped,
    errors: errors.length ? errors : undefined,
  });
}
