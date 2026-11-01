-- Standard Questions: each checkup type's own list, used to start every new checkup of that type.
-- Owners keep the lists; everyone can read them. A checkup copies the list when it's created, so later
-- edits to the list don't change checkups already running. Questions can sit under group headings.

create table public.ss_checkup_standard_questions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  kind        text not null check (kind in ('org', 'culture', 'other')),
  group_title text,
  sort_order  integer not null,
  text        text not null check (length(trim(text)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.ss_checkup_standard_questions (company_id, kind, sort_order);

alter table public.ss_checkup_standard_questions enable row level security;
create policy "members read" on public.ss_checkup_standard_questions for select to authenticated using (public.ss_is_member(company_id));
create policy "owners add" on public.ss_checkup_standard_questions for insert to authenticated with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_checkup_standard_questions for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));
create policy "owners remove" on public.ss_checkup_standard_questions for delete to authenticated using (public.ss_is_owner(company_id));

create trigger ss_log after insert or update or delete on public.ss_checkup_standard_questions
  for each row execute function public.ss_log_change();
create trigger ss_touch before update on public.ss_checkup_standard_questions
  for each row execute function public.ss_touch_updated_at();

-- A checkup's own questions can carry the group heading too.
alter table public.ss_checkup_questions add column group_title text;
