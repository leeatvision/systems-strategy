-- Reminders: owners set them up for anyone; each is filled with the person's own items when it goes out.
-- Kinds: Key Numbers to Enter, To-Dos Due, Goal Check-In, Meeting Coming Up, Custom Message.

create table public.ss_reminders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  kind        text not null check (kind in ('key_numbers', 'todos_due', 'goal_check_in', 'meeting_coming_up', 'custom')),
  message     text check (char_length(message) <= 500),
  everyone    boolean not null default true,
  member_ids  uuid[] not null default '{}',
  timing      text not null default 'before_meeting' check (timing in ('before_meeting', 'weekly')),
  meeting_id  uuid references public.ss_meetings(id) on delete cascade,
  days_before smallint not null default 1 check (days_before between 0 and 6),
  weekdays    smallint[] not null default '{1}',
  at_time     time not null default '08:00' check (at_time <= '21:45'),
  enabled     boolean not null default true,
  created_by  uuid references public.ss_members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'custom' or coalesce(trim(message), '') <> ''),
  check (timing <> 'before_meeting' or meeting_id is not null)
);
create index on public.ss_reminders (company_id);

-- One row per reminder, person and day it went out, so nothing is sent twice.
create table public.ss_reminder_sends (
  reminder_id uuid not null references public.ss_reminders(id) on delete cascade,
  member_id   uuid not null references public.ss_members(id) on delete cascade,
  sent_on     date not null,
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  notified    boolean not null default false,
  primary key (reminder_id, member_id, sent_on)
);

alter table public.ss_reminders enable row level security;
alter table public.ss_reminder_sends enable row level security;
revoke all on public.ss_reminders, public.ss_reminder_sends from anon;
revoke insert, update, delete on public.ss_reminder_sends from authenticated;
create policy "members read" on public.ss_reminders for select to authenticated using (public.ss_is_member(company_id));
create policy "owners add" on public.ss_reminders for insert to authenticated with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_reminders for update to authenticated using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));
create policy "owners delete" on public.ss_reminders for delete to authenticated using (public.ss_is_owner(company_id));
create policy "members read" on public.ss_reminder_sends for select to authenticated using (public.ss_is_member(company_id));
create trigger ss_touch before update on public.ss_reminders for each row execute function public.ss_touch_updated_at();

-- Notifications can carry their own heading (a reminder's kind).
alter table public.ss_notifications add column if not exists title text;

-- The meeting's next date (in the company's time zone) on or after a day; null if it doesn't repeat and has passed.
create or replace function public.ss_next_meeting_day(p_meeting uuid, p_from date, p_tz text)
returns date language sql stable set search_path = '' as $$
  select case
    when m.first_meeting_at is null then null
    when (m.first_meeting_at at time zone p_tz)::date >= p_from then (m.first_meeting_at at time zone p_tz)::date
    when m.cadence not in ('weekly', 'biweekly') then null
    else (m.first_meeting_at at time zone p_tz)::date
         + (case m.cadence when 'weekly' then 7 else 14 end)
         * ceil((p_from - (m.first_meeting_at at time zone p_tz)::date)::numeric / (case m.cadence when 'weekly' then 7 else 14 end))::int
  end
  from public.ss_meetings m where m.id = p_meeting and m.deleted_at is null
$$;

-- "A, B, C and 2 more"
create or replace function public.ss_name_list(p_names text[], p_max int default 4)
returns text language sql immutable set search_path = '' as $$
  select case when coalesce(array_length(p_names, 1), 0) = 0 then null
    when array_length(p_names, 1) <= p_max then array_to_string(p_names, ', ')
    else array_to_string(p_names[1:p_max], ', ') || ' and ' || (array_length(p_names, 1) - p_max) || ' more' end
$$;

-- The text of one reminder for one person, from their real items; null when there's nothing to say.
create or replace function public.ss_reminder_text(p_kind text, p_member uuid, p_meeting uuid, p_message text,
  p_day date, p_tz text, p_show_personal boolean default true)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid; v_meeting uuid := p_meeting; v_day date; v_week date; v_title text; v_time text;
  a text[]; b text[]; v_open int; v_text text;
begin
  select company_id into v_company from public.ss_members where id = p_member;
  if p_kind in ('key_numbers', 'meeting_coming_up') and v_meeting is null then
    select meeting_id into v_meeting from public.ss_scorecards where company_id = v_company and meeting_id is not null order by created_at limit 1;
  end if;
  if v_meeting is not null then
    v_day := public.ss_next_meeting_day(v_meeting, p_day, p_tz);
    select title, to_char((first_meeting_at at time zone p_tz)::time, 'FMHH12:MI AM') into v_title, v_time from public.ss_meetings where id = v_meeting;
  end if;

  if p_kind = 'key_numbers' then
    if v_day is null then return null; end if;
    v_week := v_day - extract(dow from v_day)::int;
    select array_agg(m.title order by m.sort_order, m.title) into a
      from public.ss_measurables m join public.ss_scorecards s on s.id = m.scorecard_id
      where m.owner_member_id = p_member and m.deleted_at is null and m.archived_at is null
        and coalesce(m.period_override, s.period) = 'week'
        and not exists (select 1 from public.ss_measurable_values v where v.measurable_id = m.id and v.period_start = v_week);
    if a is null then return null; end if;
    v_text := 'Still to enter for the ' || to_char(v_day, 'FMMon FMDD') || ' meeting: ' || public.ss_name_list(a, 6) || '.';

  elsif p_kind = 'todos_due' then
    select array_agg(title || ' (' || to_char(due_date, 'FMMon FMDD') || ')' order by due_date) filter (where due_date < p_day),
           array_agg(title || ' (' || to_char(due_date, 'Dy') || ')' order by due_date) filter (where due_date >= p_day)
      into a, b
      from public.ss_todos
      where owner_member_id = p_member and status = 'open' and deleted_at is null and archived_at is null
        and due_date <= p_day + 7 and (p_show_personal or not is_personal);
    if a is null and b is null then return null; end if;
    v_text := concat_ws(' ', 'Overdue: ' || public.ss_name_list(a) || '.', 'Due this week: ' || public.ss_name_list(b) || '.');

  elsif p_kind = 'goal_check_in' then
    select count(*), array_agg(title order by due_date) filter (where status = 'off_track') into v_open, a
      from public.ss_goals where owner_member_id = p_member and status in ('on_track', 'off_track') and deleted_at is null;
    if v_open = 0 then return null; end if;
    select array_agg(s.activity || ' (' || to_char(s.due_on, 'FMMon FMDD') || ')' order by s.due_on) into b
      from public.ss_goal_steps s join public.ss_goals g on g.id = s.goal_id
      where g.owner_member_id = p_member and g.status in ('on_track', 'off_track') and g.deleted_at is null
        and s.completed_on is null and s.due_on <= p_day + 7 and coalesce(trim(s.activity), '') <> '';
    v_text := concat_ws(' ', v_open || ' open Goal' || case when v_open = 1 then '' else 's' end || '.',
      'Off track: ' || public.ss_name_list(a) || '.', 'Steps due or late: ' || public.ss_name_list(b) || '.');

  elsif p_kind = 'meeting_coming_up' then
    if v_day is null then return null; end if;
    select count(*), array_agg(title order by priority nulls last, sort_order, created_at) into v_open, a
      from public.ss_issues where meeting_id = v_meeting and status = 'open' and deleted_at is null and archived_at is null;
    v_text := v_title || ' · ' || to_char(v_day, 'FMDay, FMMon FMDD') || ' at ' || v_time || '.'
      || case when v_open > 0 then ' ' || v_open || ' open Issue' || case when v_open = 1 then '' else 's' end
         || ', starting with ' || public.ss_name_list(a[1:3], 3) || '.' else '' end;

  elsif p_kind = 'custom' then
    return left(trim(p_message), 500);
  end if;

  if coalesce(trim(p_message), '') <> '' then v_text := trim(p_message) || E'\n' || v_text; end if;
  return left(v_text, 500);
end $$;

-- What a reminder would say to someone today (for owners setting one up). Personal To-Dos stay private.
create or replace function public.ss_reminder_preview(p_kind text, p_member uuid, p_meeting uuid, p_message text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid; v_tz text;
begin
  select m.company_id, c.time_zone into v_company, v_tz from public.ss_members m join public.ss_companies c on c.id = m.company_id where m.id = p_member;
  if v_company is null or not public.ss_is_owner(v_company) then raise exception 'Only owners can preview reminders'; end if;
  return public.ss_reminder_text(p_kind, p_member, p_meeting, p_message, (now() at time zone v_tz)::date, v_tz,
    p_member = public.ss_my_member_id(v_company));
end $$;

-- Runs every 15 minutes: sends each reminder that's due (within 2 hours of its time) once per person per day.
create or replace function public.ss_send_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; p record; v_now timestamp; v_day date; v_text text; v_meeting uuid; n int := 0;
begin
  for r in
    select x.*, c.time_zone tz from public.ss_reminders x join public.ss_companies c on c.id = x.company_id where x.enabled
  loop
    v_now := now() at time zone r.tz;
    v_day := v_now::date;
    continue when v_now < v_day + r.at_time or v_now >= v_day + r.at_time + interval '2 hours';
    if r.timing = 'weekly' then
      continue when not (extract(dow from v_day)::smallint = any(r.weekdays));
    else
      continue when public.ss_next_meeting_day(r.meeting_id, v_day + r.days_before, r.tz) is distinct from v_day + r.days_before;
    end if;
    v_meeting := coalesce(r.meeting_id, (select s.meeting_id from public.ss_scorecards s where s.company_id = r.company_id and s.meeting_id is not null order by s.created_at limit 1));
    for p in
      select m.id from public.ss_members m
      where m.company_id = r.company_id and m.status = 'active' and m.user_id is not null and (r.everyone or m.id = any(r.member_ids))
    loop
      continue when exists (select 1 from public.ss_reminder_sends s where s.reminder_id = r.id and s.member_id = p.id and s.sent_on = v_day);
      v_text := public.ss_reminder_text(r.kind, p.id, v_meeting, r.message, v_day, r.tz);
      insert into public.ss_reminder_sends (reminder_id, member_id, sent_on, company_id, notified) values (r.id, p.id, v_day, r.company_id, v_text is not null);
      continue when v_text is null;
      insert into public.ss_notifications (company_id, recipient_id, kind, item_type, item_id, title, summary)
      values (r.company_id, p.id, 'reminder',
        case r.kind when 'key_numbers' then 'key_numbers' when 'todos_due' then 'todo_list' when 'goal_check_in' then 'goals'
          when 'meeting_coming_up' then 'meeting' else 'reminder' end,
        case when r.kind = 'meeting_coming_up' and v_meeting is not null then v_meeting when r.kind = 'todos_due' then p.id else r.id end,
        case r.kind when 'key_numbers' then 'Key Numbers to Enter' when 'todos_due' then 'To-Dos Due' when 'goal_check_in' then 'Goal Check-In'
          when 'meeting_coming_up' then 'Meeting Coming Up' else 'Reminder' end,
        v_text);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

revoke all on function public.ss_send_reminders(), public.ss_reminder_text(text, uuid, uuid, text, date, text, boolean) from public, anon, authenticated;
revoke all on function public.ss_reminder_preview(text, uuid, uuid, text) from public, anon;
grant execute on function public.ss_reminder_preview(text, uuid, uuid, text) to authenticated;

select cron.schedule('ss-reminders', '*/15 * * * *', 'select public.ss_send_reminders()');
