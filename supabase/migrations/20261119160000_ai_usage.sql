-- How many assistant messages each person has sent per day, so one key can't be run up without limit.
-- No policies: only the server function reads or writes it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  n       int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
