-- As with Goal steps, removing a line from the Vision & Plan or a
-- position (or position holder) from the Org Chart is editing, so members
-- can do it. Whole Vision & Plan versions and charts are archived, not deleted, and
-- every removal is still recorded in the change history.

create policy "members remove" on public.ss_plan_items for delete to authenticated
  using (public.ss_is_member(company_id));
create policy "members remove" on public.ss_positions for delete to authenticated
  using (public.ss_is_member(company_id));
create policy "members remove" on public.ss_position_holders for delete to authenticated
  using (public.ss_is_member(company_id));
