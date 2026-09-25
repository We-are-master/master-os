-- Passo "Tools & materials" do /get-started (dono, 25/09/2026): ter as próprias
-- ferramentas e poder fornecer material são essenciais para trabalhar com a
-- Fixfy. O funil só avança com os dois "sim"; ficam gravados no parceiro para
-- a revisão no OS.

alter table public.partners
  add column if not exists has_own_tools boolean,
  add column if not exists can_supply_materials boolean;

comment on column public.partners.has_own_tools is 'Onboarding: partner confirmed they have all the tools and equipment for their trades.';
comment on column public.partners.can_supply_materials is 'Onboarding: partner confirmed they can supply the materials a job needs.';

notify pgrst, 'reload schema';
