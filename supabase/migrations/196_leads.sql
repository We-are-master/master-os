-- Migration 196: Leads — pre-quote opportunities offered to partners
--
-- Ops captures name, urgency, and scope; status flows New → Interested
-- before publishing to the partner network (future: lead_partner_offers).

CREATE SEQUENCE IF NOT EXISTS public.lead_seq START 1;

CREATE OR REPLACE FUNCTION public.next_lead_ref()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'LD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.lead_seq')::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_lead_ref() TO authenticated;

CREATE TABLE IF NOT EXISTS public.leads (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    text        UNIQUE NOT NULL,
  name         text        NOT NULL,
  urgency      text        NOT NULL DEFAULT 'medium'
               CHECK (urgency IN ('low', 'medium', 'high', 'urgent')),
  scope        text        NOT NULL DEFAULT '',
  status       text        NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'interested')),
  owner_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  deleted_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status_created
  ON public.leads (status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_name_search
  ON public.leads (name)
  WHERE deleted_at IS NULL;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_staff_all" ON public.leads;
CREATE POLICY "leads_staff_all"
  ON public.leads FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

GRANT SELECT, INSERT, UPDATE ON public.leads TO authenticated;

COMMENT ON TABLE public.leads IS
  'Pre-quote leads (name, urgency, scope). Status: new → interested; published_at marks partner-visible offers.';

-- Partner offer tracking (invite / publish flow)
CREATE TABLE IF NOT EXISTS public.lead_partner_offers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  partner_id  uuid        NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  offered_at  timestamptz NOT NULL DEFAULT now(),
  offered_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (lead_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_partner_offers_lead_id
  ON public.lead_partner_offers (lead_id);

ALTER TABLE public.lead_partner_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_partner_offers_staff_all" ON public.lead_partner_offers;
CREATE POLICY "lead_partner_offers_staff_all"
  ON public.lead_partner_offers FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_partner_offers TO authenticated;

-- Extend status counts RPC for Leads tabs
CREATE OR REPLACE FUNCTION public.get_status_counts(
  p_table_name text,
  p_statuses text[],
  p_status_column text DEFAULT 'status',
  p_date_column text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS TABLE(status text, count bigint, total bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_where text;
  v_total bigint := 0;
  v_sql text;
BEGIN
  IF p_table_name NOT IN (
    'quotes',
    'service_requests',
    'jobs',
    'partners',
    'accounts',
    'clients',
    'leads'
  ) THEN
    RAISE EXCEPTION 'Unsupported table for get_status_counts: %', p_table_name;
  END IF;

  IF p_status_column IS NULL OR p_status_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid status column: %', p_status_column;
  END IF;

  v_table := quote_ident(p_table_name);

  IF p_table_name = 'partners' THEN
    v_where := 'TRUE';
  ELSE
    v_where := 'deleted_at IS NULL';
  END IF;

  IF p_date_column IS NOT NULL AND p_date_column <> '' THEN
    IF p_date_column !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid date column: %', p_date_column;
    END IF;
    IF p_date_from IS NOT NULL THEN
      v_where := v_where || format(' AND %I >= %L::timestamptz', p_date_column, p_date_from);
    END IF;
    IF p_date_to IS NOT NULL THEN
      v_where := v_where || format(' AND %I <= %L::timestamptz', p_date_column, p_date_to);
    END IF;
  END IF;

  v_sql := format('SELECT count(*) FROM %s WHERE %s', v_table, v_where);
  EXECUTE v_sql INTO v_total;

  v_sql := format(
    'WITH grouped AS (
       SELECT %1$I::text AS status, count(*)::bigint AS c
       FROM %2$s
       WHERE %3$s
       GROUP BY 1
     )
     SELECT s.status, COALESCE(g.c, 0)::bigint AS count, %4$L::bigint AS total
     FROM unnest($1::text[]) AS s(status)
     LEFT JOIN grouped g USING(status)',
    p_status_column,
    v_table,
    v_where,
    v_total
  );

  RETURN QUERY EXECUTE v_sql USING COALESCE(p_statuses, ARRAY[]::text[]);
END;
$$;
