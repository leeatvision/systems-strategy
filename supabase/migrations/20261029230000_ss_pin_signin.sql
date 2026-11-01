-- Sign in with a PIN instead of email codes.
--
-- How sign-in works:
--   * The owner adds a person (ss_members) and gives them a 6-digit PIN
--     (ss_set_member_pin). Only a scrambled copy of the PIN is stored.
--   * The person enters their email and PIN. The pin-auth edge function
--     checks it with ss_verify_pin and hands back a normal Supabase session.
--     No email is ever sent.
--   * Five wrong PINs for an email lock it for 15 minutes.
--   * The very first set-up (company name + owner) is allowed only once, and
--     only for the owner email stored in ss_private_settings.
--
-- Replaces the email-invitation flow from 20261029220000_ss_core.sql (those
-- tables were empty).

drop function public.ss_accept_invitation();
drop function public.ss_create_company(text, text, text);
drop table public.ss_invitations;

comment on table public.ss_companies is
  'the company. Single-tenant: ss_bootstrap_company() refuses to make a second one.';
comment on table public.ss_members is
  'a person in the company. user_id links to their login the first time they sign in with their PIN.';
comment on table public.ss_activity_log is
  'who changed what and when. Written only by triggers; read-only to members.';

-- Server-only settings (for example the owner email allowed to run first-time set-up).
create table public.ss_private_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table public.ss_private_settings is
  'server-only settings. No access from the app; read only by ss_ functions.';

create table public.ss_member_pins (
  member_id  uuid primary key references public.ss_members(id) on delete cascade,
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  pin_hash   text not null,
  set_by     uuid references public.ss_members(id) on delete set null,
  set_at     timestamptz not null default now()
);
comment on table public.ss_member_pins is
  'scrambled (bcrypt) sign-in PINs. No access from the app; checked only by ss_verify_pin.';

create table public.ss_pin_failures (
  id           bigint generated always as identity primary key,
  email        text not null,
  attempted_at timestamptz not null default now()
);
create index ss_pin_failures_email on public.ss_pin_failures (email, attempted_at desc);
comment on table public.ss_pin_failures is
  'wrong-PIN attempts, used to lock an email for 15 minutes after 5 failures. Safe to clear.';

do $$
declare t text;
begin
  foreach t in array array['ss_private_settings', 'ss_member_pins', 'ss_pin_failures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 6 digits, not all the same and not a straight run (123456, 654321).
create function public.ss_pin_is_acceptable(p_pin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_pin ~ '^[0-9]{6}$'
     and p_pin !~ '^(.)\1{5}$'
     and p_pin not in ('012345', '123456', '234567', '345678', '456789',
                       '987654', '876543', '765432', '654321', '543210')
$$;

create function public.ss_hash_pin(p_pin text)
returns text language sql volatile set search_path = '' as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
$$;

-- Owners set anyone's PIN; everyone can change their own.
create function public.ss_set_member_pin(p_member uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_caller  uuid;
begin
  select company_id into v_company from public.ss_members where id = p_member and status = 'active';
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
end $$;

-- Whether people have a PIN yet (for the People screen), without exposing the PIN.
create function public.ss_members_with_pin(p_company uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.member_id from public.ss_member_pins p
  where p.company_id = p_company and public.ss_is_member(p_company)
$$;

-- Server only (pin-auth edge function): check email + PIN, with lockout.
create function public.ss_verify_pin(p_email text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(trim(p_email));
  v_member uuid;
  v_hash   text;
begin
  if (select count(*) from public.ss_pin_failures
      where email = v_email and attempted_at > now() - interval '15 minutes') >= 5 then
    raise exception 'locked' using hint = 'Too many wrong PINs. Try again in 15 minutes.';
  end if;

  select m.id, p.pin_hash into v_member, v_hash
    from public.ss_members m
    join public.ss_member_pins p on p.member_id = m.id
   where lower(m.email) = v_email and m.status = 'active';

  if v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.ss_pin_failures (email) values (v_email);
    return null;
  end if;

  delete from public.ss_pin_failures where email = v_email;
  return v_member;
end $$;

-- Server only: link a member to their login the first time they sign in.
create function public.ss_link_member_login(p_member uuid, p_user uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ss_members set user_id = p_user where id = p_member
$$;

-- Server only: find an existing login by email.
create function public.ss_auth_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;

-- Anyone: does the app still need first-time set-up? (Reveals nothing else.)
create function public.ss_setup_needed()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.ss_companies)
$$;

-- Server only: first-time set-up. Creates the company, its owner (with PIN),
-- a Leadership Team, a weekly Leadership Weekly Meeting with the standard agenda and an
-- empty Scorecard.
create function public.ss_bootstrap_company(
  p_user uuid, p_email text, p_company_name text, p_first_name text, p_last_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_member  uuid;
  v_team    uuid;
  v_meeting uuid;
  v_allowed text;
begin
  if exists (select 1 from public.ss_companies) then
    raise exception 'A company is already set up';
  end if;
  select value into v_allowed from public.ss_private_settings where key = 'bootstrap_owner_email';
  if v_allowed is null or lower(trim(p_email)) <> lower(v_allowed) then
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

-- Who may call what.
revoke execute on function public.ss_pin_is_acceptable(text) from public, anon;
revoke execute on function public.ss_hash_pin(text) from public, anon, authenticated;
revoke execute on function public.ss_set_member_pin(uuid, text) from public, anon;
revoke execute on function public.ss_members_with_pin(uuid) from public, anon;
revoke execute on function public.ss_verify_pin(text, text) from public, anon, authenticated;
revoke execute on function public.ss_link_member_login(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ss_auth_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.ss_bootstrap_company(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.ss_setup_needed() from public;

grant execute on function public.ss_pin_is_acceptable(text) to authenticated;
grant execute on function public.ss_set_member_pin(uuid, text) to authenticated;
grant execute on function public.ss_members_with_pin(uuid) to authenticated;
grant execute on function public.ss_setup_needed() to anon, authenticated;
grant execute on function public.ss_verify_pin(text, text),
                          public.ss_link_member_login(uuid, uuid),
                          public.ss_auth_user_id_by_email(text),
                          public.ss_bootstrap_company(uuid, text, text, text, text, text),
                          public.ss_hash_pin(text)
  to service_role;
