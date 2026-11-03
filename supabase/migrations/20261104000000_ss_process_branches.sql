-- Processes can branch: an If/Then Step asks a question, each answer holds its own steps
-- (which can branch again), then the process carries on with the shared steps, or ends there.

create table public.ss_process_answers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  process_id  uuid not null references public.ss_processes(id) on delete cascade,
  step_id     uuid not null references public.ss_process_steps(id) on delete cascade,
  label       text not null default '' check (char_length(label) <= 120),
  sort_order  integer not null default 0,
  ends        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.ss_process_answers (step_id);

alter table public.ss_process_steps
  add column kind text not null default 'step' check (kind in ('step', 'if')),
  add column answer_id uuid references public.ss_process_answers(id) on delete cascade;
create index on public.ss_process_steps (answer_id);

alter table public.ss_process_answers enable row level security;
revoke all on public.ss_process_answers from anon;
create policy "members read" on public.ss_process_answers for select to authenticated using (public.ss_is_member(company_id));
create policy "members add" on public.ss_process_answers for insert to authenticated with check (public.ss_is_member(company_id));
create policy "members edit" on public.ss_process_answers for update to authenticated using (public.ss_is_member(company_id)) with check (public.ss_is_member(company_id));
create policy "members remove" on public.ss_process_answers for delete to authenticated using (public.ss_is_member(company_id));
create trigger ss_log after insert or update or delete on public.ss_process_answers for each row execute function public.ss_log_change();
