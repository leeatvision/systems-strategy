-- Documented core processes.
--
-- A process has an owner, a short description and ordered steps (each with
-- details). "Followed by all" records how well the team actually follows it,
-- with the date it was last reviewed. Same access as everything else: members
-- read, add and edit; owners delete permanently; removing a step is editing.

create table public.ss_processes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.ss_companies(id) on delete cascade,
  owner_member_id    uuid references public.ss_members(id) on delete set null,
  title              text not null check (length(trim(title)) > 0),
  description        text,
  status             text not null default 'draft' check (status in ('draft', 'live')),
  followed_by_all    smallint check (followed_by_all between 0 and 100), -- percent, as last reviewed
  reviewed_on        date,
  sort_order         integer not null default 0,
  deleted_at         timestamptz,
  created_by         uuid references public.ss_members(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.ss_process_steps (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  process_id  uuid not null references public.ss_processes(id) on delete cascade,
  sort_order  integer not null,
  title       text not null default '',
  details     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.ss_process_steps (process_id, sort_order);

do $$
declare t text;
begin
  foreach t in array array['ss_processes', 'ss_process_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.ss_is_member(company_id))', t);
    execute format('create policy "members add" on public.%I for insert to authenticated with check (public.ss_is_member(company_id))', t);
    execute format('create policy "members edit" on public.%I for update to authenticated using (public.ss_is_member(company_id)) with check (public.ss_is_member(company_id))', t);
    execute format('create trigger ss_log after insert or update or delete on public.%I for each row execute function public.ss_log_change()', t);
    execute format('create trigger ss_touch before update on public.%I for each row execute function public.ss_touch_updated_at()', t);
  end loop;
end $$;
create policy "owners delete" on public.ss_processes for delete to authenticated using (public.ss_is_owner(company_id));
create policy "members remove" on public.ss_process_steps for delete to authenticated using (public.ss_is_member(company_id));

-- Comments and files work on processes too.
alter table public.ss_comments drop constraint ss_comments_item_type_check;
alter table public.ss_comments add constraint ss_comments_item_type_check
  check (item_type in ('goal', 'todo', 'issue', 'headline', 'process'));
alter table public.ss_attachments drop constraint ss_attachments_item_type_check;
alter table public.ss_attachments add constraint ss_attachments_item_type_check
  check (item_type in ('goal', 'todo', 'issue', 'headline', 'meeting', 'process'));
