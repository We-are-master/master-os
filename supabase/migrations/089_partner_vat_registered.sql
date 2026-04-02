-- VAT registered flag for limited companies (drives whether VAT number is required).
ALTER TABLE partners ADD COLUMN IF NOT EXISTS vat_registered boolean;

COMMENT ON COLUMN partners.vat_registered IS
  'Limited company: true = VAT registered (vat_number required), false = not registered, null = unset/legacy.';
