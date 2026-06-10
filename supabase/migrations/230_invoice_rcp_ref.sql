-- Customer billing references: RCP (receipt / statement of charges), not VAT invoices.
-- Replaces next_invoice_ref output from INV-* to RCP-* for new rows.

CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1;

CREATE OR REPLACE FUNCTION public.next_invoice_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  yr text := to_char(now(), 'YYYY');
  n bigint;
BEGIN
  n := nextval('public.invoice_seq');
  RETURN 'RCP-' || yr || '-' || n::text;
END;
$$;

-- Continue numbering after existing INV / RC / RCP references.
DO $$
DECLARE
  max_n bigint;
BEGIN
  SELECT COALESCE(
    MAX((regexp_match(reference, '^(?:INV|RCP|RC)-\d{4}-(\d+)$'))[1]::bigint),
    0
  )
  INTO max_n
  FROM public.invoices
  WHERE reference ~ '^(?:INV|RCP|RC)-\d{4}-\d+$';

  IF max_n > 0 THEN
    PERFORM setval('public.invoice_seq', max_n, true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_ref() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_ref() TO service_role;
