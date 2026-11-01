-- Only owners change the Org Chart.
--
-- Everyone can still see it. Adding, editing, moving or removing positions and the
-- people in them, and making a draft official, is for owners.

drop policy "members add" on public.ss_org_charts;
drop policy "members edit" on public.ss_org_charts;
create policy "owners add" on public.ss_org_charts for insert to authenticated
  with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_org_charts for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));

drop policy "members add" on public.ss_positions;
drop policy "members edit" on public.ss_positions;
drop policy "members remove" on public.ss_positions;
create policy "owners add" on public.ss_positions for insert to authenticated
  with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_positions for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));

drop policy "members add" on public.ss_position_holders;
drop policy "members edit" on public.ss_position_holders;
drop policy "members remove" on public.ss_position_holders;
create policy "owners add" on public.ss_position_holders for insert to authenticated
  with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_position_holders for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));
