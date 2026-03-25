ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS email_custom_message text;

COMMENT ON COLUMN quotes.email_custom_message IS 'Optional personal message for the customer email / PDF intro.';
