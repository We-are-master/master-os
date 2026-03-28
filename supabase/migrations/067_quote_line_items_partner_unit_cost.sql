-- Partner cost per unit on each proposal line (labour / materials split from bid, or manual)
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS partner_unit_cost numeric DEFAULT 0;
