-- Migration 272: a referência da fatura perde o ano e vira um número de 5 dígitos
--
-- Hoje `next_invoice_ref()` monta `RCP-2026-715`. Dois problemas:
--
--   1. O ano é redundante. A fatura já carrega `created_at`, `issue_date` e
--      `due_date`; repeti-lo na referência só gasta espaço numa linha de lista
--      que já está cheia.
--   2. O contador é público. `RCP-2026-715` conta ao cliente quantas faturas a
--      empresa emitiu no ano. Mesmo motivo pelo qual o self-bill começou em
--      14445 na migração 271.
--
-- Passa a ser, como o self-bill:
--
--     RCP-63356, RCP-63357, RCP-63358, …
--
-- COMEÇA EM 63356 porque a sequência já está em 715, e continuar dela daria
-- `RCP-716`: três dígitos, e o mesmo contador exposto de antes.
--
-- Vale só para fatura NOVA. As existentes guardam a referência com que foram
-- emitidas, porque é ela que está no PDF que o cliente já recebeu e no
-- extrato que ele concilia.
--
-- `displayBillingReference` no código não precisa mudar: ela tira o prefixo e
-- recoloca `RCP-`, então `RCP-63356` entra e sai igual.

CREATE OR REPLACE FUNCTION public.next_invoice_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN 'RCP-' || nextval('public.invoice_seq')::text;
END;
$$;

-- Empurra a sequência para o piso de 5 dígitos, sem nunca puxá-la para trás:
-- se uma segunda execução encontrar a sequência já adiante, deixa como está.
DO $$
DECLARE
  atual bigint;
  max_novo bigint;
BEGIN
  SELECT last_value INTO atual FROM public.invoice_seq;

  -- Retoma de onde parou se já houver referência no formato novo, para não
  -- reemitir um número que já foi para um cliente.
  SELECT COALESCE(MAX((regexp_match(reference, '^RCP-(\d+)$'))[1]::bigint), 0)
    INTO max_novo
    FROM public.invoices
   WHERE reference ~ '^RCP-\d+$';

  IF GREATEST(atual, max_novo) < 63355 THEN
    PERFORM setval('public.invoice_seq', 63355, true);
  ELSIF max_novo > atual THEN
    PERFORM setval('public.invoice_seq', max_novo, true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_ref() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_ref() TO service_role;

-- Confere o próximo número SEM consumi-lo (nextval incrementa até num SELECT):
--   SELECT last_value, is_called FROM public.invoice_seq;
