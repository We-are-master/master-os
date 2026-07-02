/**
 * Enrollment helpers — call these from your app's event handlers to drive the
 * lifecycle. The cron engine does the sending; these just manage state.
 *
 *   enrollInSequence({ sequenceKey: "client_demand_nurture", email, name, context })
 *   markConverted("client_demand_nurture", email)   // stops nurture on booking
 *   stopSequence("client_demand_nurture", email)     // hard stop / unsubscribe
 */

import { createServiceClient } from "@/lib/supabase/service";
import { getSequence } from "./definitions";
import type { SequenceContext } from "./types";

const HOUR_MS = 60 * 60 * 1000;

export type EnrollInput = {
  sequenceKey: string;
  email: string;
  name?: string;
  context?: SequenceContext;
};

export type EnrollResult =
  | { ok: true; enrollmentId: string; alreadyActive: boolean }
  | { ok: false; reason: string };

/**
 * Enroll a contact. If an active enrollment already exists for this
 * (sequence, email) it's left untouched (idempotent — safe to call on retries).
 */
export async function enrollInSequence(input: EnrollInput): Promise<EnrollResult> {
  const seq = getSequence(input.sequenceKey);
  if (!seq) return { ok: false, reason: "unknown_sequence" };
  if (seq.steps.length === 0) return { ok: false, reason: "empty_sequence" };

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "invalid_email" };

  const admin = createServiceClient();

  const { data: existing } = await admin
    .from("email_sequence_enrollments")
    .select("id")
    .eq("sequence_key", seq.key)
    .eq("contact_email", email)
    .eq("status", "active")
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, enrollmentId: existing.id as string, alreadyActive: true };
  }

  const firstDelayMs = seq.steps[0].offsetHours * HOUR_MS;
  const nextSendAt = new Date(Date.now() + firstDelayMs).toISOString();

  const { data, error } = await admin
    .from("email_sequence_enrollments")
    .insert({
      sequence_key: seq.key,
      contact_email: email,
      contact_name: input.name?.trim() || null,
      context: input.context ?? {},
      current_step: 0,
      status: "active",
      next_send_at: nextSendAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Unique-active index race: another request enrolled first — treat as success.
    if (error?.code === "23505") {
      return { ok: true, enrollmentId: "", alreadyActive: true };
    }
    return { ok: false, reason: error?.message ?? "insert_failed" };
  }

  return { ok: true, enrollmentId: data.id as string, alreadyActive: false };
}

async function setStatus(
  sequenceKey: string,
  email: string,
  status: "converted" | "stopped",
): Promise<number> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("email_sequence_enrollments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("sequence_key", sequenceKey)
    .eq("contact_email", email.trim().toLowerCase())
    .eq("status", "active")
    .select("id");
  return data?.length ?? 0;
}

/** Conversion event (e.g. a booking) — stops the nurture sequence. */
export function markConverted(sequenceKey: string, email: string): Promise<number> {
  return setStatus(sequenceKey, email, "converted");
}

/** Hard stop (unsubscribe, bounce, manual). */
export function stopSequence(sequenceKey: string, email: string): Promise<number> {
  return setStatus(sequenceKey, email, "stopped");
}

/** Stop every active sequence for a contact (global unsubscribe). */
export async function stopAllSequences(email: string): Promise<number> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("email_sequence_enrollments")
    .update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("contact_email", email.trim().toLowerCase())
    .eq("status", "active")
    .select("id");
  return data?.length ?? 0;
}
