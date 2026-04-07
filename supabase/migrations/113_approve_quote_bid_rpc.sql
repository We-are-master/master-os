-- Single round-trip to approve one bid and reject siblings (replaces 3 sequential updates from the dashboard).

CREATE OR REPLACE FUNCTION public.approve_quote_bid(p_bid_id uuid, p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT partner_id, partner_name, bid_amount
  INTO r
  FROM public.quote_bids
  WHERE id = p_bid_id AND quote_id = p_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid not found for this quote';
  END IF;

  UPDATE public.quote_bids
  SET status = 'rejected', updated_at = now()
  WHERE quote_id = p_quote_id AND id <> p_bid_id;

  UPDATE public.quote_bids
  SET status = 'approved', updated_at = now()
  WHERE id = p_bid_id;

  UPDATE public.quotes
  SET
    partner_id = r.partner_id,
    partner_name = r.partner_name,
    partner_cost = r.bid_amount,
    updated_at = now()
  WHERE id = p_quote_id;
END;
$$;

COMMENT ON FUNCTION public.approve_quote_bid(uuid, uuid) IS
  'Approves one quote_bid, rejects others on the same quote, syncs quotes.partner_* — used by Master OS quotes UI.';

REVOKE ALL ON FUNCTION public.approve_quote_bid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_quote_bid(uuid, uuid) TO authenticated;
