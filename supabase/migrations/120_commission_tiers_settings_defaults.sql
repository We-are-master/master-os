-- Commission tiers/settings foundation for Settings > Commission Tiers tab.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.commission_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_number int NOT NULL,
  breakeven_amount numeric NOT NULL DEFAULT 0,
  rate_percent numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commission_tiers_tier_number_unique'
      AND conrelid = 'public.commission_tiers'::regclass
  ) THEN
    ALTER TABLE public.commission_tiers
      ADD CONSTRAINT commission_tiers_tier_number_unique UNIQUE (tier_number);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.commission_pool_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  share_percent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commission_pool_shares_role_unique'
      AND conrelid = 'public.commission_pool_shares'::regclass
  ) THEN
    ALTER TABLE public.commission_pool_shares
      ADD CONSTRAINT commission_pool_shares_role_unique UNIQUE (role);
  END IF;
END $$;

ALTER TABLE public.commission_pool_shares
  DROP CONSTRAINT IF EXISTS commission_pool_shares_role_check;

ALTER TABLE public.commission_pool_shares
  ADD CONSTRAINT commission_pool_shares_role_check
  CHECK (role IN ('head_ops', 'am', 'biz_dev'));

INSERT INTO public.commission_tiers (tier_number, breakeven_amount, rate_percent, sort_order)
VALUES
  (1, 0, 0, 1),
  (2, 35000, 10, 2),
  (3, 40000, 20, 3)
ON CONFLICT (tier_number) DO NOTHING;

INSERT INTO public.commission_pool_shares (role, share_percent)
VALUES
  ('head_ops', 40),
  ('am', 40),
  ('biz_dev', 20)
ON CONFLICT (role) DO NOTHING;

