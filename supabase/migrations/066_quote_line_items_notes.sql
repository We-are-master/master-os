-- Optional per-line notes (materials included, labour notes, hourly, etc.)
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS notes text;
