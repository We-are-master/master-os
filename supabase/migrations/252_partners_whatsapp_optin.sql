-- Consentimento explícito para receber aviso de job por WhatsApp.
--
-- Ter o número e querer ser avisado são duas coisas diferentes. Um parceiro pode
-- dar o WhatsApp para que se compartilhe o link do relatório com a equipe dele e
-- ainda assim não querer uma mensagem a cada job. Guardar isso numa coluna só
-- ("tem número, logo manda") força as duas decisões a serem a mesma, e a que
-- perde é sempre a do parceiro.
--
-- DEFAULT FALSE, e é o ponto todo desta migração: consentimento se dá, não se
-- presume. Um default `true` transformaria a base inteira de parceiros em
-- destinatários sem ninguém ter marcado nada, que é o oposto de um opt-in e o
-- caminho mais rápido para o número ser denunciado.
--
-- A regra de envio passa a ser a conjunção: `whatsapp is not null` E
-- `whatsapp_job_alerts = true`. Sem número não há para onde mandar; sem o aceite
-- não há permissão para mandar.

alter table public.partners
  add column if not exists whatsapp_job_alerts boolean not null default false;

comment on column public.partners.whatsapp_job_alerts is
  'Parceiro aceitou receber aviso de job por WhatsApp. Só envia quando true E whatsapp preenchido.';

-- Índice parcial sobre quem de fato pode receber: é a única consulta que existe.
create index if not exists idx_partners_whatsapp_optin
  on public.partners (id)
  where whatsapp_job_alerts = true and whatsapp is not null;
