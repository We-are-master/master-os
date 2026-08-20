-- Migration 259: confirmação de agendamento por WhatsApp para o cliente final
--
-- Quem recebe é o cliente final (o morador, quem abre a porta), não a conta.
-- A decisão de mandar é POR CONTA e é comercial, não técnica: a Fantastic paga
-- o call-out quando o cliente não está, então avisar não evita prejuízo nosso
-- e a mensagem vira ruído; a Housekeep e o Checkatrade passam o número do
-- cliente e a visita perdida é nossa.
--
-- `accounts.client_confirmation_whatsapp` tem TRÊS estados de propósito:
--   true  = manda
--   false = decidido que NÃO manda
--   NULL  = ainda não decidido  ← conta B2B nova cai aqui
--
-- O NULL existe para conta nova não entrar em silêncio. Com um booleano
-- default false, um cliente novo nunca receberia aviso e ninguém perceberia;
-- com NULL a conta aparece na lista de pendências pedindo a decisão.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS client_confirmation_whatsapp boolean;

COMMENT ON COLUMN public.accounts.client_confirmation_whatsapp IS
  'Manda confirmação de agendamento por WhatsApp para o cliente final desta conta? true = manda, false = decidido que não, NULL = não decidido (conta nova: não manda e vira pendência).';

-- Idempotência do envio. Mora no job, não no respond.io: o respond.io é cano,
-- o OS é a verdade do job. Sem isto, duas execuções da rota mandariam duas
-- mensagens para o mesmo cliente.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_confirmation_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS client_confirmation_skipped    text;

COMMENT ON COLUMN public.jobs.client_confirmation_sent_at IS
  'Quando a confirmação de agendamento foi ENTREGUE ao cliente final no WhatsApp (status confirmado no respond.io, não só aceito).';
COMMENT ON COLUMN public.jobs.client_confirmation_skipped IS
  'Por que a confirmação não foi mandada, quando não foi. Preenchido = pendência visível no card. NULL com sent_at NULL = ainda não tentou.';

-- ─── A regra por conta, decidida pelo dono em 20/08/2026 ────────────────────
-- Casado por company_name porque os ids são por ambiente. Só escreve onde
-- ainda está NULL, então rodar de novo não desfaz ajuste feito na tela.

UPDATE public.accounts SET client_confirmation_whatsapp = true
 WHERE client_confirmation_whatsapp IS NULL
   AND company_name IN ('Fixfy', 'Checkatrade', 'Housekeep', 'Express',
                        'The Stylesmiths', 'Good Place Lettings');

UPDATE public.accounts SET client_confirmation_whatsapp = false
 WHERE client_confirmation_whatsapp IS NULL
   AND company_name IN ('Fantastic Services', 'Kvadrat LTD', 'Homyze', 'Li & Fung');

-- Confere o resultado. As contas que sobrarem em NULL são as não decididas.
--   SELECT company_name, client_confirmation_whatsapp
--     FROM public.accounts WHERE deleted_at IS NULL ORDER BY 2 NULLS FIRST, 1;
