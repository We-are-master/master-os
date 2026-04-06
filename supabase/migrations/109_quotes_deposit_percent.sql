-- Percentage of customer sell used as deposit; deposit_required remains the computed £ amount for jobs / PDF / APIs.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_percent numeric NOT NULL DEFAULT 50;

UPDATE quotes
SET deposit_percent = LEAST(
  100,
  GREATEST(
    0,
    ROUND((COALESCE(deposit_required, 0) / NULLIF(COALESCE(total_value, 0), 0)) * 100::numeric, 2)
  )
)
WHERE COALESCE(total_value, 0) > 0.01;

COMMENT ON COLUMN quotes.deposit_percent IS 'Deposit as % of customer line total; deposit_required is derived on save.';
