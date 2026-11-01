-- Checkup Types: Organisation and Culture (built in, renameable, not removable), Other (built in, one-off:
-- questions are written for each checkup, no standard list) and any types owners add. Each type is
-- identified by a fixed key that checkups and Standard Questions point at; removing a custom type hides it
-- from new checkups while past checkups keep showing its name.

create table public.ss_checkup_types (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  key         text not null unique default gen_random_uuid()::text,
  name        text not null check (length(trim(name)) > 0),
  built_in    boolean not null default false,
  is_one_off  boolean not null default false,
  sort_order  integer not null default 100,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.ss_checkup_types (company_id, key, name, built_in, is_one_off, sort_order)
select c.id, t.key, t.name, true, t.one_off, t.n
from public.ss_companies c, (values ('org', 'Organisation', false, 1), ('culture', 'Culture', false, 2), ('other', 'Other', true, 999)) as t(key, name, one_off, n);

-- Checkups and Standard Questions now point at a type instead of a fixed list.
alter table public.ss_checkups drop constraint ss_checkups_kind_check;
alter table public.ss_checkup_standard_questions drop constraint ss_checkup_standard_questions_kind_check;
alter table public.ss_checkups add constraint ss_checkups_kind_fkey
  foreign key (kind) references public.ss_checkup_types(key);
alter table public.ss_checkup_standard_questions add constraint ss_checkup_standard_questions_kind_fkey
  foreign key (kind) references public.ss_checkup_types(key) on delete cascade;
create index on public.ss_checkup_standard_questions (kind);
create index on public.ss_checkups (kind);

-- Built-in types can't be removed or turned into something else, and no type's key ever changes.
create function public.ss_guard_checkup_type()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.key <> old.key or new.built_in <> old.built_in or new.is_one_off <> old.is_one_off then
    raise exception 'A checkup type''s key and kind can''t be changed';
  end if;
  if old.built_in and new.deleted_at is not null then
    raise exception 'Built-in checkup types can''t be removed';
  end if;
  return new;
end $$;
create trigger ss_checkup_type_guard before update on public.ss_checkup_types
  for each row execute function public.ss_guard_checkup_type();

alter table public.ss_checkup_types enable row level security;
create policy "members read" on public.ss_checkup_types for select to authenticated using (public.ss_is_member(company_id));
create policy "owners add" on public.ss_checkup_types for insert to authenticated
  with check (public.ss_is_owner(company_id) and not built_in and not is_one_off);
create policy "owners edit" on public.ss_checkup_types for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));

create trigger ss_log after insert or update or delete on public.ss_checkup_types
  for each row execute function public.ss_log_change();
create trigger ss_touch before update on public.ss_checkup_types
  for each row execute function public.ss_touch_updated_at();
