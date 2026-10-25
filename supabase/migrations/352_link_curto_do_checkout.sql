-- 352: o link de pagamento do Harvey fica curto (dono, 25/10/2026).
--
-- O WhatsApp mandava o URL inteiro do checkout da Stripe (~600 caracteres) ao
-- cliente. Agora o Harvey manda https://app.getfixfy.com/pay/FX-XXXXXX e a rota
-- /pay redireciona para o checkout guardado aqui, pela referência da reserva.

alter table public.harvey_wa_conversas add column if not exists checkout_url text;
create index if not exists harvey_wa_conversas_checkout_ref on public.harvey_wa_conversas (checkout_ref) where checkout_ref is not null;

comment on column public.harvey_wa_conversas.checkout_url is 'Checkout da Stripe do sinal; /pay/<checkout_ref> redireciona para ele. Migration 352.';
