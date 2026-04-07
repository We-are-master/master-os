-- Partner portal magic links (hashed tokens) + widen partner_documents.doc_type to match OS usage.

-- ---------------------------------------------------------------------------
-- partner_portal_tokens: opaque tokens for unauthenticated document upload pages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_portal_tokens_partner_id ON public.partner_portal_tokens(partner_id);

COMMENT ON TABLE public.partner_portal_tokens IS
  'SHA-256 hashes of portal URL tokens; resolved server-side with service role only.';

ALTER TABLE public.partner_portal_tokens ENABLE ROW LEVEL SECURITY;

-- No GRANT to anon/authenticated — only service role (bypasses RLS) reads/writes.

-- ---------------------------------------------------------------------------
-- Widen doc_type check (dashboard + app use values beyond initial migration)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'partner_documents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%doc_type%'
  ) LOOP
    EXECUTE format('ALTER TABLE public.partner_documents DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.partner_documents ADD CONSTRAINT partner_documents_doc_type_check CHECK (
  doc_type IN (
    'insurance',
    'certification',
    'license',
    'contract',
    'tax',
    'id_proof',
    'other',
    'utr',
    'service_agreement',
    'self_bill_agreement',
    'proof_of_address',
    'right_to_work',
    'poa',
    'dbs'
  )
);
