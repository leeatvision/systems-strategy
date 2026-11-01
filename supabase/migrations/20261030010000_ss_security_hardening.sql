-- Security hardening after the 30 Oct 2026 review.
--
-- 1. PIN guessing: progressive lockout per email.
--      5 wrong in 15 minutes  -> locked 15 minutes
--      10 wrong in 24 hours   -> locked 24 hours
--      30 wrong since the last good sign-in or reset -> locked until an owner resets the PIN
--    An owner resetting a PIN (or anyone changing their own) clears that email's lockout.
--    A flood of wrong PINs across all emails (300 in 10 minutes) pauses sign-in checks
--    for everyone briefly, so the failure log can't be used to bloat the database.
-- 2. Personal To-Dos: their comments, attachments, files and change history now follow
--    the To-Do's privacy (only the owner sees them).

create or replace function public.ss_verify_pin(p_email text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(trim(p_email));
  v_member uuid;
  v_hash   text;
begin
  if (select count(*) from public.ss_pin_failures where attempted_at > now() - interval '10 minutes') >= 300 then
    raise exception 'busy';
  end if;
  if (select count(*) from public.ss_pin_failures where email = v_email) >= 30 then
    raise exception 'locked_reset';
  end if;
  if (select count(*) from public.ss_pin_failures
      where email = v_email and attempted_at > now() - interval '24 hours') >= 10 then
    raise exception 'locked_day';
  end if;
  if (select count(*) from public.ss_pin_failures
      where email = v_email and attempted_at > now() - interval '15 minutes') >= 5 then
    raise exception 'locked';
  end if;

  select m.id, p.pin_hash into v_member, v_hash
    from public.ss_members m
    join public.ss_member_pins p on p.member_id = m.id
   where lower(m.email) = v_email and m.status = 'active';

  if v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.ss_pin_failures (email) values (v_email);
    delete from public.ss_pin_failures where attempted_at < now() - interval '90 days';
    return null;
  end if;

  delete from public.ss_pin_failures where email = v_email;
  return v_member;
end $$;

-- Setting a PIN also lifts any lockout on that person's email.
create or replace function public.ss_set_member_pin(p_member uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email   text;
  v_caller  uuid;
begin
  select company_id, lower(email) into v_company, v_email
    from public.ss_members where id = p_member and status = 'active';
  if v_company is null then
    raise exception 'Person not found';
  end if;
  v_caller := public.ss_my_member_id(v_company);
  if v_caller is null or (v_caller <> p_member and not public.ss_is_owner(v_company)) then
    raise exception 'Only an owner can set someone else''s PIN';
  end if;
  if not public.ss_pin_is_acceptable(p_pin) then
    raise exception 'PIN must be 6 digits, not all the same and not a straight run like 123456';
  end if;
  insert into public.ss_member_pins (member_id, company_id, pin_hash, set_by)
  values (p_member, v_company, public.ss_hash_pin(p_pin), v_caller)
  on conflict (member_id) do update
    set pin_hash = excluded.pin_hash, set_by = excluded.set_by, set_at = now();
  delete from public.ss_pin_failures where email = v_email;
end $$;

-- Owners can see who is locked out (for the People screen), never the PINs.
create function public.ss_locked_members(p_company uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.ss_members m
  where m.company_id = p_company and public.ss_is_owner(p_company)
    and (select count(*) from public.ss_pin_failures f
         where f.email = lower(m.email) and f.attempted_at > now() - interval '24 hours') >= 5
$$;
revoke execute on function public.ss_locked_members(uuid) from public, anon;
grant execute on function public.ss_locked_members(uuid) to authenticated;

-- Is this item visible to me? Runs with the caller's rights, so To-Do privacy applies.
create function public.ss_item_visible(p_item_type text, p_item_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select case when p_item_type = 'todo'
    then exists (select 1 from public.ss_todos t where t.id = p_item_id)
    else true end
$$;

drop policy "members read" on public.ss_comments;
drop policy "members add as self" on public.ss_comments;
create policy "members read" on public.ss_comments for select to authenticated
  using (public.ss_is_member(company_id) and public.ss_item_visible(item_type, item_id));
create policy "members add as self" on public.ss_comments for insert to authenticated
  with check (public.ss_is_member(company_id) and author_id = public.ss_my_member_id(company_id)
              and public.ss_item_visible(item_type, item_id));

drop policy "members read" on public.ss_attachments;
drop policy "members add" on public.ss_attachments;
drop policy "members edit" on public.ss_attachments;
create policy "members read" on public.ss_attachments for select to authenticated
  using (public.ss_is_member(company_id) and public.ss_item_visible(item_type, item_id));
create policy "members add" on public.ss_attachments for insert to authenticated
  with check (public.ss_is_member(company_id) and public.ss_item_visible(item_type, item_id));
create policy "members edit" on public.ss_attachments for update to authenticated
  using (public.ss_is_member(company_id) and public.ss_item_visible(item_type, item_id))
  with check (public.ss_is_member(company_id) and public.ss_item_visible(item_type, item_id));

-- Change history: hide entries about someone else's personal To-Do.
create function public.ss_log_visible(p_table text, p_row uuid, p_old jsonb, p_new jsonb)
returns boolean language sql stable set search_path = '' as $$
  select case p_table
    when 'ss_todos' then public.ss_item_visible('todo', p_row)
    when 'ss_todo_checklist' then public.ss_item_visible('todo', coalesce(p_new->>'todo_id', p_old->>'todo_id')::uuid)
    when 'ss_comments' then public.ss_item_visible(coalesce(p_new->>'item_type', p_old->>'item_type'),
                                                     coalesce(p_new->>'item_id', p_old->>'item_id')::uuid)
    else true end
$$;
drop policy "members read" on public.ss_activity_log;
create policy "members read" on public.ss_activity_log for select to authenticated
  using (public.ss_is_member(company_id) and public.ss_log_visible(table_name, row_id, old_row, new_row));

-- Files: a personal To-Do's files are only for its owner.
create or replace function public.ss_can_access_file(p_bucket text, p_name text, p_owner_only boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_type    text := split_part(p_name, '/', 2);
  v_item    uuid;
begin
  if p_bucket <> 'ss-attachments' then
    return false;
  end if;
  begin
    v_company := (split_part(p_name, '/', 1))::uuid;
    if v_type = 'todo' then v_item := (split_part(p_name, '/', 3))::uuid; end if;
  exception when invalid_text_representation then
    return false;
  end;
  if v_type = 'todo' and not exists (
      select 1 from public.ss_todos t
      where t.id = v_item and t.company_id = v_company
        and (not t.is_personal or t.owner_member_id = public.ss_my_member_id(v_company))) then
    return false;
  end if;
  return case when p_owner_only then public.ss_is_owner(v_company) else public.ss_is_member(v_company) end;
end $$;

-- Server only: remove a login that existed before the person's first PIN sign-in
-- (it could have been created by someone else through Supabase's own sign-up).
create function public.ss_unlinked_auth_user(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and not exists (select 1 from public.ss_members m where m.user_id = u.id)
  limit 1
$$;
revoke execute on function public.ss_unlinked_auth_user(text) from public, anon, authenticated;
grant execute on function public.ss_unlinked_auth_user(text) to service_role;

-- Show every lock level to owners, not just recent ones.
create or replace function public.ss_locked_members(p_company uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.ss_members m
  where m.company_id = p_company and public.ss_is_owner(p_company)
    and ((select count(*) from public.ss_pin_failures f where f.email = lower(m.email)) >= 30
      or (select count(*) from public.ss_pin_failures f
          where f.email = lower(m.email) and f.attempted_at > now() - interval '24 hours') >= 10
      or (select count(*) from public.ss_pin_failures f
          where f.email = lower(m.email) and f.attempted_at > now() - interval '15 minutes') >= 5)
$$;
