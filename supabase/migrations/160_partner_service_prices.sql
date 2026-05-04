-- =============================================================================
-- Migration 160: partner_service_prices — per-partner override of what we
--                pay a specific partner for a specific catalog service.
-- =============================================================================
--
-- Mirror of mig 159 but on the cost side. Resolution at job creation:
--   if (override.use_standard) → use service_catalog.partner_cost / partner_rate
--   else                       → use override values
--
-- pricing_mode inherits from catalog (not overridable).
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.partner_service_prices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL REFERENCES public.partners(id)        ON DELETE CASCADE,
  catalog_service_id    uuid NOT NULL REFERENCES public.service_catalog(id) ON DELETE CASCADE,

  /** When true, jobs use the catalog standard cost. When false, override below wins. */
  use_standard          boolean NOT NULL DEFAULT true,

  /** Override values — meaningful only when use_standard = false. */
  fixed_partner_cost    numeric,
  hourly_partner_rate   numeric,
  default_hours         numeric,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_service_prices_live
  ON public.partner_service_prices (partner_id, catalog_service_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partner_service_prices_partner
  ON public.partner_service_prices (partner_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partner_service_prices_service
  ON public.partner_service_prices (catalog_service_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_partner_service_prices_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_partner_service_prices_updated_at
  ON public.partner_service_prices;
CREATE TRIGGER trg_touch_partner_service_prices_updated_at
  BEFORE UPDATE ON public.partner_service_prices
  FOR EACH ROW EXECUTE FUNCTION public.touch_partner_service_prices_updated_at();

ALTER TABLE public.partner_service_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psp_authenticated_all"
  ON public.partner_service_prices;
CREATE POLICY "psp_authenticated_all"
  ON public.partner_service_prices
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.partner_service_prices IS
  'Per-partner override of what we pay a partner for a catalog service. Nothing-set or use_standard=true → catalog default. Affects only NEW jobs.';
