-- Fase 3 do auto-flow: parceiro pode RECUSAR uma oferta no portal. Recusa não
-- é derrota ('lost' = outro levou) nem vencimento ('expired'): é decisão, e o
-- vigia de ofertas usa a diferença para nunca reconvidar quem disse não.
--
-- O código escreve 'declined' e cai para 'lost' enquanto esta migração não
-- for aplicada (colar no SQL editor, como a 249).

ALTER TABLE public.job_partner_invites
  DROP CONSTRAINT IF EXISTS job_partner_invites_status_check;

ALTER TABLE public.job_partner_invites
  ADD CONSTRAINT job_partner_invites_status_check
    CHECK (status IN ('invited', 'accepted', 'lost', 'expired', 'declined'));
