-- =============================================================================
-- Migration 159: account_service_prices — per-account override of what we
--                charge a specific account for a specific catalog service.
-- =============================================================================
--
-- Schema is purely additive: existing jobs continue to snapshot prices at
-- create time (jobs.client_price / jobs.hourly_client_rate). This table only
-- affects what the office UI auto-fills when creating NEW jobs going forward.
--
-- Resolution logic at job creation:
--   if (override.use_standard) → use service_catalog defaults
--   else                       → use override.fixed_price / hourly_rate
--
-- pricing_mode is NOT overridden — it's inherited from service_catalog
-- (a service that's hourly globally stays hourly for every account).
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.account_service_prices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id)         ON DELETE CASCADE,
  catalog_service_id  uuid NOT NULL REFERENCES public.service_catalog(id)  ON DELETE CASCADE,

  /** When true, jobs use the catalog standard. When false, the columns below win. */
  use_standard        boolean NOT NULL DEFAULT true,

  /** Override values — meaningful only when use_standard = false. NULL columns
   *  signal "not set", in which case the catalog standard is used as fallback
   *  for that specific field. Lets office override only the hourly rate while
   *  keeping default_hours from the catalog, for example. */
  fixed_price         numeric,
  hourly_rate         numeric,
  default_hours       numeric,

  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One live override per (account, service).
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_service_prices_live
  ON public.account_service_prices (account_id, catalog_service_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_service_prices_account
  ON public.account_service_prices (account_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_service_prices_service
  ON public.account_service_prices (catalog_service_id)
  WHERE deleted_at IS NULL;

-- Touch updated_at on edit.
CREATE OR REPLACE FUNCTION public.touch_account_service_prices_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_account_service_prices_updated_at
  ON public.account_service_prices;
CREATE TRIGGER trg_touch_account_service_prices_updated_at
  BEFORE UPDATE ON public.account_service_prices
  FOR EACH ROW EXECUTE FUNCTION public.touch_account_service_prices_updated_at();

-- RLS: staff full access; we don't expose this table to portal users.
ALTER TABLE public.account_service_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asp_authenticated_all"
  ON public.account_service_prices;
CREATE POLICY "asp_authenticated_all"
  ON public.account_service_prices
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.account_service_prices IS
  'Per-account override of what an account pays for a catalog service. Nothing-set or use_standard=true → catalog default. Affects only NEW jobs (existing jobs snapshot at create time).';
