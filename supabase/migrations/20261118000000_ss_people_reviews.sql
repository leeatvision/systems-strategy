-- People Review: rate each person against a list of traits, review by review, with history.
-- Only owners and leaders can see or change any of it.
-- New tables only; nothing existing is changed.

-- Active owner or leader.
create or replace function public.ss_can_review(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ss_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'leader')
  )
$$;
revoke execute on function public.ss_can_review(uuid) from public, anon;
grant execute on function public.ss_can_review(uuid) to authenticated;

-- The company's default traits: copied into each new review, where they can be changed for that review alone.
-- scale 'plus' is rated +, +/- or -; 'yes_no' is rated Y or N. The bar is the lowest rating that passes.
create table public.ss_review_traits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'custom' check (kind in ('value', 'role', 'custom')),
  scale text not null default 'plus' check (scale in ('plus', 'yes_no')),
  bar text not null default '+/-' check (bar in ('+', '+/-', '-', 'Y', 'N')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ss_review_traits (company_id, sort_order);

-- One review on one date. traits holds this review's own columns: [{ id, title, kind, scale, bar }].
create table public.ss_people_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  title text,
  reviewed_on date not null default current_date,
  traits jsonb not null default '[]'::jsonb check (jsonb_typeof(traits) = 'array'),
  notes text,
  created_by uuid references public.ss_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.ss_people_reviews (company_id, reviewed_on desc);

-- One person in one review. ratings: { "<trait id>": "+" | "+/-" | "-" | "Y" | "N" }.
-- A person is someone in People (member_id) or just a name, for anyone not in the app.
create table public.ss_people_ratings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  review_id uuid not null references public.ss_people_reviews(id) on delete cascade,
  member_id uuid references public.ss_members(id) on delete set null,
  person_name text,
  ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_id is not null or length(trim(coalesce(person_name, ''))) > 0)
);
create index on public.ss_people_ratings (review_id, sort_order);
create index on public.ss_people_ratings (member_id);
create unique index ss_people_ratings_one_member on public.ss_people_ratings (review_id, member_id) where member_id is not null;

-- A rating must belong to a review of the same company.
create or replace function public.ss_people_rating_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ss_people_reviews r where r.id = new.review_id and r.company_id = new.company_id) then
    raise exception 'That review belongs to another company.';
  end if;
  if new.member_id is not null and not exists (select 1 from public.ss_members m where m.id = new.member_id and m.company_id = new.company_id) then
    raise exception 'That person belongs to another company.';
  end if;
  return new;
end $$;
create trigger ss_people_rating_company before insert or update on public.ss_people_ratings
  for each row execute function public.ss_people_rating_company();

do $$
declare t text;
begin
  foreach t in array array['ss_review_traits', 'ss_people_reviews', 'ss_people_ratings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger ss_touch before update on public.%I for each row execute function public.ss_touch_updated_at()', t);
    execute format('create policy "owners and leaders read" on public.%I for select to authenticated using (public.ss_can_review(company_id))', t);
    execute format('create policy "owners and leaders add" on public.%I for insert to authenticated with check (public.ss_can_review(company_id))', t);
    execute format('create policy "owners and leaders change" on public.%I for update to authenticated using (public.ss_can_review(company_id)) with check (public.ss_can_review(company_id))', t);
    execute format('create policy "owners and leaders remove" on public.%I for delete to authenticated using (public.ss_can_review(company_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Every company starts with the three role traits, rated Y or N, passing at Y.
insert into public.ss_review_traits (company_id, title, kind, scale, bar, sort_order)
select c.id, t.title, 'role', 'yes_no', 'Y', 100 + t.n
from public.ss_companies c
cross join (values (1, 'Understands It'), (2, 'Wants It'), (3, 'Able To Do It')) as t(n, title);

-- And with the values from its official Vision and Plan, rated +, +/- or -, passing at +/-.
insert into public.ss_review_traits (company_id, title, kind, scale, bar, sort_order)
select v.company_id, i.title, 'value', 'plus', '+/-', row_number() over (partition by v.company_id order by i.sort_order)
from public.ss_plan_items i
join public.ss_plan_versions v on v.id = i.version_id
where v.status = 'official' and i.section = 'value' and length(trim(coalesce(i.title, ''))) > 0;
