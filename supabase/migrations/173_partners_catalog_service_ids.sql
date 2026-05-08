-- Link partners to Services catalog rows (types of work) for matching and pricing UX.
-- Legacy string trades remain; this column is populated from them and can be edited in the UI.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS catalog_service_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.partners.catalog_service_ids IS
  'Subset of service_catalog.id matching this partner''s trades; used for partner↔job matching. Empty = rely on trade string fields only.';

CREATE INDEX IF NOT EXISTS idx_partners_catalog_service_ids
  ON public.partners USING gin (catalog_service_ids);

-- Best-effort backfill: map existing trade / trades strings to catalog rows by normalised name.
UPDATE public.partners p
SET catalog_service_ids = COALESCE((
  SELECT array_agg(DISTINCT sc.id)
  FROM (
    SELECT trim(nm) AS nm
    FROM unnest(COALESCE(p.trades, ARRAY[]::text[])) AS u(nm)
    WHERE trim(nm) <> ''
    UNION
    SELECT trim(p.trade)
    WHERE p.trade IS NOT NULL AND trim(p.trade) <> ''
  ) tn
  INNER JOIN public.service_catalog sc
    ON sc.deleted_at IS NULL
   AND lower(trim(sc.name)) = lower(trim(tn.nm))
), '{}');
