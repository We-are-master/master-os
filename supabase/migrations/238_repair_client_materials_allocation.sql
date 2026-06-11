-- =============================================================================
-- Migration 238: Repair client materials extras wrongly stored in materials_cost
-- =============================================================================
--
-- Bug: client-side materials extras were applied to jobs.materials_cost (partner
-- reimbursement) instead of jobs.extras_amount (billable revenue).
--
-- Repair (idempotent): for jobs where materials_cost still includes client
-- materials from the ledger, move client materials into extras_amount and set
-- materials_cost to partner-only ledger total.
-- =============================================================================

WITH ledger AS (
  SELECT
    e.job_id,
    COALESCE(
      SUM(
        CASE
          WHEN e.side = 'client' AND e.allocation = 'materials' THEN
            CASE WHEN e.extra_type ILIKE 'DISCOUNT%' THEN -e.amount ELSE e.amount END
          ELSE 0
        END
      ),
      0
    ) AS client_materials,
    COALESCE(
      SUM(
        CASE
          WHEN e.side = 'partner' AND e.allocation = 'materials' THEN
            CASE WHEN e.extra_type ILIKE 'DISCOUNT%' THEN -e.amount ELSE e.amount END
          ELSE 0
        END
      ),
      0
    ) AS partner_materials
  FROM public.job_extra_entries e
  WHERE e.deleted_at IS NULL
  GROUP BY e.job_id
),
to_fix AS (
  SELECT
    j.id,
    j.client_price,
    j.extras_amount,
    j.materials_cost,
    j.partner_cost,
    j.customer_deposit,
    l.client_materials,
    GREATEST(0, l.partner_materials) AS partner_materials
  FROM public.jobs j
  INNER JOIN ledger l ON l.job_id = j.id
  WHERE l.client_materials > 0
    AND j.materials_cost IS DISTINCT FROM GREATEST(0, l.partner_materials)
)
UPDATE public.jobs j
SET
  extras_amount = ROUND((j.extras_amount + f.client_materials)::numeric, 2),
  materials_cost = f.partner_materials,
  customer_final_payment = ROUND(
    GREATEST(0, j.client_price + j.extras_amount + f.client_materials - j.customer_deposit)::numeric,
    2
  ),
  service_value = ROUND((j.client_price + j.extras_amount + f.client_materials)::numeric, 2),
  margin_percent = CASE
    WHEN (j.client_price + j.extras_amount + f.client_materials) <= 0 THEN 0
    ELSE ROUND(
      (
        (
          (j.client_price + j.extras_amount + f.client_materials)
          - j.partner_cost
          - f.partner_materials
        )
        / (j.client_price + j.extras_amount + f.client_materials)
        * 1000
      )::numeric,
      1
    )
  END
FROM to_fix f
WHERE j.id = f.id;

COMMENT ON TABLE public.job_extra_entries IS
  'Ledger of per-entry extras for jobs (client extra charges and partner extra payouts). Soft-delete only. Migration 238 repaired client materials stored in materials_cost.';
