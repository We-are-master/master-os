-- Partner document/profile self-update requests.
-- An admin generates a tokenized link → partner uses it to upload missing documents
-- and update profile fields without needing a dashboard login. The token is verified
-- against this row (so we can revoke / track expiry / audit who issued it).
--
-- Tokens are signed via HMAC (see src/lib/partner-upload-token.ts) but each token
-- carries the request id and is checked against this table on every public hit, so
-- revoking a row invalidates the link immediately.

CREATE TABLE IF NOT EXISTS public.partner_document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  /** Doc types the admin wants this partner to (re)upload — empty array means "any". */
  requested_doc_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Optional message shown to the partner on the public page + in the email body. */
  custom_message text,
  /** Auth user id of the admin who generated the link. */
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name text,
  /** Email the link was sent to (snapshot in case partner.email changes later). */
  sent_to_email text,
  expires_at timestamptz NOT NULL,
  /** Set the first time the partner opens the link successfully. */
  first_used_at timestamptz,
  /** Updated on every successful action (upload / profile patch) for audit. */
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  /** Manual revoke (admin pulls the link before expiry). */
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_document_requests_partner
  ON public.partner_document_requests (partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_document_requests_active
  ON public.partner_document_requests (partner_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.partner_document_requests ENABLE ROW LEVEL SECURITY;

-- Dashboard (authenticated) can manage requests for any partner.
-- Public access happens via service-role inside API routes after token verification —
-- the anon role intentionally has NO policy.
DROP POLICY IF EXISTS "Authenticated can read partner_document_requests" ON public.partner_document_requests;
CREATE POLICY "Authenticated can read partner_document_requests"
  ON public.partner_document_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert partner_document_requests" ON public.partner_document_requests;
CREATE POLICY "Authenticated can insert partner_document_requests"
  ON public.partner_document_requests FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update partner_document_requests" ON public.partner_document_requests;
CREATE POLICY "Authenticated can update partner_document_requests"
  ON public.partner_document_requests FOR UPDATE TO authenticated USING (true);

-- Trigger to keep updated_at fresh.
CREATE TRIGGER update_partner_document_requests_updated_at
  BEFORE UPDATE ON public.partner_document_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
