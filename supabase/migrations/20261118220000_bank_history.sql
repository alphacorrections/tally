-- When older bank history was last pulled, so it isn't repeated often enough to trip SimpleFIN's daily limits.
alter table public.bank_links add column if not exists history_at timestamptz;
