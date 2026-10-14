-- Pedido de feedback pós-job por WhatsApp, por conta (dono, 14/10/2026).
--
-- O feedback é para o cliente B2C da própria Fixfy (cliente sem conta ou na
-- conta "Fixfy"). Cliente de conta B2B é da conta, não nosso: só recebe o
-- pedido quando a conta liga isto. Nasce desligado para todas.
--
-- Separado de `client_confirmation_whatsapp` (mig 259) de propósito: confirmar
-- a visita é operação (a Housekeep quer), pedir nota é relacionamento (a
-- Housekeep pode não querer). Uma chave para as duas obrigaria a escolher mal.

alter table public.accounts
  add column if not exists client_feedback_whatsapp boolean not null default false;

comment on column public.accounts.client_feedback_whatsapp is
  'Quando true, os clientes desta conta recebem o WhatsApp de feedback 1 dia depois do job concluído (cron /api/cron/feedback-pos-job). Clientes B2C da Fixfy (sem conta ou conta Fixfy) recebem sempre, sem olhar esta coluna.';
