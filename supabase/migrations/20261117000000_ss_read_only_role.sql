-- A "Read-only" role (stored as 'viewer'): sees everything an active member sees, changes nothing.
-- Personal things stay theirs: own name and PIN, notification settings, marking notifications read,
-- own phone subscriptions and calendar link.

alter table public.ss_members drop constraint if exists ss_members_role_check;
alter table public.ss_members add constraint ss_members_role_check check (role in ('owner', 'leader', 'member', 'viewer'));

-- Active and allowed to make changes (every role except Read-only).
create or replace function public.ss_can_edit(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ss_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and m.role <> 'viewer'
  )
$$;
grant execute on function public.ss_can_edit(uuid) to authenticated;

-- Every rule that lets members add, change or remove things now also needs ss_can_edit.
do $$
declare r record; q text; w text;
begin
  for r in
    select c.relname tbl, p.polname, p.polcmd::text cmd, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) w
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'ss\_%' and p.polcmd::text in ('a', 'w', 'd')
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%ss_is_member(%' or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%ss_is_member(%')
  loop
    q := replace(r.q, 'ss_is_member(', 'ss_can_edit(');
    w := replace(r.w, 'ss_is_member(', 'ss_can_edit(');
    if r.cmd = 'a' then execute format('alter policy %I on public.%I with check (%s)', r.polname, r.tbl, w);
    elsif r.cmd = 'd' then execute format('alter policy %I on public.%I using (%s)', r.polname, r.tbl, q);
    else execute format('alter policy %I on public.%I using (%s) with check (%s)', r.polname, r.tbl, q, w);
    end if;
  end loop;
end $$;

-- Checklist items: one rule covered reading and writing; split it so reading stays open and writing needs ss_can_edit.
drop policy if exists "members via todo" on public.ss_todo_checklist;
create policy "read via todo" on public.ss_todo_checklist for select to authenticated
  using (exists (select 1 from public.ss_todos t where t.id = ss_todo_checklist.todo_id));
create policy "add via todo" on public.ss_todo_checklist for insert to authenticated
  with check (public.ss_can_edit(company_id) and exists (select 1 from public.ss_todos t where t.id = ss_todo_checklist.todo_id));
create policy "edit via todo" on public.ss_todo_checklist for update to authenticated
  using (public.ss_can_edit(company_id) and exists (select 1 from public.ss_todos t where t.id = ss_todo_checklist.todo_id))
  with check (public.ss_can_edit(company_id) and exists (select 1 from public.ss_todos t where t.id = ss_todo_checklist.todo_id));
create policy "remove via todo" on public.ss_todo_checklist for delete to authenticated
  using (public.ss_can_edit(company_id) and exists (select 1 from public.ss_todos t where t.id = ss_todo_checklist.todo_id));

-- Checkup answers and comments: Read-only people don't answer, and can't edit old comments.
alter policy "answer while open" on public.ss_checkup_answers with check (public.ss_can_edit(company_id) and (member_id = public.ss_my_member_id(company_id)) and public.ss_checkup_open(checkup_id)
  and exists (select 1 from public.ss_checkup_questions q where q.id = ss_checkup_answers.question_id and q.checkup_id = ss_checkup_answers.checkup_id));
alter policy "change while open" on public.ss_checkup_answers using (public.ss_can_edit(company_id) and (member_id = public.ss_my_member_id(company_id)) and public.ss_checkup_open(checkup_id));
alter policy "clear while open" on public.ss_checkup_answers using (public.ss_can_edit(company_id) and (member_id = public.ss_my_member_id(company_id)) and public.ss_checkup_open(checkup_id));
alter policy "authors edit" on public.ss_comments using (public.ss_can_edit(company_id) and author_id = public.ss_my_member_id(company_id))
  with check (public.ss_can_edit(company_id) and author_id = public.ss_my_member_id(company_id));

-- File uploads: the storage side needs the same check (the path starts with the company id).
create or replace function public.ss_can_edit_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return public.ss_can_edit(split_part(p_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end $$;
grant execute on function public.ss_can_edit_path(text) to authenticated;
alter policy "members upload files" on storage.objects with check (public.ss_can_access_file(bucket_id, name, false) and public.ss_can_edit_path(name));
