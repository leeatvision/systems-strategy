-- Removing a part of an item is editing it, not deleting it.
--
-- Members can already add and change a Goal's steps and resources, a meeting's
-- agenda sections and its invite list; this lets them remove those parts too.
-- Whole Goals, To-Dos, Issues, Headlines, measurables and meetings still go to
-- the recycle bin, and only owners delete them permanently. Every removal is
-- still recorded in the change history.

create policy "members remove" on public.ss_goal_steps for delete to authenticated
  using (public.ss_is_member(company_id));
create policy "members remove" on public.ss_goal_resources for delete to authenticated
  using (public.ss_is_member(company_id));
create policy "members remove" on public.ss_agenda_items for delete to authenticated
  using (public.ss_is_member(company_id));
create policy "members remove" on public.ss_meeting_invitees for delete to authenticated
  using (public.ss_is_member(company_id));
