-- Office job documents (contract, RAMS, other PDFs) — public URLs in JSON; binary objects under company-assets/jobs/{id}/documents/
alter table public.jobs
  add column if not exists compliance_documents jsonb not null default '[]'::jsonb;

comment on column public.jobs.compliance_documents is
  'Array of { id, kind, label?, storage_path, public_url, mime_type, uploaded_at } for contract, rams, other.';
