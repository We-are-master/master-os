ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS customer_pdf_sent_at timestamptz;

COMMENT ON COLUMN quotes.customer_pdf_sent_at IS 'Set when the customer quote PDF was successfully emailed; used to hide the initial Save & email block after first send.';
