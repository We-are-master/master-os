# Zendesk — Complaint macro + ticket form

Use this with the OS webhook `POST /api/holds` (legacy: `POST /api/webhooks/desk/job-on-hold`) so a **Complaint** macro and ticket form stay aligned with OS on-hold reasons, partner email copy, and Zendesk custom fields.

## OS on-hold reason ids (dropdown values)

These ids are defined in code (`src/lib/job-on-hold-reasons.ts`) and in **Settings → Setup → Jobs · On Hold Reasons**. OS stores bare ids; Zendesk dropdown option **values** use prefix `hold_` (e.g. `hold_complaint`):

| Zendesk value | OS id | Label (default) |
|---------------|-------|-----------------|
| `hold_waiting_materials` | `waiting_materials` | Waiting for materials |
| `hold_client_rescheduled` | `client_rescheduled` | Client rescheduled |
| `hold_access_issue` | `access_issue` | Access issue |
| `hold_partner_unavailable` | `partner_unavailable` | Partner unavailable |
| `hold_awaiting_confirmation` | `awaiting_confirmation` | Awaiting confirmation |
| `hold_complaint` | `complaint` | Complaint |
| `hold_other` | `other` | Other |

Custom reasons added in Setup get a stable `id` (shown in Settings) — Zendesk value = `hold_{id}`. Webhooks accept bare id or `hold_*` tag.

## Zendesk custom fields (create in Admin → Objects and rules → Tickets → Fields)

| Purpose | Suggested type | OS config |
|--------|----------------|-----------|
| On-hold reason id | Dropdown | **Settings → Setup → Integrations** → *On-hold reason field id* (or env `ZENDESK_ON_HOLD_REASON_FIELD_ID`) |
| Complaint description | Multi-line text | *Complaint description field id* (or env `ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID`) |
| Partner solution | Multi-line text | *Partner solution field id* (or env `ZENDESK_COMPLAINT_SOLUTION_FIELD_ID`) |

Copy each field’s numeric id from the Zendesk URL when editing the field.

### Auto-sync dropdown options (OS → Zendesk)

You do **not** need to hand-maintain dropdown options in Zendesk:

1. Set the **on-hold reason field id** in Settings (or env).
2. Edit **Jobs · On Hold Reasons** (add / remove / rename labels; `id` stays stable).
3. **Save Setup** — the OS pushes the full option list to Zendesk (`value` = `hold_{id}`, `name` = label).
4. Or click **Sync reasons → Zendesk** on that card.

Removed OS reasons are pruned from Zendesk when their `value` matches an OS-style id. Legacy Zendesk-only options are left untouched.

## Ticket form (apply with Complaint macro)

Recommended fields **in order**:

1. **On-hold reason** — dropdown, required; default `complaint` for Complaint macro.
2. **Description** — multi-line, required when reason = Complaint; maps to JSON `description`.
3. (Optional) internal notes — do not map to webhook unless needed.

Form field → webhook JSON (Zendesk trigger HTTP target):

```json
{
  "ticket_id": "{{ticket.id}}",
  "on_hold_reason_id": "{{ticket.ticket_field_<ON_HOLD_REASON_FIELD_ID>}}",
  "description": "{{ticket.ticket_field_<DESCRIPTION_FIELD_ID>}}"
}
```

Legacy alias: `reason` (free text label) still accepted if `on_hold_reason_id` is omitted.

## Macro + automation

1. **Macro “Complaint”** (example):
   - Set ticket custom status → **Customer On Hold** (same as OS `5679178036127`).
   - Apply the complaint ticket form (or set fields: reason = `complaint`, clear description for agent to fill).
   - Optional: add internal note “Complaint raised — job paused in OS.”

2. **Trigger** (tag `on_hold`, exclude `sent-hold-os`; add `sent-hold-os` after success):
   - **URL:** `POST https://<os-host>/api/holds`
   - **Header:** `X-API-Key: <ZENDESK_WEBHOOK_API_KEY>`
   - **Body:** JSON above (`on_hold_notes` instead of `description` is preferred).

## What the OS does

1. Puts the linked job (`external_ref` = ticket id) on **on_hold**, stores `on_hold_reason_preset_id` + `on_hold_complaint_description`.
2. Emails the assigned partner (side conversation) with **Description** in “What the customer reported”.
3. Syncs Zendesk **custom status** + the three custom fields (best-effort).
4. When the partner submits the public on-hold form, OS saves **Solution** (`on_hold_submission.notes`) and syncs it to Zendesk.

## OS → Zendesk sync (automatic)

Postgres trigger calls `/api/internal/zendesk/sync-status` when any of these change on a zendesk-linked job:

- `status`
- `on_hold_reason_preset_id`
- `on_hold_complaint_description`
- `on_hold_submission` (partner solution)

So updates from the job drawer, resume flow, or partner form keep the ticket fields in sync.

## Test checklist

- [ ] Ticket linked to a job (`external_source=zendesk`, `external_ref=ticket id`).
- [ ] Submit form with `complaint` + description → job on hold, partner email shows description.
- [ ] Zendesk ticket: custom status On Hold, reason id = `complaint`, description filled.
- [ ] Partner submits on-hold link → Solution field on ticket updated.
- [ ] Resume job in OS → reason/description fields cleared on ticket (when not on hold).
