-- Area coverage (multi-select in OS) vs home/business address line.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS uk_coverage_regions text[];
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_address text;

COMMENT ON COLUMN partners.uk_coverage_regions IS
  'UK areas covered; __whole_uk__ alone means nationwide.';
COMMENT ON COLUMN partners.partner_address IS
  'Home or registered business address (free text).';
