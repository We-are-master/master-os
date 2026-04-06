-- Company bills: allow app cadences weekly_friday / biweekly_friday (Postgres CHECK was rejecting inserts with 400).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE t.relname = 'bills'
      AND n.nspname = 'public'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%recurrence_interval%'
  LOOP
    EXECUTE format('ALTER TABLE public.bills DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.bills ADD CONSTRAINT bills_recurrence_interval_check CHECK (
  recurrence_interval IS NULL
  OR recurrence_interval IN (
    'weekly',
    'weekly_friday',
    'biweekly_friday',
    'monthly',
    'quarterly',
    'yearly'
  )
);

COMMENT ON COLUMN public.bills.recurrence_interval IS
  'weekly | weekly_friday | biweekly_friday | monthly | quarterly | yearly — pre-generated occurrences';
