-- Fixes from the 31 October 2026 review.

-- 1. An anonymous checkup stays anonymous once anyone has answered (and a named one stays named),
--    so changing the setting can't reveal who said what.
create function public.ss_guard_checkup_anonymity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.anonymous is distinct from old.anonymous
     and exists (select 1 from public.ss_checkup_answers a where a.checkup_id = old.id) then
    raise exception 'Anonymity can''t be changed after people have answered';
  end if;
  return new;
end $$;
create trigger ss_checkup_anonymity before update on public.ss_checkups
  for each row execute function public.ss_guard_checkup_anonymity();

-- 2. An answer must be to a question of the checkup it's filed under, so a closed checkup's
--    results can't be changed through an open one.
drop policy "answer while open" on public.ss_checkup_answers;
drop policy "change while open" on public.ss_checkup_answers;
create policy "answer while open" on public.ss_checkup_answers for insert to authenticated
  with check (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id)
    and exists (select 1 from public.ss_checkup_questions q where q.id = question_id and q.checkup_id = ss_checkup_answers.checkup_id));
create policy "change while open" on public.ss_checkup_answers for update to authenticated
  using (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id))
  with check (member_id = public.ss_my_member_id(company_id) and public.ss_checkup_open(checkup_id)
    and exists (select 1 from public.ss_checkup_questions q where q.id = question_id and q.checkup_id = ss_checkup_answers.checkup_id));

-- 3. Clearing a Scorecard number is editing the Scorecard, so any member can do it (it was owners only,
--    and a leader's "clear" silently did nothing).
drop policy "owners delete" on public.ss_measurable_values;
create policy "members remove" on public.ss_measurable_values for delete to authenticated
  using (public.ss_is_member(company_id));

-- 4. "owners delete" is covered by "members remove" (owners are members) on these tables.
drop policy "owners delete" on public.ss_agenda_items;
drop policy "owners delete" on public.ss_meeting_invitees;
drop policy "owners delete" on public.ss_goal_resources;
drop policy "owners delete" on public.ss_goal_steps;
drop policy "owners delete" on public.ss_plan_items;

-- 5. Look up the caller once per query, not once per row.
drop policy "self or owner edit" on public.ss_members;
create policy "self or owner edit" on public.ss_members for update to authenticated
  using (user_id = (select auth.uid()) or public.ss_is_owner(company_id))
  with check (user_id = (select auth.uid()) or public.ss_is_owner(company_id));

-- 6. Indexes for links that are followed often or checked when a row is deleted.
create index on public.ss_positions (parent_position_id);
create index on public.ss_push_subscriptions (member_id);
create index on public.ss_todos (repeat_parent_id);
create index on public.ss_goals (parent_goal_id);
create index on public.ss_headlines (cascaded_from_id);
create index on public.ss_plan_items (linked_goal_id);
create index on public.ss_plan_items (linked_issue_id);
create index on public.ss_measurables (owner_member_id);
create index on public.ss_todos (created_in_session_id);
create index on public.ss_issues (created_in_session_id);
