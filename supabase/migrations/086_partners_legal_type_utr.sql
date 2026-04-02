-- Self-employed vs limited company; UTR for HMRC self-assessment.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_legal_type text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS utr text;

COMMENT ON COLUMN partners.partner_legal_type IS 'self_employed | limited_company — drives CRN vs UTR in UI.';
COMMENT ON COLUMN partners.utr IS 'UK Unique Taxpayer Reference (self-employed).';
