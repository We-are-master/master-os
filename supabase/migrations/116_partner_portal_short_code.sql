-- Short public URLs for partner document portal (WhatsApp-friendly).
ALTER TABLE public.partner_portal_tokens
  ADD COLUMN IF NOT EXISTS short_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_portal_tokens_short_code
  ON public.partner_portal_tokens (short_code)
  WHERE short_code IS NOT NULL;

COMMENT ON COLUMN public.partner_portal_tokens.short_code IS
  'Optional lowercase alphanumeric code for /partner-upload?code=… (token hash remains primary secret).';
