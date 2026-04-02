# Partner self-billing workflow

## Status flow (DB: `self_bills.status`)

| UI label | `status` value | When |
|----------|----------------|------|
| Ongoing | `accumulating` | ISO week Mon–Sun is open; new jobs attach here. |
| Review and Approve | `pending_review` | After the week closes (see **Week close** below). |
| Ready to Pay | `ready_to_pay` | Finance approves from Review. |
| Paid | `paid` | Marked when the pay run line is paid (see `pay-runs.ts` → `markPayRunItemsPaid`). |
| Rejected | `rejected` | Rejected from Review. |
| Audit required | `audit_required` | Manual / complaint process (no automatic rule in app). |
| Legacy | `needs_attention`, `awaiting_payment` | Still valid in DB; only listed under **All** in the UI unless filtered elsewhere. |

## Week close (Sunday 23:59 → Review)

- **API:** `POST /api/self-bills/close-week` with body `{ "weekStart": "YYYY-MM-DD" }` (Monday of the week to close).
- Moves all rows with that `week_start` from `accumulating` → `pending_review`.
- **Automation:** schedule a job **after** Sunday end-of-week (e.g. Monday 00:05 local or UTC) to call this with the **previous** ISO week’s Monday date.

Example (manual SQL to move a week — same as the API):

```sql
-- Replace :week_start with the Monday date of the closed week (YYYY-MM-DD).
UPDATE self_bills
SET status = 'pending_review'
WHERE week_start = :week_start
  AND status = 'accumulating';
```

## Audit required (complaint by email)

No schema change is required. When a complaint is validated, set:

```sql
UPDATE self_bills
SET status = 'audit_required'
WHERE id = :id;
```

Optional: add an app action or inbound email handler that runs the same update.

## Pay run → Paid

Already implemented: when a pay run item of type `self_bill` is marked paid, `self_bills.status` is set to `paid` (`markPayRunItemsPaid` in `src/services/pay-runs.ts`).

## UI defaults

- Period filter defaults to **All** so lists are not hidden by week.
- Tab defaults to **Ongoing** (`accumulating`).
- Realtime: client subscribes to `postgres_changes` on `self_bills` for live updates.

## Optional future columns (not required)

If you want an audit trail without reusing `status`:

```sql
ALTER TABLE self_bills
  ADD COLUMN IF NOT EXISTS complaint_noted_at timestamptz,
  ADD COLUMN IF NOT EXISTS complaint_notes text;
```
