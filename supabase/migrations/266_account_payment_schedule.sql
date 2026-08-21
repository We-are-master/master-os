-- Migration 266: a agenda de pagamento da conta deixa de ser prosa
--
-- `accounts.payment_terms` é texto livre e guarda o cronograma inteiro numa
-- frase. A Housekeep, medida em 20/08/2026:
--
--     "Every 2 weeks cutoff Sunday pay Friday ref 2026-04-13"
--
-- Funciona porque `invoice-payment-terms.ts` sabe ler essas frases. Mas cobra
-- três preços: conta nova nasce sem cut-off nenhum, ninguém consegue perguntar
-- ao banco quais contas pagam na sexta, e um erro de digitação vira "Net 30" em
-- silêncio, que é o default do parser para o que ele não reconhece.
--
-- O MOTOR NÃO MUDA. `paymentTermsFromSchedule` gera a frase canônica a partir
-- destes campos, e o parser continua calculando o vencimento. A estrutura passa
-- a ser a fonte e a frase passa a ser derivada. `src/lib/account-payment-schedule.test.ts`
-- prova que, para as 11 contas reais, a frase gerada produz EXATAMENTE o mesmo
-- vencimento que a original: nenhuma fatura muda de data por causa disto.
--
-- `payment_terms` fica: vira legado lido, nunca mais escrito à mão.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS payment_cadence       text,
  ADD COLUMN IF NOT EXISTS payment_net_days      integer,
  ADD COLUMN IF NOT EXISTS payment_cutoff_dow    smallint,
  ADD COLUMN IF NOT EXISTS payment_cutoff_dom    smallint,
  ADD COLUMN IF NOT EXISTS payment_pay_dow       smallint,
  ADD COLUMN IF NOT EXISTS payment_reference_ymd date;

COMMENT ON COLUMN public.accounts.payment_cadence IS
  'on_receipt | net_days | every_n_days | weekly | biweekly | monthly. Fonte da agenda; payment_terms passa a ser derivada dela.';
COMMENT ON COLUMN public.accounts.payment_net_days IS
  'Dias até o vencimento em net_days, e o N de every_n_days.';
COMMENT ON COLUMN public.accounts.payment_cutoff_dow IS
  'Dia da semana do corte em weekly/biweekly. 0=domingo … 6=sábado. É o que decide em qual pagamento o trabalho cai.';
COMMENT ON COLUMN public.accounts.payment_cutoff_dom IS
  'Dia do mês do corte em monthly, 1 a 28.';
COMMENT ON COLUMN public.accounts.payment_pay_dow IS
  'Dia da semana em que o dinheiro entra. 0=domingo … 6=sábado.';
COMMENT ON COLUMN public.accounts.payment_reference_ymd IS
  'Âncora da quinzena. Sem ela o parser cai numa heurística que erra uma semana inteira, e errar semana em quinzena é errar o pagamento.';

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_payment_cadence_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_payment_cadence_check CHECK (
  payment_cadence IS NULL OR payment_cadence IN
    ('on_receipt', 'net_days', 'every_n_days', 'weekly', 'biweekly', 'monthly')
);

-- ─── Backfill das 11 contas ─────────────────────────────────────────────────
-- Gerado por `scheduleFromPaymentTerms` e conferido contra o texto atual: as 11
-- foram lidas, nenhuma ficou sem agenda.

UPDATE public.accounts SET payment_cadence='on_receipt'   WHERE company_name IN
  ('Checkatrade', 'Express', 'Fixfy', 'Good Place Lettings', 'Li & Fung', 'The Stylesmiths');

-- "45 days" e "Net 30" são a mesma coisa para o motor; o texto é que variava.
UPDATE public.accounts SET payment_cadence='net_days', payment_net_days=45 WHERE company_name='Homyze';
UPDATE public.accounts SET payment_cadence='net_days', payment_net_days=30 WHERE company_name IN ('Kvadrat LTD', 'Teste Teste');

-- Fantastic: "Every 7 days" NÃO é Net 7 nem "toda sexta". Vence 7 dias depois E
-- agrupa as faturas por semana (`isWeeklyConsolidatedTerms` só reconhece esta
-- forma). O teste de ida e volta pegou a diferença: como "Every Friday" ela
-- venceria em 21/08 em vez de 27/08.
UPDATE public.accounts SET payment_cadence='every_n_days', payment_net_days=7 WHERE company_name='Fantastic Services';

-- Housekeep: a frase inteira desmontada.
UPDATE public.accounts
   SET payment_cadence='biweekly',
       payment_cutoff_dow=0,          -- domingo
       payment_pay_dow=5,             -- sexta
       payment_reference_ymd='2026-04-13'::date
 WHERE company_name='Housekeep';

-- Confere: nenhuma conta viva sem cadência, e a Housekeep completa.
--   SELECT company_name, payment_cadence, payment_net_days, payment_cutoff_dow,
--          payment_pay_dow, payment_reference_ymd, payment_terms
--     FROM public.accounts WHERE deleted_at IS NULL ORDER BY company_name;
