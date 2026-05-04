-- =============================================================================
-- Migration 162: collapse `in_progress_phase1|2|3` → `in_progress`
-- =============================================================================
--
-- Na operação real, só `in_progress` é usado. Os 3 sub-status (phase1/2/3) são
-- vestígios do sistema "phase 1/2/3 + report 1/2/3 + payment 1/2/3" que ninguém
-- roda. Tab Visits (mig 161) substitui essa noção (cada visita tem seu próprio
-- fluxo).
--
-- Esta migration:
--   1. Backfilla TODOS os jobs em qualquer phaseN para `in_progress`
--   2. Re-aperta o CHECK constraint pra rejeitar phaseN dali pra frente
--
-- Soft-deprecate (NÃO drop neste sprint):
--   - jobs.current_phase, total_phases
--   - jobs.report_1/2/3_uploaded, report_N_approved, report_N_uploaded_at, ...
--   - jobs.partner_payment_1/2/3, partner_payment_N_paid, ...
--
-- Drop dessas colunas é sprint dedicado (afeta self-bill calc, payouts,
-- queries históricas). Aqui só paramos de usá-las e o CHECK constraint
-- protege contra regressão.
--
-- Idempotente.
-- =============================================================================

-- 1. Drop the old CHECK constraint (allows in_progress_phaseN today)
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

-- 2. Backfill every phaseN row → in_progress
UPDATE public.jobs
SET status = 'in_progress'
WHERE status IN ('in_progress_phase1','in_progress_phase2','in_progress_phase3');

-- 3. Re-add CHECK without phaseN
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (status IN (
    'unassigned',
    'auto_assigning',
    'scheduled',
    'late',
    'in_progress',
    'on_hold',
    'final_check',
    'awaiting_payment',
    'need_attention',
    'completed',
    'cancelled',
    'deleted'
  ));

COMMENT ON COLUMN public.jobs.status IS
  'Job lifecycle. After mig 162: scheduled → in_progress → final_check → awaiting_payment → completed. Phases 1/2/3 collapsed into single in_progress.';
