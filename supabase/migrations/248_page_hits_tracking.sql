-- Lightweight first-party page-hit tracking (no third-party analytics).
--
-- Powers the Partner funnel "Website" stage: how many people hit the Trade Portal
-- /get-started page. The Trade Portal records a row per visit via the service role;
-- Master OS reads the count via a SECURITY DEFINER RPC (raw count: exact/head is
-- unreliable on the self-hosted PostgREST/Kong, same reason get_status_counts exists).

CREATE TABLE IF NOT EXISTS public.page_hits (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path         text NOT NULL,
  session_id   text,
  referrer     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_hits_path_created
  ON public.page_hits (path, created_at DESC);

-- No public access: rows are written by the service role and read via the RPC below.
ALTER TABLE public.page_hits ENABLE ROW LEVEL SECURITY;

-- Robust count (optionally since a timestamp, and optionally distinct sessions).
CREATE OR REPLACE FUNCTION public.get_page_hit_count(
  p_path text,
  p_since timestamptz DEFAULT NULL,
  p_unique boolean DEFAULT false
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_unique THEN count(DISTINCT coalesce(session_id, id::text))
    ELSE count(*)
  END::bigint
  FROM public.page_hits
  WHERE path = p_path
    AND (p_since IS NULL OR created_at >= p_since);
$$;

GRANT EXECUTE ON FUNCTION public.get_page_hit_count(text, timestamptz, boolean) TO anon, authenticated, service_role;
