-- Together gets shared lists (to-dos, shopping). The merge now handles every list in the
-- document, so new lists don't need a database change: each item is kept by id, newest "upd" wins.
create or replace function public.space_merge(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'v', 1,
    'updatedAt', greatest(coalesce(a->>'updatedAt', ''), coalesce(b->>'updatedAt', ''))
  ) || coalesce((
    select jsonb_object_agg(ks.k, coalesce((
      select jsonb_agg(t.x order by coalesce(t.x->>'date', ''), t.x->>'id')
      from (
        select distinct on (s.x->>'id') s.x
        from (
          select jsonb_array_elements(case when jsonb_typeof(a->ks.k) = 'array' then a->ks.k else '[]'::jsonb end) as x
          union all
          select jsonb_array_elements(case when jsonb_typeof(b->ks.k) = 'array' then b->ks.k else '[]'::jsonb end)
        ) s
        order by s.x->>'id', coalesce(s.x->>'upd', '') desc
      ) t
    ), '[]'::jsonb))
    from (
      select k from jsonb_object_keys(case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end) k
      union
      select k from jsonb_object_keys(case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end) k
    ) ks
    where jsonb_typeof(a->ks.k) = 'array' or jsonb_typeof(b->ks.k) = 'array'
  ), '{}'::jsonb);
$$;
