-- Push notifications and the icon badge.
-- push_keys: the server's signing key pair (made by the push function the first time it runs). Server-only.
-- push_subs: one row per phone or browser that turned notifications on.
-- push_queue: what each device should show next. A push wakes the device; it then asks for its queue.
-- push_sent: one row per reminder already sent, so nobody gets the same one twice.
create table if not exists public.push_keys (
  id         int primary key default 1 check (id = 1),
  pub        text not null,
  priv       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;

create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  ua         text not null default '',
  created_at timestamptz not null default now(),
  last_ok    timestamptz,
  fails      int not null default 0
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;

create table if not exists public.push_queue (
  id         bigserial primary key,
  endpoint   text not null references public.push_subs(endpoint) on delete cascade,
  title      text not null,
  body       text not null default '',
  tag        text not null default '',
  url        text not null default '',
  badge      int,
  created_at timestamptz not null default now(),
  fetched_at timestamptz
);
create index if not exists push_queue_endpoint on public.push_queue (endpoint, fetched_at);
alter table public.push_queue enable row level security;

create table if not exists public.push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null,
  at      timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_sent enable row level security;

-- Hourly tick. The push function decides who is due something, in their own time zone.
select cron.unschedule(jobid) from cron.job where jobname = 'tally-push';
select cron.schedule(
  'tally-push',
  '17 * * * *',
  $$select net.http_post(
      url := 'https://xklfnsqypmsqvcernpwq.supabase.co/functions/v1/push',
      body := '{"tick":true}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb
    )$$
);
