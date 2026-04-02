-- UK service areas for partners (multi-select in OS; __whole_uk__ = covers all UK).
ALTER TABLE partners ADD COLUMN IF NOT EXISTS uk_coverage_regions text[];

COMMENT ON COLUMN partners.uk_coverage_regions IS
  'Areas this partner covers (London, South East, …). Single element __whole_uk__ means nationwide.';
