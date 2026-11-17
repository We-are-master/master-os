-- Lead do formulário instantâneo da Meta: guarda os ids do anúncio (leadgen_id,
-- ad_id, campanha...) e a marca de compra enviada de volta à Meta.
-- Aditiva: coluna nula, nada existente muda.
alter table public.leads add column if not exists raw jsonb;

create index if not exists leads_raw_leadgen_id_idx
  on public.leads ((raw->>'leadgen_id'))
  where raw ? 'leadgen_id';

notify pgrst, 'reload schema';
