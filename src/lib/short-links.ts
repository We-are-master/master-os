/**
 * Tiny server-side helper for the public-link-friendlier system.
 *
 * Long HMAC tokens shared via WhatsApp/email become unreadable URLs — this
 * stores them under an 8-char slug. The office shares `/r/<slug>` and the
 * runtime route redirects to the real target_path.
 *
 * Idempotency: when `entity_ref` is provided we re-use the existing row
 * for that entity instead of stacking new slugs — so refreshing the
 * "Copy link" button always shows the same short URL.
 */

import { createServiceClient } from "@/lib/supabase/service";

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // base57, no 0/O/o/l/1/I
const SLUG_LEN = 8;

function randomSlug(len = SLUG_LEN): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export interface UpsertShortLinkInput {
  /** Target path including the long token, e.g. `/quote/respond?token=...` */
  targetPath: string;
  /** Optional grouping tag (e.g. "partner_report" / "partner_bid"). */
  kind?: string;
  /** Optional canonical entity reference for idempotent re-use of the same slug. */
  entityRef?: string;
  /** Optional uuid of the staff member that created this link. */
  createdBy?: string | null;
}

/** Stable short-link keys — accept and report must not share one entity_ref. */
export function jobPartnerShortLinkEntityRef(
  jobId: string,
  partnerId: string,
  purpose: "accept" | "report",
): string {
  return `job:${jobId}:partner:${partnerId}:${purpose}`;
}

/**
 * Returns `{ slug, shortPath }` for a slug pointing to `targetPath`.
 * If `entityRef` is set and a row already exists for it, the existing slug
 * is updated (target_path refreshed) and returned — so callers can rely on
 * one stable short URL per logical entity.
 */
export async function upsertShortLink(input: UpsertShortLinkInput): Promise<{ slug: string; shortPath: string }> {
  const admin = createServiceClient();

  if (input.entityRef) {
    const { data: existing } = await admin
      .from("short_links")
      .select("slug")
      .eq("entity_ref", input.entityRef)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.slug) {
      // Refresh the target_path so partner / job reassignment automatically
      // propagates to the same short URL.
      await admin
        .from("short_links")
        .update({ target_path: input.targetPath })
        .eq("slug", existing.slug);
      return { slug: existing.slug as string, shortPath: `/r/${existing.slug}` };
    }
  }

  // Insert with a freshly generated slug; retry on the rare collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const { error } = await admin.from("short_links").insert({
      slug,
      target_path: input.targetPath,
      kind:        input.kind ?? null,
      entity_ref:  input.entityRef ?? null,
      created_by:  input.createdBy ?? null,
    });
    if (!error) return { slug, shortPath: `/r/${slug}` };
    // 23505 = unique_violation
    if ((error as { code?: string }).code !== "23505") {
      throw error;
    }
  }
  throw new Error("short_link slug allocation failed after multiple attempts");
}
