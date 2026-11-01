-- Checkups with your own questions (organisation, culture, anything).
--
-- Everyone scores each question 1-5 with an optional comment. People can only
-- ever read their own answers; results come from ss_checkup_results, which
-- returns averages, spreads and comments, with names only when the checkup
-- isn't anonymous.

create table public.ss_checkups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  kind        text not null default 'org' check (kind in ('org', 'culture', 'other')),
  anonymous   boolean not null default true,
  status      text not null default 'open' check (status in ('open', 'closed')),
  closed_at   timestamptz,
  deleted_at  timestamptz,
  created_by  uuid references public.ss_members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.ss_checkup_questions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  checkup_id  uuid not null references public.ss_checkups(id) on delete cascade,
  sort_order  integer not null,
  text        text not null check (length(trim(text)) > 0),
  created_at  timestamptz not null default now()
);
create index on public.ss_checkup_questions (checkup_id, sort_order);

create table public.ss_checkup_answers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  checkup_id  uuid not null references public.ss_checkups(id) on delete cascade,
  question_id uuid not null references public.ss_checkup_questions(id) on delete cascade,
  member_id   uuid not null references public.ss_members(id) on delete cascade,
  score       smallint check (score between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (question_id, member_id)
);
create index on public.ss_checkup_answers (checkup_id);

alter table public.ss_checkups enable row level security;
alter table public.ss_checkup_questions enable row level security;
alter table public.ss_checkup_answers enable row level security;
revoke all on public.ss_checkups, public.ss_checkup_questions, public.ss_checkup_answers from anon;

-- Checkups and their questions: like everything else.
create policy "members read" on public.ss_checkups for select to authenticated using (public.ss_is_member(company_id));
create policy "members add" on public.ss_checkups for insert to authenticated with check (public.ss_is_member(company_id));
create policy "members edit" on public.ss_checkups for update to authenticated
  using (public.ss_is_member(company_id)) with check (public.ss_is_member(company_id));
create policy "owners delete" on public.ss_checkups for delete to authenticated using (public.ss_is_owner(company_id));
create policy "members read" on public.ss_checkup_questions for select to authenticated using (public.ss_is_member(company_id));
create policy "members add" on public.ss_checkup_questions for insert to authenticated with check (public.ss_is_member(company_id));
create policy "members edit" on public.ss_checkup_questions for update to authenticated
  using (public.ss_is_member(company_id)) with check (public.ss_is_member(company_id));
create policy "members remove" on public.ss_checkup_questions for delete to authenticated using (public.ss_is_member(company_id));

-- Answers: your own only, and only while the checkup is open.
create function public.ss_checkup_open(p_checkup uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ss_checkups where id = p_checkup and status = 'open' and deleted_at is null)
$$;
revoke execute on function public.ss_checkup_open(uuid) from public, anon;
grant execute on function public.ss_checkup_open(uuid) to authenticated;

create policy "own answers" on public.ss_checkup_answers for select to authenticated
  using (member_id = public.ss_my_member_id(company_id));
create policy "answer while open" on public.ss_checkup_answers for insert to authenticated
  with check (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id));
create policy "change while open" on public.ss_checkup_answers for update to authenticated
  using (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id))
  with check (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id));
create policy "clear while open" on public.ss_checkup_answers for delete to authenticated
  using (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id));

do $$
declare t text;
begin
  foreach t in array array['ss_checkups', 'ss_checkup_questions'] loop
    execute format('create trigger ss_log after insert or update or delete on public.%I for each row execute function public.ss_log_change()', t);
  end loop;
  -- Answers are not logged: the change history is readable by everyone and would reveal them.
  foreach t in array array['ss_checkups', 'ss_checkup_answers'] loop
    execute format('create trigger ss_touch before update on public.%I for each row execute function public.ss_touch_updated_at()', t);
  end loop;
end $$;

-- Results for members: per question, the average, how many answered, how the
-- scores spread (1-5) and the comments. Names only when not anonymous.
create function public.ss_checkup_results(p_checkup uuid)
returns table (question_id uuid, answered integer, average numeric, spread integer[], comments jsonb)
language sql stable security definer set search_path = '' as $$
  select q.id,
    count(a.score)::int,
    round(avg(a.score), 2),
    array[count(*) filter (where a.score = 1), count(*) filter (where a.score = 2), count(*) filter (where a.score = 3),
          count(*) filter (where a.score = 4), count(*) filter (where a.score = 5)]::int[],
    coalesce(jsonb_agg(jsonb_build_object('text', a.comment, 'member_id', case when c.anonymous then null else a.member_id end)
                       order by a.updated_at) filter (where nullif(trim(a.comment), '') is not null), '[]')
  from public.ss_checkups c
  join public.ss_checkup_questions q on q.checkup_id = c.id
  left join public.ss_checkup_answers a on a.question_id = q.id
  where c.id = p_checkup and public.ss_is_member(c.company_id)
  group by q.id, q.sort_order
  order by q.sort_order
$$;
revoke execute on function public.ss_checkup_results(uuid) from public, anon;
grant execute on function public.ss_checkup_results(uuid) to authenticated;

-- Who has answered (names only when not anonymous; otherwise just the count).
create function public.ss_checkup_responders(p_checkup uuid)
returns table (responders integer, member_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select count(distinct a.member_id)::int,
         case when bool_and(c.anonymous) then null else array_agg(distinct a.member_id) filter (where a.member_id is not null) end
  from public.ss_checkups c
  left join public.ss_checkup_answers a on a.checkup_id = c.id
  where c.id = p_checkup and public.ss_is_member(c.company_id)
  group by c.id
$$;
revoke execute on function public.ss_checkup_responders(uuid) from public, anon;
grant execute on function public.ss_checkup_responders(uuid) to authenticated;
