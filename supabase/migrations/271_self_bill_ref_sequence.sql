-- Migration 271: referência de self-bill vira sequência simples
--
-- Hoje a referência é montada em `uniqueRef(weekLabel, jobRef)`:
--
--     SB-2026-W32-JOB-9380
--
-- Três problemas, e os três pioraram com a consolidação de hoje:
--
--   1. Ela carrega `W32`, uma semana ISO, num documento que agora cobre uma
--      QUINZENA. O rótulo já foi corrigido; a referência ficou mentindo.
--   2. Ela carrega `JOB-9380`, que é um job entre TREZE dentro do documento.
--      Escolhido por acaso: foi o primeiro a ser vinculado.
--   3. Ela pode colidir. Dois self-bills do mesmo job na mesma semana geram a
--      mesma string, e referência de documento financeiro não pode repetir.
--
-- Passa a ser uma sequência do banco, como a fatura já faz desde a migração 230:
--
--     SB-14445, SB-14446, SB-14447, …
--
-- COMEÇA EM 14445, e não em 1, de propósito: referência que começa em 1 conta
-- ao parceiro quantos documentos a empresa já emitiu na vida. Um número que já
-- vem alto não diz nada sobre volume, que é o que se quer.
--
-- Sem o ano no meio (ao contrário de `RCP-2026-647`), porque o self-bill já
-- carrega o período nas próprias colunas e a referência só precisa ser única e
-- curta o suficiente para caber num assunto de email.
--
-- Vale só para self-bill NOVO. Os existentes guardam a referência com que foram
-- emitidos, porque é ela que está no PDF que o parceiro já recebeu.

CREATE SEQUENCE IF NOT EXISTS public.self_bill_seq START 14445;

CREATE OR REPLACE FUNCTION public.next_self_bill_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN 'SB-' || nextval('public.self_bill_seq')::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_self_bill_ref() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_self_bill_ref() TO service_role;

-- Retoma de onde parou se já houver referência no formato novo, para uma
-- segunda execução não voltar a emitir SB-14445 e colidir.
DO $$
DECLARE
  max_n bigint;
BEGIN
  SELECT COALESCE(
    MAX((regexp_match(reference, '^SB-(\d+)$'))[1]::bigint),
    0
  )
  INTO max_n
  FROM public.self_bills
  WHERE reference ~ '^SB-\d+$';

  IF max_n >= 14445 THEN
    PERFORM setval('public.self_bill_seq', max_n, true);
  END IF;
END;
$$;

-- Confere o próximo número sem consumi-lo:
--   SELECT last_value, is_called FROM public.self_bill_seq;
