-- 307 · Harvey no WhatsApp: quem está escrevendo
--
-- Desde 29/09/2026 o Harvey reconhece pelo telefone se é parceiro ou cliente:
-- parceiro fala de documentos, ativação e jobs; cliente compra e acompanha as
-- reservas. No Zendesk o parceiro vai para a org dele e o grupo Partners, o
-- cliente para a org Fixfy Customers com o perfil preenchido.

alter table public.harvey_wa_conversas
  add column if not exists tipo text check (tipo in ('parceiro', 'cliente', 'novo')),
  add column if not exists partner_id uuid references public.partners(id) on delete set null,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists zendesk_em timestamptz,
  add column if not exists zendesk_resultado text;
