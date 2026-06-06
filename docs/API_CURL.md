# Master OS — Curl reference

Exemplos prontos para copy/paste. Substitui:

- `$BASE` → `http://localhost:3000` (dev) ou `https://app.getfixfy.com` (prod)
- `$QUOTE_KEY` → valor de `MASTER_OS_QUOTE_WEBHOOK_API_KEY`
- `$JOB_KEY`   → valor de `MASTER_OS_JOB_WEBHOOK_API_KEY`
- `$DESK_KEY`  → valor de `ZENDESK_WEBHOOK_API_KEY` (ou `ZOHO_DESK_WEBHOOK_API_KEY`)
- `$ACCOUNT`  → uuid de uma linha `accounts`
- `$JOB_ID`   → uuid de uma linha `jobs`
- `$QUOTE_ID` → uuid de uma linha `quotes`

---

## 1. POST `/api/quotes` — criar quote externa

**Auth**: `X-API-Key: $QUOTE_KEY`
**Requeridos**: `account_id`, `title` (apenas).
**Opcionais**: `date`, `hour`, `client_name`, `client_email`, `description`, `service_type`, `type_of_quoting` (`"manual"` default), `ticket_id`.

### Versão mínima

```bash
curl -X POST "$BASE/api/quotes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $QUOTE_KEY" \
  -d '{
    "account_id": "'"$ACCOUNT"'",
    "title": "Boiler service and annual safety check"
  }'
```

### Versão completa (com cliente + agendamento + ligação Zendesk)

```bash
curl -X POST "$BASE/api/quotes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $QUOTE_KEY" \
  -d '{
    "account_id":      "'"$ACCOUNT"'",
    "title":           "Boiler service and annual safety check",
    "date":            "2026-05-03",
    "hour":            "09:00",
    "client_name":     "Sarah Williams",
    "client_email":    "sarah@example.com",
    "description":     "Annual gas safety check on Worcester Bosch 30CDi. Include CP12 certificate.",
    "service_type":    "Plumbing",
    "type_of_quoting": "manual",
    "ticket_id":       "8472"
  }'
```

### Modo bidding (push para partners que dão match no trade)

```bash
curl -X POST "$BASE/api/quotes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $QUOTE_KEY" \
  -d '{
    "account_id":      "'"$ACCOUNT"'",
    "title":           "Bathroom refit",
    "service_type":    "Plumbing",
    "type_of_quoting": "bidding"
  }'
```

### Resposta (201)

```json
{
  "id":        "f3f2a9c0-…",
  "reference": "QT-2026-1052",
  "status":    "draft",
  "partners_notified": { "sent": 4, "errors": 0, "tokensFound": 5 }
}
```

### Idempotência por ticket

Se enviares o mesmo `ticket_id` duas vezes, a segunda chamada devolve a quote existente:

```json
{ "id": "…", "reference": "QT-2026-1052", "status": "draft", "action": "existing" }
```

### Notas sobre o body

| Campo | Comportamento se omitido |
|---|---|
| `date` / `hour` | `start_date_option_1` fica null |
| `client_name` + `client_email` (só com ambos) | Procura cliente existente por email; cria novo se não achar; se faltar qualquer um → `client_id = null` |
| `service_type` | Obrigatório quando `type_of_quoting = "bidding"` |
| `ticket_id` | Quando presente, todas as comunicações com o cliente vão pelo Zendesk em vez de Resend |

---

## 2. POST `/api/jobs` — criar job externo

**Auth**: `X-API-Key: $JOB_KEY`
**Requeridos**: `account_id`, `date`, `hour`, `title`, `client_name`, `client_email`, `property_address`, `service_type`.
**Opcionais**: `description`, `client_price`, `partner_cost`, `auto_assign`, `ticket_id`.

### Versão mínima

```bash
curl -X POST "$BASE/api/jobs" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $JOB_KEY" \
  -d '{
    "account_id":       "'"$ACCOUNT"'",
    "date":             "2026-05-03",
    "hour":             "09:00",
    "title":            "Boiler service and annual safety check",
    "client_name":      "Sarah Williams",
    "client_email":     "sarah@example.com",
    "property_address": "12 Westbourne Grove, Notting Hill, London W2 5RH",
    "service_type":     "Plumbing"
  }'
```

### Versão completa (com preços + auto-assign + Zendesk)

```bash
curl -X POST "$BASE/api/jobs" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $JOB_KEY" \
  -d '{
    "account_id":       "'"$ACCOUNT"'",
    "date":             "2026-05-03",
    "hour":             "09:00",
    "title":            "Boiler service and annual safety check",
    "client_name":      "Sarah Williams",
    "client_email":     "sarah@example.com",
    "property_address": "12 Westbourne Grove, Notting Hill, London W2 5RH",
    "service_type":     "Plumbing",
    "description":      "Annual gas safety check. Issue CP12.",
    "client_price":     225.00,
    "partner_cost":     145.00,
    "auto_assign":      true,
    "ticket_id":        "8472"
  }'
```

### Resposta (201)

```json
{
  "id":        "8d2a…",
  "reference": "FX-2026-1052",
  "status":    "auto_assigning",
  "action":    "created",
  "partners_notified": { "sent": 3, "tokensFound": 3 }
}
```

### Conversão de quote existente (mesmo `ticket_id`)

Se já houver uma `quotes` linkada ao mesmo `ticket_id`, o job é criado e a quote é marcada `status='converted_to_job'`:

```json
{
  "id":           "8d2a…",
  "reference":    "FX-2026-1052",
  "status":       "unassigned",
  "action":       "converted_from_quote",
  "from_quote_id":"f3f2a9c0-…"
}
```

### Idempotência

Mesmo `ticket_id` duas vezes → segunda devolve o job existente com `action: "existing"`.

### Notas sobre o body

| Campo | Comportamento |
|---|---|
| `auto_assign: true` | Faz match de partners ativos pelo trade do `service_type` e envia push. Se nenhum match → `status='unassigned'`. |
| `ticket_id` | Quando presente, dispara automaticamente: (a) booking confirmation no ticket principal Zendesk com PDF, (b) custom_status_id do ticket = `5688453749919`. |
| `date` | Aceita `YYYY-MM-DD`, `DD-MM-YYYY`, `DD-MM-YY`, `DD/MM/YYYY`, `DD/MM/YY`. |
| `hour` | Formato `HH:MM` (24h). |

---

## 3. POST `/api/webhooks/desk/quote-request` — webhook Zoho/Zendesk → quote

**Auth**: `X-API-Key: $DESK_KEY`. `ticket_id` é a chave de idempotência.

```bash
curl -X POST "$BASE/api/webhooks/desk/quote-request" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DESK_KEY" \
  -d '{
    "ticket_id":        "8472",
    "client_name":      "Sarah Williams",
    "client_email":     "sarah@example.com",
    "property_address": "12 Westbourne Grove, London W2 5RH",
    "service_type":     "Plumbing",
    "description":      "Boiler needs annual service",
    "scope":            "Worcester Bosch 30CDi — CP12 issue",
    "total_value":      225,
    "deposit_percent":  10,
    "quote_mode":       "manual"
  }'
```

`quote_mode: "bid"` → status `bidding` + push para partners matching trade.
`quote_mode: "manual"` (default) → status `draft`.

---

## 4. POST `/api/webhooks/desk/job-created` — webhook Zoho/Zendesk → job

```bash
curl -X POST "$BASE/api/webhooks/desk/job-created" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DESK_KEY" \
  -d '{
    "ticket_id":        "8472",
    "client_name":      "Sarah Williams",
    "client_email":     "sarah@example.com",
    "property_address": "12 Westbourne Grove, London W2 5RH",
    "service_type":     "Plumbing",
    "scheduled_date":   "2026-05-03",
    "scheduled_hour":   "09:00",
    "assignment_mode":  "auto"
  }'
```

`assignment_mode: "auto"` → status `auto_assigning` + push para partners matching trade.

---

## 4b. POST `/api/holds` — On hold (Zendesk → OS)

Configure a Zendesk trigger when tag `on_hold` is added (and not `sent-hold-os`). Action: notify webhook + add tag `sent-hold-os`.

```bash
curl -X POST "$BASE/api/holds" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DESK_KEY" \
  -d '{
    "ticket_id": "8472",
    "on_hold_reason_id": "hold_complaint",
    "on_hold_notes": "Customer reports the leak was not fixed and wants a revisit."
  }'
```

- `on_hold_reason_id` — bare OS id (`complaint`, …) or Zendesk tag (`hold_complaint`).
- `on_hold_notes` — complaint detail; required when reason is `complaint`. Aliases: `description`, `complaint_description`.
- Legacy path: `POST /api/webhooks/desk/job-on-hold` (same handler).

See [zendesk-complaint-macro-form.md](./zendesk-complaint-macro-form.md) for macro + form setup.

---

## 4c. POST `/api/cancellations` — Mark as Cancelled (Zendesk → OS)

Configure a Zendesk trigger when tag `cancelled` is added (and not `sent-cancel-os`). Action: notify webhook + add tag `sent-cancel-os`.

```bash
curl -X POST "$BASE/api/cancellations" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $DESK_KEY" \
  -d '{
    "ticket_id": "8472",
    "cancellation_reason_id": "client_requested",
    "cancellation_notes": "",
    "cancelled_by_agent": "agent@getfixfy.com",
    "cancelled_at": "2026-06-04T22:00:00Z"
  }'
```

- `cancellation_reason_id` — bare OS id (`client_requested`, …) or Zendesk tag (`cancel_client_requested`).
- `cancellation_notes` — required when reason is `other`.
- Idempotent: same ticket already cancelled → `200` with `{ action: "existing" }`.

Zendesk dropdown values use prefix `cancel_*` (synced from Settings → Cancellation Reasons).

### Zendesk reason tag prefixes

Zendesk requires unique tag values across all custom fields. OS stores bare ids; Zendesk option values are prefixed:

| Field | Prefix | Default field ID |
|-------|--------|------------------|
| Cancellation reason | `cancel_` | `5834334215583` |
| On-hold reason | `hold_` | `5834320428319` |

Both are synced from Settings when you save (or use **Sync … → Zendesk** under Integrations).

---

## 5. POST `/api/join/register` — cadastro de partner (página `/join`)

**Auth**: público (rate-limited por IP).
**Content-Type**: `multipart/form-data` (4 documentos obrigatórios).

```bash
curl -X POST "$BASE/api/join/register" \
  -F "fullName=John Smith" \
  -F "email=john@plumbing.co.uk" \
  -F "phone=+447700900000" \
  -F "password=StrongPass123" \
  -F "companyName=Smith Plumbing Ltd" \
  -F "address=10 Downing Street, London SW1A 2AA" \
  -F "trades=Plumbing,Heating" \
  -F "servicesProvided=Boiler servicing, gas safety, emergency callouts" \
  -F "utr=1234567890" \
  -F "website=https://smith-plumbing.co.uk" \
  -F "photo_id=@/path/to/passport.jpg" \
  -F "public_liability=@/path/to/insurance.pdf" \
  -F "proof_of_address=@/path/to/utility-bill.pdf" \
  -F "right_to_work=@/path/to/right-to-work.pdf"
```

### Resposta (200)

```json
{ "ok": true, "partnerId": "8d2a…" }
```

### Erros comuns

- `400` — `Missing required documents: …` (qualquer um dos 4 docs em falta)
- `400` — `Password must be at least 8 characters with uppercase, lowercase, and a number`
- `409` — `An account with this email already exists`
- `413` — `These documents are too large (max 10 MB): …`
- `429` — `Too many registration attempts. Please try again later.` (5 por IP / 10 min)

---

## 6. POST `/api/quotes/send-pdf` — enviar PDF da quote (session)

**Auth**: cookie de sessão Supabase. Para curl precisas extrair o cookie `sb-…-auth-token` do browser.

```bash
curl -X POST "$BASE/api/quotes/send-pdf" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SB_COOKIE" \
  -d '{
    "quoteId":        "'"$QUOTE_ID"'",
    "recipientEmail": "sarah@example.com",
    "recipientName":  "Sarah Williams"
  }'
```

### Resposta — caminho Zendesk

```json
{
  "pdfGenerated": true,
  "emailSent":    true,
  "channel":      "zendesk",
  "ticketId":     "8472"
}
```

### Resposta — caminho Resend

```json
{
  "pdfGenerated": true,
  "emailSent":    true,
  "emailId":      "re_abc123…",
  "sentTo":       "sarah@example.com"
}
```

### Decisão de canal

- Quote com `external_source='zendesk'` + `external_ref` + Zendesk env vars setadas → **Zendesk** (comment público + PDF anexo + flip status para `5688280626847`)
- Caso contrário → **Resend**

---

## 7. POST `/api/jobs/[id]/notify-partner-zendesk` — notificar partner

**Auth**: cookie de sessão + role admin/manager/operator.

```bash
curl -X POST "$BASE/api/jobs/$JOB_ID/notify-partner-zendesk" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SB_COOKIE" \
  -d '{
    "kind":           "on_hold",
    "newStatusLabel": "On Hold",
    "reason":         "Waiting for parts delivery",
    "skipPush":       false
  }'
```

`kind` aceita: `assigned`, `status_changed`, `cancelled`, `on_hold`, `resumed`, `completed`, `rescheduled`.

Quando `kind = "on_hold"` o ticket Zendesk também tem `custom_status_id` flipado para `5679178036127`.

### Resposta

```json
{
  "ok":   true,
  "kind": "on_hold",
  "push": { "ok": true, "tokens_sent": 1, "error": null },
  "zendesk": {
    "ok": true,
    "side_conversation_id": "01J…",
    "error": null
  }
}
```

---

## 8. POST `/api/internal/zendesk/sync-status` — sync manual de status

**Auth**: `X-API-Key: $INTERNAL_SYNC_KEY` (env `INTERNAL_SYNC_SECRET`).

```bash
curl -X POST "$BASE/api/internal/zendesk/sync-status" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTERNAL_SYNC_KEY" \
  -d '{
    "entity":   "job",
    "entityId": "'"$JOB_ID"'"
  }'
```

`entity` aceita: `"job"` ou `"quote"`.

---

## 9. GET `/api/quotes/send-pdf?quoteId=…` — preview/download do PDF

**Auth**: cookie de sessão.

### Preview no browser

```bash
curl "$BASE/api/quotes/send-pdf?quoteId=$QUOTE_ID" \
  -H "Cookie: $SB_COOKIE" \
  --output preview.pdf
```

### Download attachment

```bash
curl "$BASE/api/quotes/send-pdf?quoteId=$QUOTE_ID&download=1" \
  -H "Cookie: $SB_COOKIE" \
  --output quote.pdf
```

---

## Como obter `$SB_COOKIE` para curl manual

As rotas com auth de sessão precisam do cookie Supabase. Mais fácil:

1. Abre o dashboard no browser, faz login
2. DevTools → Application → Cookies → copia o valor de `sb-<projectref>-auth-token`
3. Usa como:

```bash
export SB_COOKIE='sb-abc123-auth-token=eyJhbGciOi…'
```

Para integrações de produção (n8n / scripts), prefere as rotas externas com `X-API-Key` em vez de impersonar uma sessão.

---

## Variáveis de ambiente relevantes

| Env var | Onde é usada |
|---|---|
| `MASTER_OS_QUOTE_WEBHOOK_API_KEY` | `/api/quotes` |
| `MASTER_OS_JOB_WEBHOOK_API_KEY` | `/api/jobs` |
| `ZENDESK_WEBHOOK_API_KEY` (ou `ZOHO_DESK_WEBHOOK_API_KEY`) | `/api/webhooks/desk/*` |
| `INTERNAL_SYNC_SECRET` | `/api/internal/zendesk/sync-status`, `/api/internal/jobs/partner-portal-accept` (trade portal Accept job) |

**Health (no auth):** `GET /api/health/internal-sync` on OS · `GET /api/health/accept-config` on trade portal — verify env before testing Accept.
| `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` | Comentários no ticket + side conversations |
| `ZENDESK_CANCELLATION_REASON_FIELD_ID` | Dropdown: `cancel_{osId}` (default `5834334215583`) |
| `ZENDESK_CANCELLATION_NOTES_FIELD_ID` | Cancellation notes textarea (default `5834293455647`) |
| `ZENDESK_ON_HOLD_REASON_FIELD_ID` | Dropdown: on-hold reason id on ticket |
| `ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID` | Complaint description (partner email + Zendesk) |
| `ZENDESK_COMPLAINT_SOLUTION_FIELD_ID` | Partner solution after on-hold form submit |
| `ZENDESK_JOB_ID_FIELD_ID` | Job reference on ticket (default `5824403479839`) |
| `ZENDESK_QUOTE_REF_FIELD_ID` | Quote reference (QT-…); falls back to job id field when unset |
| `ZENDESK_TYPE_OF_WORK_FIELD_ID` | Tagger: `service_catalog.id` UUID |
| `ZENDESK_JOB_TYPE_FIELD_ID` | Tagger: `job_type_fixed` / `job_type_hourly` |
| `ZENDESK_RATE_TYPE_FIELD_ID` | Text/dropdown: `fixed` / `hourly` (if separate from Job Type) |
| `ZENDESK_ARRIVAL_WINDOW_FIELD_ID` | Tagger: `arrival_morning`, `arrival_early_afternoon`, … |
| `ZENDESK_AUTO_ASSIGN_FIELD_ID` | Checkbox: `true` / `false` from job auto-assign |
| `ZENDESK_CLIENT_EMAIL_FIELD_ID` | `clients.email` (not account finance email) |
| `ZENDESK_CLIENT_NAME_FIELD_ID` | `jobs.client_name` (end client on the job row) |
| `ZENDESK_PROPERTY_ADDRESS_FIELD_ID` | `jobs.property_address` |
| `ZENDESK_CLIENT_PHONE_FIELD_ID` | `clients.phone` |
| `ZENDESK_SCOPE_FIELD_ID` | `jobs.scope` (work brief) |
| `ZENDESK_REPLY_STATUS_FIELD_ID` | Tagger Reply Status — OS create/sync → `reply_replied` (Sent); default field `5698641403423` |
| `ZENDESK_REPLY_STATUS_SENT_VALUE` | Override Sent option value (default `reply_replied`) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Emails Resend (fallback quando não há Zendesk) |
| `CRON_SECRET` | `/api/cron/*` (`Authorization: Bearer …`) |
| `QUOTE_RESPONSE_SECRET` | Assinar tokens de accept/reject |
