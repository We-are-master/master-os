-- Link internal people (payroll_internal_costs) to squads — single roster in People.

ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS squad_id uuid REFERENCES public.squads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payroll_internal_costs_squad_id_idx
  ON public.payroll_internal_costs(squad_id)
  WHERE squad_id IS NOT NULL;

COMMENT ON COLUMN public.payroll_internal_costs.squad_id IS 'Optional squad (London, Midlands, …) — managed from People.';
