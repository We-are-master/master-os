-- Recebimento de plataforma no razão que já existe.
--
-- `job_payments` já é a tabela de pagamentos por job (type = customer_deposit /
-- customer_final / partner) e já alimenta o Financeiro e o dashboard executivo.
-- Escrever os recebimentos do Checkatrade aqui, em vez de numa tabela paralela,
-- faz eles aparecerem nesses painéis sem tocar em nenhum deles.
--
-- Faltavam quatro coisas para um robô poder escrever aqui todo dia:
--
-- 1. IDEMPOTÊNCIA. O Checkatrade manda cada email mais de uma vez — vimos o
--    mesmo repasse em dois e até três tickets distintos. Sem uma chave única,
--    uma varredura diária dobra o caixa. `external_txid` é o "Transaction ID"
--    do corpo do email.
--
-- 2. O BRUTO E A TAXA. Hoje só o líquido existe: o cliente pagou £209, a
--    plataforma reteve £37 (17,7%) e recebemos £172, e só os £172 ficavam
--    registrados. Sem o bruto não dá para dizer quanto a plataforma leva, nem
--    perceber quando ela aumenta a mordida — a taxa já variou de 0% a 23,52%
--    entre jobs. Os earnings simplesmente encolhem e parece que o job vale menos.
--
-- 3. DE ONDE VEIO, para auditar sem depender do parser.
--
-- 4. COMO O JOB FOI ENCONTRADO. Casar pelo id do Checkatrade é forte; casar
--    pelo nome do cliente é fraco. Quem for conferir depois precisa saber em
--    qual dos dois confiar.
alter table public.job_payments
  add column if not exists external_txid text,
  add column if not exists platform text,
  add column if not exists gross numeric(12, 2),
  add column if not exists fee numeric(12, 2),
  add column if not exists zendesk_ticket_id text,
  add column if not exists matched_by text;

-- Parcial: lançamento feito à mão continua sem txid e não colide com nada.
create unique index if not exists job_payments_external_txid_key
  on public.job_payments (external_txid)
  where external_txid is not null;

create index if not exists job_payments_platform_idx
  on public.job_payments (platform, payment_date desc)
  where platform is not null;

comment on column public.job_payments.external_txid is
  'Chave de idempotencia do recebimento na plataforma. O Checkatrade repete o mesmo email varias vezes.';
comment on column public.job_payments.gross is
  'O que o cliente pagou. amount continua sendo o liquido que entrou para nos.';
comment on column public.job_payments.matched_by is
  'id | seen | nome. "nome" e o casamento fraco e merece conferencia humana.';
