-- Existing uploads with no review status were treated as implicitly approved in the UI.
-- New workflow uses pending → approved/rejected. Backfill legacy rows that already have a file.
UPDATE public.partner_documents
SET status = 'approved'
WHERE coalesce(trim(status), '') = ''
  AND file_path IS NOT NULL
  AND coalesce(trim(file_path), '') <> '';
