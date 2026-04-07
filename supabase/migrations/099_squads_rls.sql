-- Optional: if inserts/selects on public.squads fail with row-level security errors,
-- run this migration (or paste the statements in the Supabase SQL editor).
-- Adjust TO roles if your app uses a custom role instead of `authenticated`.

ALTER TABLE public.squads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "squads_select_authenticated" ON public.squads;
CREATE POLICY "squads_select_authenticated"
  ON public.squads
  FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "squads_insert_authenticated" ON public.squads;
CREATE POLICY "squads_insert_authenticated"
  ON public.squads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "squads_update_authenticated" ON public.squads;
CREATE POLICY "squads_update_authenticated"
  ON public.squads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
