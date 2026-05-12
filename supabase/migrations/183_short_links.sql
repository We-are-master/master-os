-- Migration 183: short link service
--
-- Stores short slugs that redirect to longer authenticated URLs. Used by
-- the partner-link panels (report submission, bid submission) to share
-- nicer URLs with partners — instead of pasting a 200-char HMAC URL into
-- WhatsApp, the office shares /r/AbCd1234 which redirects.

CREATE TABLE IF NOT EXISTS public.short_links (
  slug         text        PRIMARY KEY,
  target_path  text        NOT NULL,
  /** Optional grouping tag — e.g. "partner_report", "partner_bid" — for analytics. */
  kind         text,
  /** Optional entity references for joins (e.g. "job:<uuid>" / "quote:<uuid>:<partner_uuid>"). */
  entity_ref   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES public.profiles(id),
  /** Optional expiry. NULL = no expiry. */
  expires_at   timestamptz,
  /** Hit counter — bumped on each successful redirect. */
  hit_count    integer     NOT NULL DEFAULT 0,
  last_hit_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_short_links_entity_ref
  ON public.short_links (entity_ref)
  WHERE entity_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_short_links_kind
  ON public.short_links (kind)
  WHERE kind IS NOT NULL;

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

-- Staff can manage links.
DROP POLICY IF EXISTS "short_links_staff_all" ON public.short_links;
CREATE POLICY "short_links_staff_all"
  ON public.short_links FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

-- Public (anon + authed) can resolve a slug to its target — the redirect
-- needs to work for unauthenticated visitors. The target_path itself
-- carries any auth/token it needs (HMAC tokens in our case).
DROP POLICY IF EXISTS "short_links_anon_resolve" ON public.short_links;
CREATE POLICY "short_links_anon_resolve"
  ON public.short_links FOR SELECT TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.short_links IS
  'Short slug → target path lookup used by /r/[slug]. Powers nicer share URLs for partner report / bid links.';
