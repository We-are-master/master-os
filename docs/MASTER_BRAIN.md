# Master Brain & daily brief

## Environment variables (server only)

| Variable | Required for | Description |
|----------|----------------|-------------|
| `OPENAI_API_KEY` | Master Brain chat + AI insights in brief | OpenAI API key |
| `OPENAI_MODEL` | Optional | Default `gpt-4o-mini` |
| `CRON_SECRET` | Daily brief cron | Shared secret; callers must send `Authorization: Bearer <CRON_SECRET>` |
| `RESEND_API_KEY` | Daily brief email | Same as quote PDF emails |
| `RESEND_FROM_EMAIL` | Daily brief | Verified sender in Resend |

Never expose `OPENAI_API_KEY` or `CRON_SECRET` to the client.

## Admin configuration

**Settings → AI & Daily brief**

- **Master Brain (Admin)**: floating assistant with global metrics.
- **Master Brain (Manager)**: same data + **quote pipeline** detail; optional **admin instructions** (e.g. tone, B2B focus).
- **Master Brain (Operator)**: metrics + quotes context + **jobs where the user is job owner**; optional admin instructions.
- **Daily brief**: morning and evening HTML emails with metrics; if OpenAI is configured, adds an “insights” section.

Migration `044_master_brain_roles.sql` adds manager/operator toggles and instruction fields on `company_settings`.

## Cron

The route `GET /api/cron/daily-brief` checks company timezone and sends at most one morning and one evening email per local calendar day (20-minute window after the configured time).

### Vercel

1. Add `CRON_SECRET` in Project → Settings → Environment Variables (Production).
2. `vercel.json` includes a cron schedule (every 15 minutes). Vercel will call the route with `Authorization: Bearer CRON_SECRET` when that env is set.

### Manual / other hosts

Call every **15 minutes**:

```bash
curl -sS -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://your-domain.com/api/cron/daily-brief"
```

## Database

Migration `043_master_brain_daily_brief.sql` adds columns to `company_settings`.

## Troubleshooting

- **No email**: check `daily_brief_enabled`, valid recipient addresses, `RESEND_*`, and cron logs.
- **No AI block in email**: set `OPENAI_API_KEY`; brief still sends without it.
- **Master Brain button missing**: enable the toggle for your **role** (Admin / Manager / Operator) in settings.
- **Operator sees no jobs**: job rows must have `owner_id` set to that user’s profile id.
