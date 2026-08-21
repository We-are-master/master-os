-- Migration 264: devolve cada invoice órfã à conta do cliente dela
--
-- `invoices.source_account_id` nunca era preenchido na criação: nenhum chamador
-- passava o campo. Medido em 20/08/2026: 93 invoices sem conta, e 38 das
-- ÚLTIMAS 40 criadas. Não é legado, é toda safra nova.
--
-- Órfã não é problema de tela. O Financeiro agrupa por conta e joga todas em
-- "Unlinked account", e a checagem de coerência da Zia lê o mesmo campo direto,
-- então o relatório dela também perde a conta. £9.008 de Checkatrade, Housekeep
-- e Fantastic apareciam como se não tivessem dono.
--
-- O `createInvoice` já foi corrigido para herdar a conta do cliente do job.
-- Isto aqui limpa o que ficou.
--
-- PELO JOB, NUNCA PELO NOME DO CLIENTE. Nome repete entre contas ("Cleaning",
-- iniciais, homônimos), e casar por texto é exatamente como uma fatura da
-- Housekeep acabaria contada como Checkatrade. A cadeia é
-- invoice.job_reference → jobs.client_id → clients.source_account_id, que é a
-- mesma que a tela usa como fallback.
--
-- Recupera 54 das 93. As outras 39 não têm job ou têm cliente sem conta, e
-- ficam órfãs de propósito: chutar conta é pior que admitir que não se sabe.

UPDATE public.invoices i
   SET source_account_id = c.source_account_id
  FROM public.jobs j
  JOIN public.clients c ON c.id = j.client_id
 WHERE i.job_reference        = j.reference
   AND i.source_account_id   IS NULL
   AND c.source_account_id   IS NOT NULL
   AND i.deleted_at          IS NULL;

-- Confere a distribuição depois:
--   SELECT a.company_name, count(*) , sum(i.amount)
--     FROM public.invoices i
--     JOIN public.accounts a ON a.id = i.source_account_id
--    WHERE i.deleted_at IS NULL
--    GROUP BY a.company_name ORDER BY 2 DESC;
--
-- E o que sobrou sem conta (esperado: 39):
--   SELECT count(*) FROM public.invoices
--    WHERE source_account_id IS NULL AND deleted_at IS NULL;
