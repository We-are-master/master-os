-- Número de WhatsApp do parceiro, separado do telefone.
--
-- `phone` é o número de contato da empresa e nem sempre recebe WhatsApp: fixo,
-- número de escritório, ou um celular que a pessoa não usa para trabalho. O que
-- vai ser usado aqui é outro: é para onde o link do relatório é mandado, e quem
-- recebe costuma ser quem coordena a equipe, não quem atende o telefone.
--
-- NULO É A RESPOSTA "não manda". Parceiro que não quiser WhatsApp fica com o
-- campo vazio e continua recebendo só o email. Por isso não há default e não há
-- backfill a partir de `phone`: copiar o telefone para cá transformaria silêncio
-- em consentimento, e mandaria mensagem para número que ninguém autorizou.

alter table public.partners
  add column if not exists whatsapp text;

comment on column public.partners.whatsapp is
  'WhatsApp do parceiro, formato internacional (+447700900123). NULO = não enviar WhatsApp, só email.';

-- Índice parcial: as consultas que interessam são sempre "quem tem WhatsApp",
-- nunca "quem não tem", e a maioria das linhas vai ficar nula por um bom tempo.
create index if not exists idx_partners_whatsapp
  on public.partners (whatsapp)
  where whatsapp is not null;
