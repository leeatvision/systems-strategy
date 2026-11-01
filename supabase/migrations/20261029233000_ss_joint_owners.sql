-- Joint ownership and a starting roster.
--
-- First-time set-up may be run by any email listed in the server-only
-- setting `bootstrap_owner_emails` (comma-separated). Set-up also adds every
-- person in `initial_members` (a JSON list of {email, first_name, last_name,
-- role}), so both owners and the starting team exist from day one. They get
-- PINs from an owner in the People screen. Names and emails live only in
-- ss_private_settings, never in this repo.

create function public.ss_setup_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ss_private_settings s,
           unnest(string_to_array(s.value, ',')) as e(addr)
    where s.key = 'bootstrap_owner_emails' and lower(trim(e.addr)) = lower(trim(p_email))
  )
$$;

create or replace function public.ss_bootstrap_company(
  p_user uuid, p_email text, p_company_name text, p_first_name text, p_last_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_member  uuid;
  v_team    uuid;
  v_meeting uuid;
  v_person  jsonb;
  v_other   uuid;
begin
  if exists (select 1 from public.ss_companies) then
    raise exception 'A company is already set up';
  end if;
  if not public.ss_setup_allowed(p_email) then
    raise exception 'This email is not allowed to set up the company';
  end if;
  if not public.ss_pin_is_acceptable(p_pin) then
    raise exception 'PIN must be 6 digits, not all the same and not a straight run like 123456';
  end if;

  insert into public.ss_companies (name) values (trim(p_company_name)) returning id into v_company;

  insert into public.ss_members (company_id, user_id, first_name, last_name, email, role)
  values (v_company, p_user, trim(p_first_name), coalesce(trim(p_last_name), ''), lower(trim(p_email)), 'owner')
  returning id into v_member;

  insert into public.ss_member_pins (member_id, company_id, pin_hash, set_by)
  values (v_member, v_company, public.ss_hash_pin(p_pin), v_member);

  insert into public.ss_teams (company_id, name, is_leadership, leader_member_id)
  values (v_company, 'Leadership Team', true, v_member) returning id into v_team;
  insert into public.ss_team_members (company_id, team_id, member_id, role)
  values (v_company, v_team, v_member, 'leader');

  insert into public.ss_meetings (company_id, team_id, title, meeting_type, cadence, owner_member_id, is_leadership)
  values (v_company, v_team, 'Leadership Weekly Meeting', 'weekly', 'weekly', v_member, true)
  returning id into v_meeting;
  insert into public.ss_meeting_invitees (company_id, meeting_id, member_id) values (v_company, v_meeting, v_member);

  -- Starting roster: everyone on the Leadership Team and invited to the Weekly Meeting.
  for v_person in
    select p.person from public.ss_private_settings s, jsonb_array_elements(s.value::jsonb) as p(person)
    where s.key = 'initial_members'
  loop
    continue when lower(v_person->>'email') = lower(trim(p_email));
    insert into public.ss_members (company_id, first_name, last_name, email, role)
    values (v_company, v_person->>'first_name', coalesce(v_person->>'last_name', ''),
            lower(v_person->>'email'), coalesce(v_person->>'role', 'leader'))
    returning id into v_other;
    insert into public.ss_team_members (company_id, team_id, member_id, role)
    values (v_company, v_team, v_other, 'member');
    insert into public.ss_meeting_invitees (company_id, meeting_id, member_id)
    values (v_company, v_meeting, v_other);
  end loop;

  insert into public.ss_agenda_items (company_id, meeting_id, sort_order, item_type, title, minutes, fill_time)
  values (v_company, v_meeting, 0, 'good_news',       'Good News',       5,  false),
         (v_company, v_meeting, 1, 'scorecard',   'Scorecard',   5,  false),
         (v_company, v_meeting, 2, 'goal_review', 'Goal review', 5,  false),
         (v_company, v_meeting, 3, 'headlines',   'Headlines',   5,  false),
         (v_company, v_meeting, 4, 'todo_list',   'To-Do list',  5,  false),
         (v_company, v_meeting, 5, 'discuss_solve',         'Discuss & Solve',         60, true),
         (v_company, v_meeting, 6, 'conclude',    'Conclude',    5,  false);

  insert into public.ss_scorecards (company_id, meeting_id) values (v_company, v_meeting);
  return v_company;
end $$;

revoke execute on function public.ss_setup_allowed(text) from public, anon, authenticated;
grant execute on function public.ss_setup_allowed(text) to service_role;
