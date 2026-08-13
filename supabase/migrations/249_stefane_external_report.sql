-- STEFANE: envio do relatório para a plataforma de origem (Housekeep/Checkatrade).
--
-- Hoje o relatório é atestado, não verificado: o modal de finalizar pede que o
-- escritório confirme "report submitted to the customer", e o próprio código diz
-- por quê ("partners rarely use the app"). O resultado medido em 2026-08-13 é
-- que dos 198 jobs concluídos, 16 têm relatório final, e a Housekeep manda
-- lembrete de cobrança todo dia.
--
-- Estas colunas trocam a promessa por medição. Elas guardam o ciclo inteiro de
-- um envio, e não só o desfecho, porque a UI precisa mostrar "enviando" durante
-- os 10 a 30 segundos em que a Stefane preenche o formulário.

alter table public.jobs
  -- Começou. Enquanto estiver preenchido e `submitted_at` vazio, o card mostra
  -- "enviando". Também é a trava contra dois envios simultâneos do mesmo job.
  add column if not exists external_report_started_at   timestamptz,
  -- Terminou e a plataforma aceitou. É este campo, e só ele, que libera o
  -- "Finalise & approve".
  add column if not exists external_report_submitted_at timestamptz,
  -- Por que falhou, em texto que sirva para agir: "formulário mudou",
  -- "report final sem descrição", "link expirado". Sem isto, uma falha
  -- silenciosa vira "ainda não enviado" e a Stefane tentaria para sempre.
  add column if not exists external_report_error        text,
  -- Freio. Depois de algumas tentativas ela para e o job vira trabalho de gente.
  add column if not exists external_report_attempts     smallint not null default 0,
  -- Saída manual. Sempre vai existir job em que o envio automático não dá: link
  -- morto, formulário republicado, sessão do Checkatrade caída. Sem escape o
  -- dono fica preso sem poder fechar job nenhum. Com escape registrado, a
  -- exceção continua visível em vez de virar o buraco de antes.
  add column if not exists external_report_manual_by    uuid,
  add column if not exists external_report_manual_at    timestamptz;

comment on column public.jobs.external_report_started_at is
  'Início do envio pela Stefane. Preenchido com submitted_at vazio = enviando agora.';
comment on column public.jobs.external_report_submitted_at is
  'Quando a plataforma de origem aceitou o relatório. Nulo = ainda não subiu. Único gate do Finalise.';
comment on column public.jobs.external_report_error is
  'Último motivo de falha, em texto acionável. Limpo em caso de sucesso.';
comment on column public.jobs.external_report_attempts is
  'Tentativas de envio. Freio para parar de tentar e escalar para uma pessoa.';
comment on column public.jobs.external_report_manual_by is
  'Quem marcou o envio como feito à mão, quando o automático não deu.';
comment on column public.jobs.external_report_manual_at is
  'Quando foi marcado à mão.';

-- A fila da Stefane: tem relatório final do parceiro, tem link da plataforma, e
-- ainda não subiu. Índice parcial porque a maioria esmagadora dos jobs ou já
-- subiu ou nunca entra na fila, e varrer a tabela inteira a cada rodada é
-- desperdício que cresce com o tempo.
create index if not exists jobs_stefane_fila_idx
  on public.jobs (scheduled_date desc)
  where external_report_submitted_at is null
    and final_report_submitted = true
    and report_link is not null;
