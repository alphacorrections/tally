-- Newer Supabase projects don't grant table access to signed-in users by default.
-- Row-level security still decides which rows each person sees.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.spaces, public.space_members to authenticated;
revoke all on public.docs, public.spaces, public.space_members, public.bank_links from anon;
revoke all on public.bank_links from authenticated;
