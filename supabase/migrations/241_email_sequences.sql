-- Email marketing lifecycle engine (Resend-delivered).
-- A contact is "enrolled" into a named sequence; a cron walks due steps,
-- renders the template, sends via Resend, logs it, then advances or completes.
-- Conversion events stop a nurture sequence (and can enroll into the next one);
-- recurring sequences loop forever (the "infinite" seasonal/cert reminders).

create table if not exists public.email_sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  sequence_key  text        not null,            -- e.g. 'client_demand_nurture'
  contact_email text        not null,
  contact_name  text,
  status        text        not null default 'active'
                  check (status in ('active','completed','converted','stopped')),
  current_step  int         not null default 0,  -- index of the NEXT step to send
  cycle         int         not null default 0,  -- loop counter for recurring sequences
  context       jsonb       not null default '{}'::jsonb, -- placeholders (service, urls, amounts…)
  enrolled_at   timestamptz not null default now(),
  next_send_at  timestamptz not null default now(),
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One live enrollment per (sequence, email). Re-enrolling is allowed once the
-- prior run is no longer active (completed/converted/stopped).
create unique index if not exists email_seq_one_active
  on public.email_sequence_enrollments (sequence_key, contact_email)
  where status = 'active';

-- Cron hot path: "give me everything that's due".
create index if not exists email_seq_due
  on public.email_sequence_enrollments (next_send_at)
  where status = 'active';

-- Per-step send log: audit + idempotency (never send the same step twice).
create table if not exists public.email_sequence_sends (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.email_sequence_enrollments(id) on delete cascade,
  sequence_key  text not null,
  step_key      text not null,
  step_index    int  not null,
  contact_email text not null,
  subject       text,
  resend_id     text,
  cycle         int  not null default 0,         -- bumped each loop for recurring sequences
  sent_at       timestamptz not null default now()
);

-- Idempotency guard: a given step in a given cycle is sent at most once.
create unique index if not exists email_seq_send_once
  on public.email_sequence_sends (enrollment_id, step_index, cycle);

-- RLS: engine runs with the service role (bypasses RLS). Enable + lock down so
-- the anon/auth keys can't read marketing PII.
alter table public.email_sequence_enrollments enable row level security;
alter table public.email_sequence_sends       enable row level security;
