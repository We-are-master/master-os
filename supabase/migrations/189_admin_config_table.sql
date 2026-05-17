-- Navigation + Roles & Permissions (Settings tabs). Key/value JSON store.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.admin_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_config IS
  'Admin-only config: navigation (sidebar), permissions matrix. Keys: navigation, permissions.';

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_config_select_authenticated ON public.admin_config;
CREATE POLICY admin_config_select_authenticated
  ON public.admin_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS admin_config_insert_admin ON public.admin_config;
CREATE POLICY admin_config_insert_admin
  ON public.admin_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  );

DROP POLICY IF EXISTS admin_config_update_admin ON public.admin_config;
CREATE POLICY admin_config_update_admin
  ON public.admin_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  );

DROP POLICY IF EXISTS admin_config_delete_admin ON public.admin_config;
CREATE POLICY admin_config_delete_admin
  ON public.admin_config
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_config TO authenticated;
