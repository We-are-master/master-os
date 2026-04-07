-- Short slug + structured requested-docs payload for partner_document_requests.
--
-- Why slug: the existing HMAC token (~120 chars) is too long to share over WhatsApp / SMS.
-- A 12-char base32 slug (60 bits of entropy) is short enough to paste anywhere AND can't
-- be brute-forced in any practical timeframe (DB lookup cost + Vercel/Cloudflare rate
-- limits would block any meaningful attack). Each public route still re-checks the row
-- for revoked_at / expires_at on every hit, so revoking remains instant.
--
-- Why requested_docs jsonb: the original `requested_doc_types text[]` only knows generic
-- types (e.g. "certification") and loses the human label the admin actually clicked
-- ("NICEIC", "Public Liability Insurance"). The partner page needs the labels so it can
-- show one upload card per required item.

ALTER TABLE public.partner_document_requests
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS requested_docs jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_document_requests_slug
  ON public.partner_document_requests (slug)
  WHERE slug IS NOT NULL;
