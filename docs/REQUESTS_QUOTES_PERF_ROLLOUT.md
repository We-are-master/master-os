# Requests/Quotes Performance Rollout

## What changed

- UI timing events (`master-ui-perf`) added for critical flows:
  - request create/convert
  - quote create/status change/convert-to-job
- API `Server-Timing` headers added:
  - `POST /api/quotes/respond`
  - `POST /api/quotes/send-pdf`
- Status counts optimized with SQL RPC (`get_status_counts`) + fallback to legacy path.
- New indexes for common Requests/Quotes access patterns.

## Baseline and after checks

1. Open devtools network and inspect `Server-Timing` for:
   - `/api/quotes/respond`
   - `/api/quotes/send-pdf`
2. Track UI timings:
   - add a temporary listener in browser console:
     - `window.addEventListener("master-ui-perf", (e) => console.log(e.detail));`
3. Compare p50/p95 for:
   - `requests.create_request_ms`
   - `requests.invite_partner_convert_ms`
   - `quotes.create_quote_ms`
   - `quotes.status_change_ms`
   - `quotes.convert_to_job_ms`

## SQL deployment order

1. Apply migration `079_status_counts_rpc_and_requests_quotes_indexes.sql`.
2. Confirm RPC exists:
   - `select * from get_status_counts('quotes', array['draft','bidding']);`
3. Confirm indexes:
   - `idx_quotes_status_created_active`
   - `idx_service_requests_status_created_active`
   - `idx_quote_line_items_quote_sort`

## Rollback plan

- App fallback is automatic for status counts if RPC fails.
- If needed, keep UI/API instrumentation (low risk) and revert only RPC usage in `src/services/base.ts`.
