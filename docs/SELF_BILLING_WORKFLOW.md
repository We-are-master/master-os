# Partner self-billing workflow

## Weekly bucket model

Each **partner + ISO week** (Monday–Sunday) gets one self-bill row. Multiple jobs in the same week share that bucket. Reference format: `SB-2026-W22-JOB-9201` (first job linked sets the suffix).

| Event | Self-bill status |
|-------|------------------|
| Job completed (`completed_date`) with partner + start date | `draft` (weekly bucket created or job linked) |
| Review & approve on job | `awaiting_payment` or `ready_to_pay` |
| Finance / Sync | `ready_to_pay` when all linked jobs are approved |
| Mark paid (UI or pay run) | `paid` (+ `paid_at`) |

## Biweekly pay periods (org standard)

Default org schedule: **Every 2 weeks on Friday** (`Settings → Setup → Partner payout standard`).

| Pay date (example) | Work period (job **start** date) |
|--------------------|----------------------------------|
| Fri **12 Jun 2026** | **25 May – 7 Jun** (14 days) |
| Fri **26 Jun 2026** | **8 Jun – 21 Jun** |

- **Which period?** Job `scheduled_start_at` (fallback `scheduled_date`) must fall inside the work period.
- **When is a self-bill created?** Only when the job also has `completed_date` (execution done).
- **ISO week bucket** still follows the job start date (Mon–Sun week containing that start).
- **`due_date`** on the self-bill follows the **biweekly pay Friday** for that work period (both ISO weeks in the same period share one pay date).
- **Setup anchor:** `partner_payout_reference_ymd` (e.g. `2026-06-12`) locks the pay rhythm.

## Status flow (DB: `self_bills.status`)

| UI label | `status` value | When |
|----------|----------------|------|
| Draft | `draft` | New weekly bucket; totals update as jobs link. |
| Ongoing | `accumulating` | Legacy DBs that reject `draft` on insert. |
| Review and Approve | `pending_review` | After week close (`POST /api/self-bills/close-week`). |
| Ready to Pay | `ready_to_pay`, `awaiting_payment`, `pending_review` | Job approved; finance cleared. |
| Overdue | (derived) | `due_date` passed while still in a ready status. |
| Paid | `paid` | Marked paid in Billing or pay run. |
| Rejected | `rejected` | Cancelled from finance. |
| Legacy | `needs_attention`, `audit_required` | Shown under Ready to Pay until cleared. |

## UI filters

| Tab | Period filter | Sort / group |
|-----|---------------|--------------|
| **Draft** | Header **Created** date | `created_at` desc |
| **Ready to Pay / Overdue** | **Payment due** (This Friday, Next Friday, custom) | `due_date` asc; grouped by payout Friday + work period |
| **Closed** | Header **Created** date | `created_at` desc |
| **Billing standalone · Going out** | Current **biweekly work period** when “This week” | Grouped by pay date → partner |

Partner payout **due date**:
- Partner has `payment_terms` on profile → use that schedule.
- Otherwise → **Settings → Setup** org standard (`partner_payout_standard_terms` + optional `partner_payout_reference_ymd`), e.g. biweekly Friday.
- **Sync** recalculates all open self-bill `due_date` values from those rules.

## Auto-linking jobs

- `updateJob` when partner is set, `completed_date` + start date present, and no `self_bill_id` → creates/links bucket.
- Recurring series jobs with partner → same on insert when gates pass.
- **Sync** (`POST /api/admin/selfbills/full-sync`): backfills `completed_date` where missing, orphan jobs, rebuckets by start date, promotes approved buckets, refreshes totals and due dates.

## Week close (Sunday 23:59 → Review)

- **API:** `POST /api/self-bills/close-week` with body `{ "weekStart": "YYYY-MM-DD" }` (Monday of the week to close).
- Moves all rows with that `week_start` from `accumulating` or `draft` → `pending_review`.

## Pay run → Paid

When a pay run item of type `self_bill` is marked paid, `self_bills.status` is set to `paid` (`markPayRunItemsPaid` in `src/services/pay-runs.ts`).

## UI defaults

- Tab default: **Ready to Pay** (grouped by payment due date + work period).
- Header created-date filter applies to Draft / Closed / All.
- Realtime: client subscribes to `postgres_changes` on `self_bills`.
