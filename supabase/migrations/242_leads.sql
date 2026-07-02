-- Apify-sourced lead store. Apify actors (Google Maps, directories) scrape
-- businesses; a webhook ingests the dataset here, dedups by email, and the
-- qualifying leads are enrolled into a cold-outbound Resend sequence.
--
-- Compliance: cold email is B2B only (PECR/GDPR). Segments are 'partner'
-- (tradespeople / sole traders) and 'b2b_client' (estate agents, letting
-- agents, property managers, facilities, landlords). No consumer/B2C leads.

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  source          text        not null default 'apify',
  apify_actor     text,
  apify_run_id    text,
  segment         text        not null check (segment in ('partner','b2b_client')),
  email           text,
  company_name    text,
  contact_name    text,
  phone           text,
  website         text,
  category        text,
  town            text,
  country         text,
  status          text        not null default 'new'
                    check (status in ('new','enrolled','converted','unsubscribed','invalid','suppressed')),
  enrolled_sequence text,
  raw             jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Dedup: one lead per email (case-insensitive). Leads without an email are
-- still stored (for phone/manual follow-up) but never collide.
create unique index if not exists leads_email_unique
  on public.leads (lower(email))
  where email is not null;

create index if not exists leads_status  on public.leads (status);
create index if not exists leads_segment on public.leads (segment);

alter table public.leads enable row level security;
