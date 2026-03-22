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

The route `GET /api/cron/daily-brief` uses the company timezone. Each of morning and evening sends **at most once per local calendar day**. With **frequent cron** (e.g. every 15 minutes), a **20-minute window** after each configured time is used. With **once-daily cron** (Vercel Hobby), **catch-up** applies: if the local time for a slot has **already passed** today and that slot was not yet sent, it can be sent on the next run (so one daily run after both times may send **two** emails).

### Vercel Hobby vs Pro

- **Hobby:** Only **one** cron invocation per day is allowed. The repo default is `0 20 * * *` (20:00 UTC). Adjust UTC if your main timezone needs a different “digest” time.
- **Pro:** Set `vercel.json` to `*/15 * * * *` so briefs go out near the configured morning/evening times.

### Vercel

1. Add `CRON_SECRET` in Project → Settings → Environment Variables (Production).
2. `vercel.json` defines the schedule. Vercel calls the route with `Authorization: Bearer CRON_SECRET` when that env is set.

### Manual / other hosts

For tight alignment with clock times, call every **15 minutes**. For a single daily run, call once after both local brief times.

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
