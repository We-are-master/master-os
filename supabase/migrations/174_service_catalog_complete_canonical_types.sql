-- =============================================================================
-- Migration 174: Ensure every canonical "type of work" exists as one service_catalog row
-- =============================================================================
-- Mirrors `CANONICAL_TYPE_OF_WORK_NAMES` in src/lib/type-of-work.ts (16 names).
-- Inserts missing rows only (case-insensitive name match). Pricing is template zeros —
-- office sets sell/partner rates in Admin → Services.
-- Idempotent.
-- =============================================================================

INSERT INTO public.service_catalog (
  name,
  pricing_mode,
  fixed_price,
  hourly_rate,
  default_hours,
  partner_cost,
  default_description,
  sort_order,
  is_active,
  created_at,
  updated_at
)
SELECT
  v.name,
  'fixed'::text,
  0::numeric,
  0::numeric,
  1::numeric,
  0::numeric,
  v.name,
  v.ord,
  true,
  now(),
  now()
FROM (
  VALUES
    ('Painter', 10),
    ('General Maintenance', 20),
    ('Plumber', 30),
    ('Electrician', 40),
    ('Builder', 50),
    ('Carpenter', 60),
    ('Cleaning', 70),
    ('Gardener', 80),
    ('Boiler Service', 90),
    ('Electrical Installation Condition Report (EICR)', 100),
    ('Portable Appliance Testing (PAT)', 110),
    ('Gas Safety Certificate (GSC)', 120),
    ('Fire Risk Assessment (FRA)', 130),
    ('Fire Alarm Certificate', 140),
    ('Emergency Lighting Certificate', 150),
    ('Fire Extinguisher Service (FES)', 160)
) AS v(name, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.service_catalog sc
  WHERE sc.deleted_at IS NULL
    AND lower(trim(sc.name)) = lower(trim(v.name))
);

COMMENT ON TABLE public.service_catalog IS
  'Office-defined services / types of work. Canonical set of 16 legacy trades is seeded via migrations 172 and 174; add rows here for new types. Pickers and pricing resolution use this table.';
