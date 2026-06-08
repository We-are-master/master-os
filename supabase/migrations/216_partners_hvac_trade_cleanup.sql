-- Replace legacy HVAC trade strings with catalog-backed General Maintenance and refresh ids.

-- Strip HVAC from trades[] and remap primary trade when it was HVAC.
UPDATE public.partners p
SET
  trades = (
    SELECT COALESCE(array_agg(t ORDER BY t), ARRAY[]::text[])
    FROM (
      SELECT DISTINCT trim(x) AS t
      FROM unnest(COALESCE(p.trades, ARRAY[]::text[])) AS u(x)
      WHERE trim(x) <> '' AND lower(trim(x)) <> 'hvac'
    ) s
  ),
  trade = CASE
    WHEN lower(trim(COALESCE(p.trade, ''))) = 'hvac' THEN 'General Maintenance'
    ELSE p.trade
  END
WHERE lower(trim(COALESCE(p.trade, ''))) = 'hvac'
   OR EXISTS (
     SELECT 1 FROM unnest(COALESCE(p.trades, ARRAY[]::text[])) AS u(x)
     WHERE lower(trim(x)) = 'hvac'
   );

-- Partners still on HVAC with empty trades get General Maintenance as primary.
UPDATE public.partners
SET
  trade = 'General Maintenance',
  trades = ARRAY['General Maintenance']::text[]
WHERE lower(trim(COALESCE(trade, ''))) = 'hvac'
  AND (trades IS NULL OR cardinality(trades) = 0);

-- Ensure trade matches trades[0] when trades is non-empty.
UPDATE public.partners
SET trade = trades[1]
WHERE trades IS NOT NULL
  AND cardinality(trades) > 0
  AND (trade IS NULL OR trim(trade) = '' OR trade IS DISTINCT FROM trades[1]);

-- Re-sync catalog_service_ids from trade / trades labels (migration 173 pattern).
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
   AND sc.is_active IS NOT FALSE
   AND lower(trim(sc.name)) = lower(trim(tn.nm))
), '{}'::uuid[])
WHERE catalog_service_ids IS NULL
   OR catalog_service_ids = '{}'::uuid[]
   OR lower(trim(COALESCE(trade, ''))) = 'general maintenance'
   OR EXISTS (
     SELECT 1 FROM unnest(COALESCE(trades, ARRAY[]::text[])) AS u(x)
     WHERE lower(trim(x)) = 'general maintenance'
   );
