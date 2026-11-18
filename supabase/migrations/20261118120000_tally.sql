-- Tally on Supabase.
-- docs:          one private document per person (the whole app state as JSON). Only its owner can read or write it.
-- spaces:        a Together space shared by two people. Members read it; writes go through space_save, which merges.
-- space_members: who is in which space, and which person in the space ("p1"/"p2") they are.
-- bank_links:    the SimpleFIN access link per person. No policies, so only the server functions can read it.

create table if not exists public.docs (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  state       jsonb not null,
  updated_at  text not null default '',
  tz          text not null default 'America/New_York',
  app_url     text not null default '',
  last_remind date,
  saved_at    timestamptz not null default now()
);
alter table public.docs enable row level security;
drop policy if exists docs_own on public.docs;
create policy docs_own on public.docs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  state      jsonb not null default '{}'::jsonb,
  invite     text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  saved_at   timestamptz not null default now()
);
create table if not exists public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  person    text not null,
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id),
  unique (space_id, person)
);
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;

create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.space_members m where m.space_id = sid and m.user_id = (select auth.uid()));
$$;

drop policy if exists spaces_read on public.spaces;
create policy spaces_read on public.spaces for select to authenticated using (public.is_member(id));
drop policy if exists members_read on public.space_members;
create policy members_read on public.space_members for select to authenticated using (public.is_member(space_id));
-- No insert/update/delete policies: changes go through the functions below.

create table if not exists public.bank_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  access_url text not null,
  cache      jsonb,
  cached_at  timestamptz,
  pulled_at  timestamptz
);
alter table public.bank_links enable row level security;

-- Item-level merge of two Together documents: for each list, keep every item by id, newest "upd" wins.
create or replace function public.space_merge(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'v', 1,
    'updatedAt', greatest(coalesce(a->>'updatedAt', ''), coalesce(b->>'updatedAt', ''))
  ) || coalesce((
    select jsonb_object_agg(k, coalesce((
      select jsonb_agg(t.x order by coalesce(t.x->>'date', ''), t.x->>'id')
      from (
        select distinct on (s.x->>'id') s.x
        from (
          select jsonb_array_elements(case when jsonb_typeof(a->k) = 'array' then a->k else '[]'::jsonb end) as x
          union all
          select jsonb_array_elements(case when jsonb_typeof(b->k) = 'array' then b->k else '[]'::jsonb end)
        ) s
        order by s.x->>'id', coalesce(s.x->>'upd', '') desc
      ) t
    ), '[]'::jsonb))
    from unnest(array['people', 'exp', 'bills', 'goals', 'contrib', 'settle']) as k
  ), '{}'::jsonb);
$$;

-- 8 characters, no 0/O/1/I, easy to read out loud or type.
create or replace function public.new_invite() returns text
language plpgsql volatile set search_path = '' as $$
declare
  b  bytea := uuid_send(gen_random_uuid());
  al text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  s  text := '';
  i  int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    s := s || substr(al, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return s;
end $$;

create or replace function public.space_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'person', m.person, 'state', s.state,
           'invite', case when (select count(*) from public.space_members x where x.space_id = s.id) < 2 then s.invite end,
           'owner', s.created_by = (select auth.uid()))
  from public.space_members m join public.spaces s on s.id = m.space_id
  where m.user_id = (select auth.uid())
  order by m.joined_at desc limit 1;
$$;

create or replace function public.space_create(doc jsonb, me text default 'p1') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare sid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  loop
    code := public.new_invite();
    exit when not exists (select 1 from public.spaces where invite = code);
  end loop;
  insert into public.spaces (state, invite, created_by) values (coalesce(doc, '{}'::jsonb), code, auth.uid()) returning id into sid;
  insert into public.space_members (space_id, user_id, person) values (sid, auth.uid(), coalesce(nullif(me, ''), 'p1'));
  return jsonb_build_object('id', sid, 'invite', code, 'person', coalesce(nullif(me, ''), 'p1'), 'state', doc, 'owner', true);
end $$;

create or replace function public.space_join(code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare sp public.spaces; who text; n int; c text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  c := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into sp from public.spaces where invite = c for update;
  if not found then raise exception 'That invite code didn''t match. Check it and try again.'; end if;
  select person into who from public.space_members where space_id = sp.id and user_id = auth.uid();
  if who is null then
    select count(*) into n from public.space_members where space_id = sp.id;
    if n >= 2 then raise exception 'That invite was already used.'; end if;
    select p->>'id' into who
      from jsonb_array_elements(case when jsonb_typeof(sp.state->'people') = 'array' then sp.state->'people' else '[]'::jsonb end) p
     where not coalesce((p->>'del')::boolean, false)
       and p->>'id' not in (select person from public.space_members where space_id = sp.id)
     limit 1;
    who := coalesce(who, 'p2');
    insert into public.space_members (space_id, user_id, person) values (sp.id, auth.uid(), who);
  end if;
  return jsonb_build_object('id', sp.id, 'person', who, 'state', sp.state, 'owner', false);
end $$;

-- Merge what this phone has into the stored copy and hand back the result, in one locked step.
create or replace function public.space_save(sid uuid, doc jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_member(sid) then raise exception 'Not your shared space'; end if;
  update public.spaces set state = public.space_merge(state, doc), saved_at = now() where id = sid returning state into res;
  return res;
end $$;

create or replace function public.space_leave(sid uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.space_members where space_id = sid and user_id = auth.uid();
  delete from public.spaces s where s.id = sid and not exists (select 1 from public.space_members m where m.space_id = sid);
end $$;

revoke execute on function public.space_mine() from public, anon;
revoke execute on function public.space_create(jsonb, text) from public, anon;
revoke execute on function public.space_join(text) from public, anon;
revoke execute on function public.space_save(uuid, jsonb) from public, anon;
revoke execute on function public.space_leave(uuid) from public, anon;
revoke execute on function public.new_invite() from public, anon, authenticated;
grant execute on function public.space_mine() to authenticated;
grant execute on function public.space_create(jsonb, text) to authenticated;
grant execute on function public.space_join(text) to authenticated;
grant execute on function public.space_save(uuid, jsonb) to authenticated;
grant execute on function public.space_leave(uuid) to authenticated;
