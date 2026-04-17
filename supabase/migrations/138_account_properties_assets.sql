-- =============================================================================
-- Migration 138: Account properties (Assets / Sites) + portal contact link
-- =============================================================================
-- Physical operational sites belong to Accounts. Contacts are `clients` rows
-- with source_account_id. Portal users may optionally link to one contact.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. account_properties (Assets / Sites)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_properties (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name               text        NOT NULL,
  full_address       text        NOT NULL,
  property_type      text        NOT NULL,
  primary_contact_id uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  phone              text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_properties_account_id
  ON public.account_properties (account_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_properties_primary_contact
  ON public.account_properties (primary_contact_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.account_properties IS
  'Physical sites / properties linked to a corporate account. Not the account billing address.';

-- Primary contact must be a client (contact) of the same account
CREATE OR REPLACE FUNCTION public.account_properties_check_primary_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.primary_contact_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = NEW.primary_contact_id
        AND c.source_account_id = NEW.account_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Primary site contact must be a contact (client) of the linked account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_properties_primary_contact ON public.account_properties;
CREATE TRIGGER trg_account_properties_primary_contact
  BEFORE INSERT OR UPDATE ON public.account_properties
  FOR EACH ROW EXECUTE FUNCTION public.account_properties_check_primary_contact();

CREATE OR REPLACE FUNCTION public.account_properties_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_properties_updated_at ON public.account_properties;
CREATE TRIGGER trg_account_properties_updated_at
  BEFORE UPDATE ON public.account_properties
  FOR EACH ROW EXECUTE FUNCTION public.account_properties_set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Portal user → optional contact (client) on same account
-- -----------------------------------------------------------------------------
ALTER TABLE public.account_portal_users
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_account_portal_users_contact_id
  ON public.account_portal_users (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.account_portal_users_check_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = NEW.contact_id
        AND c.source_account_id = NEW.account_id
        AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Portal contact must belong to the same account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_portal_users_contact ON public.account_portal_users;
CREATE TRIGGER trg_account_portal_users_contact
  BEFORE INSERT OR UPDATE ON public.account_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.account_portal_users_check_contact();

-- -----------------------------------------------------------------------------
-- 3. Link pipeline rows to property + denormalized account on requests
-- -----------------------------------------------------------------------------
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.account_properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_account_id ON public.service_requests (account_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_property_id ON public.service_requests (property_id);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.account_properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_property_id ON public.jobs (property_id);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.account_properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_property_id ON public.quotes (property_id);

-- Backfill account_id from linked client where possible
UPDATE public.service_requests sr
SET account_id = c.source_account_id
FROM public.clients c
WHERE sr.client_id = c.id
  AND sr.account_id IS NULL
  AND c.source_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Documents per property
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_property_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid        NOT NULL REFERENCES public.account_properties(id) ON DELETE CASCADE,
  file_name    text        NOT NULL,
  storage_path text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  uploaded_by  text
);

CREATE INDEX IF NOT EXISTS idx_account_property_documents_property
  ON public.account_property_documents (property_id);

-- -----------------------------------------------------------------------------
-- 5. Storage bucket (private — access via signed URLs / service role)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-property-docs',
  'account-property-docs',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Dashboard staff: direct storage access. Portal uses API + service role + signed URLs.
DROP POLICY IF EXISTS "account_property_docs_staff_select" ON storage.objects;
DROP POLICY IF EXISTS "account_property_docs_staff_insert" ON storage.objects;
DROP POLICY IF EXISTS "account_property_docs_staff_update" ON storage.objects;
DROP POLICY IF EXISTS "account_property_docs_staff_delete" ON storage.objects;

CREATE POLICY "account_property_docs_staff_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'account-property-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "account_property_docs_staff_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'account-property-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "account_property_docs_staff_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'account-property-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "account_property_docs_staff_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'account-property-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 6. RLS — staff (profiles) full access; portal users scoped to their account
-- -----------------------------------------------------------------------------
ALTER TABLE public.account_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_property_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_properties_staff_all" ON public.account_properties;
DROP POLICY IF EXISTS "account_properties_portal_select" ON public.account_properties;
DROP POLICY IF EXISTS "account_properties_portal_insert" ON public.account_properties;
DROP POLICY IF EXISTS "account_properties_portal_update" ON public.account_properties;

CREATE POLICY "account_properties_staff_all"
  ON public.account_properties FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "account_properties_portal_select"
  ON public.account_properties FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_portal_users apu
      WHERE apu.id = auth.uid()
        AND apu.account_id = account_properties.account_id
    )
  );

CREATE POLICY "account_properties_portal_insert"
  ON public.account_properties FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_portal_users apu
      WHERE apu.id = auth.uid()
        AND apu.account_id = account_properties.account_id
    )
  );

CREATE POLICY "account_properties_portal_update"
  ON public.account_properties FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_portal_users apu
      WHERE apu.id = auth.uid()
        AND apu.account_id = account_properties.account_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_portal_users apu
      WHERE apu.id = auth.uid()
        AND apu.account_id = account_properties.account_id
    )
  );

DROP POLICY IF EXISTS "account_property_documents_staff_all" ON public.account_property_documents;
DROP POLICY IF EXISTS "account_property_documents_portal" ON public.account_property_documents;

CREATE POLICY "account_property_documents_staff_all"
  ON public.account_property_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "account_property_documents_portal_select"
  ON public.account_property_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_properties ap
      JOIN public.account_portal_users apu ON apu.account_id = ap.account_id
      WHERE ap.id = account_property_documents.property_id
        AND apu.id = auth.uid()
    )
  );

CREATE POLICY "account_property_documents_portal_insert"
  ON public.account_property_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_properties ap
      JOIN public.account_portal_users apu ON apu.account_id = ap.account_id
      WHERE ap.id = account_property_documents.property_id
        AND apu.id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_properties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_property_documents TO authenticated;
