-- Core tables (Goals, To-Dos, Issues, Headlines, Scorecard,
-- Weekly Meeting meetings, Vision & Plan, Org Chart).
--
-- Everything lives in `public` with an `ss_` prefix so it sits beside the
-- existing qbo_/qbt_/onestep_ tables without touching them.
--
-- Access model (see docs/data-model.md):
--   * Only members of the company can see anything; anon sees nothing.
--   * Every member can read and edit every item, except personal To-Dos,
--     which only their owner sees.
--   * Owners manage people and invitations, and are the only ones who can
--     permanently delete. Everyone else "deletes" to the recycle bin
--     (deleted_at), which anyone can restore.
--   * Status-like columns are text with CHECK constraints rather than enums,
--     so custom features can add values with a one-line change.

-- ─── Helpers ────────────────────────────────────────────────────────────────

create table public.ss_companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(trim(name)) > 0),
  time_zone               text not null default 'America/Denver',
  week_start_day          smallint not null default 1 check (week_start_day between 0 and 6), -- 0=Sunday
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  settings                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.ss_companies is
  'the company. Single-tenant: ss_create_company() refuses to make a second one.';

create table public.ss_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  first_name  text not null,
  last_name   text not null default '',
  email       text not null,
  job_title   text,
  role        text not null default 'leader' check (role in ('owner', 'leader', 'member')),
  status      text not null default 'active' check (status in ('active', 'removed')),
  avatar_path text,
  prefs       jsonb not null default '{}'::jsonb, -- dashboard layout, scorecard display, weekly digest
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, email),
  unique (company_id, user_id)
);
comment on table public.ss_members is
  'a person in the company. user_id links to their login once they accept an invitation.';

create table public.ss_invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  email       text not null,
  first_name  text not null,
  last_name   text not null default '',
  role        text not null default 'leader' check (role in ('owner', 'leader', 'member')),
  invited_by  uuid references public.ss_members(id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index ss_invitations_open_email
  on public.ss_invitations (company_id, lower(email))
  where accepted_at is null and revoked_at is null;
comment on table public.ss_invitations is
  'pending invitations. ss_accept_invitation() turns one into a member when that email signs in.';

-- Membership checks used by every policy. SECURITY DEFINER so policies on
-- ss_members can call them without recursing into themselves.
create function public.ss_my_member_id(p_company uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.ss_members m
  where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
$$;

create function public.ss_is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ss_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create function public.ss_is_owner(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ss_members m
    where m.company_id = p_company and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'owner'
  )
$$;

create function public.ss_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─── Teams and meetings ─────────────────────────────────────────────────────

create table public.ss_teams (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.ss_companies(id) on delete cascade,
  name             text not null,
  description      text,
  parent_team_id   uuid references public.ss_teams(id) on delete set null,
  leader_member_id uuid references public.ss_members(id) on delete set null,
  is_leadership    boolean not null default false,
  color            text,
  icon             text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.ss_team_members (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  team_id    uuid not null references public.ss_teams(id) on delete cascade,
  member_id  uuid not null references public.ss_members(id) on delete cascade,
  role       text not null default 'member' check (role in ('leader', 'member', 'observer')),
  created_at timestamptz not null default now(),
  unique (team_id, member_id)
);

-- A meeting series (a "meeting thread"). It is also the bucket
-- that Goals, To-Dos, Issues, Headlines and the Scorecard belong to.
create table public.ss_meetings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.ss_companies(id) on delete cascade,
  team_id          uuid references public.ss_teams(id) on delete set null,
  title            text not null,
  meeting_type     text not null default 'weekly'
                     check (meeting_type in ('weekly', 'alignment', 'quarterly', 'annual', 'custom')),
  cadence          text not null default 'weekly'
                     check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'as_needed')),
  first_meeting_at timestamptz,
  owner_member_id  uuid references public.ss_members(id) on delete set null,
  is_leadership    boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.ss_meeting_invitees (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id uuid not null references public.ss_meetings(id) on delete cascade,
  member_id  uuid not null references public.ss_members(id) on delete cascade,
  unique (meeting_id, member_id)
);

create table public.ss_agenda_items (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id uuid not null references public.ss_meetings(id) on delete cascade,
  sort_order integer not null,
  item_type  text not null check (item_type in
               ('good_news', 'check_in', 'scorecard', 'goal_review', 'headlines', 'todo_list', 'discuss_solve', 'conclude', 'custom')),
  title      text not null,
  minutes    integer not null default 5 check (minutes between 0 and 600),
  fill_time  boolean not null default false -- this section absorbs leftover time (Discuss & Solve)
);

-- One occurrence of a meeting: the live Weekly Meeting and, once ended, its history.
create table public.ss_meeting_sessions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id           uuid not null references public.ss_meetings(id) on delete cascade,
  status               text not null default 'running' check (status in ('running', 'ended')),
  current_agenda_index integer not null default 0,
  scribe_member_id     uuid references public.ss_members(id) on delete set null,
  send_recap           boolean not null default true,
  clear_done_items     boolean not null default true,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  summary              jsonb, -- frozen recap written at end: items, counts, average rating
  created_by           uuid references public.ss_members(id) on delete set null
);
create unique index ss_one_running_session_per_meeting
  on public.ss_meeting_sessions (meeting_id) where status = 'running';

create table public.ss_session_agenda (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.ss_companies(id) on delete cascade,
  session_id     uuid not null references public.ss_meeting_sessions(id) on delete cascade,
  sort_order     integer not null,
  item_type      text not null,
  title          text not null,
  minutes        integer not null,
  started_at     timestamptz,
  seconds_spent  integer not null default 0
);

create table public.ss_session_attendees (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  session_id uuid not null references public.ss_meeting_sessions(id) on delete cascade,
  member_id  uuid not null references public.ss_members(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  rating     smallint check (rating between 1 and 10),
  unique (session_id, member_id)
);

-- What happened to which item during a session (feeds the recap).
create table public.ss_session_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  session_id uuid not null references public.ss_meeting_sessions(id) on delete cascade,
  item_type  text not null check (item_type in ('goal', 'todo', 'issue', 'headline', 'measurable')),
  item_id    uuid not null,
  action     text not null check (action in ('added', 'discussed', 'solved', 'reviewed', 'done', 'dropped_to_issues')),
  member_id  uuid references public.ss_members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── Goals (SMART Goal planner) ─────────────────────────────────────────────

create table public.ss_goals (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id                uuid references public.ss_meetings(id) on delete set null,
  owner_member_id           uuid not null references public.ss_members(id),
  title                     text not null,               -- "Short title"
  description               text,                        -- "Describe the Goal"
  goal_type                 text not null default 'company' check (goal_type in ('company', 'department', 'personal')),
  is_live                   boolean not null default false, -- false = draft, not shown in meetings
  status                    text not null default 'on_track'
                              check (status in ('on_track', 'off_track', 'done', 'not_done', 'canceled')),
  quarter                   smallint check (quarter between 1 and 4),
  quarter_year              smallint,
  due_date                  date,
  reviewed_by_member_id     uuid references public.ss_members(id) on delete set null,
  reviewed_by_text          text,                        -- typed name when not a platform user
  smart_specific            text,                        -- What specifically will I achieve?
  smart_measurable          text,                        -- How will I measure completion?
  smart_actionable          text,                        -- Is it actionable by me or team now?
  smart_reviewable          text,                        -- Can progress be reviewed?
  smart_time_framed         text,                        -- What are key dates, what is final date?
  finish_line               text,                        -- Describe your finish line
  finish_line_due           date,
  finish_line_completed_on  date,
  completed_at              timestamptz,
  parent_goal_id            uuid references public.ss_goals(id) on delete set null, -- rolled down from a company Goal
  archived_at               timestamptz,
  deleted_at                timestamptz,
  created_by                uuid references public.ss_members(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table public.ss_goal_steps (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.ss_companies(id) on delete cascade,
  goal_id      uuid not null references public.ss_goals(id) on delete cascade,
  sort_order   integer not null,
  due_on       date,      -- "By (date)"
  activity     text not null default '',
  completed_on date,      -- "Date completed"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create function public.ss_limit_goal_steps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.ss_goal_steps where goal_id = new.goal_id) >= 20 then
    raise exception 'A Goal can have at most 20 next steps';
  end if;
  return new;
end $$;
create trigger ss_goal_steps_limit before insert on public.ss_goal_steps
  for each row execute function public.ss_limit_goal_steps();

create table public.ss_goal_resources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.ss_companies(id) on delete cascade,
  goal_id     uuid not null references public.ss_goals(id) on delete cascade,
  sort_order  integer not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── To-Dos, Issues, Headlines ──────────────────────────────────────────────

create table public.ss_todos (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id            uuid references public.ss_meetings(id) on delete set null,
  owner_member_id       uuid not null references public.ss_members(id),
  title                 text not null,
  description           text,
  due_date              date not null default (current_date + 7),
  status                text not null default 'open' check (status in ('open', 'done')),
  completed_at          timestamptz,
  is_personal           boolean not null default false,
  source_type           text check (source_type in ('issue', 'goal', 'headline', 'measurable')),
  source_id             uuid,
  created_in_session_id uuid references public.ss_meeting_sessions(id) on delete set null,
  archived_at           timestamptz, -- set when a meeting clears done items
  deleted_at            timestamptz,
  created_by            uuid references public.ss_members(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.ss_issues (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id            uuid references public.ss_meetings(id) on delete set null,
  owner_member_id       uuid references public.ss_members(id) on delete set null,
  title                 text not null,
  description           text,
  status                text not null default 'open' check (status in ('open', 'solved')),
  priority              smallint check (priority between 1 and 3), -- Discuss & Solve top 3
  sort_order            integer not null default 0,
  solved_at             timestamptz,
  source_type           text check (source_type in ('goal', 'headline', 'todo', 'measurable')),
  source_id             uuid,
  created_in_session_id uuid references public.ss_meeting_sessions(id) on delete set null,
  archived_at           timestamptz,
  deleted_at            timestamptz,
  created_by            uuid references public.ss_members(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.ss_headlines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id            uuid references public.ss_meetings(id) on delete set null,
  owner_member_id       uuid references public.ss_members(id) on delete set null,
  title                 text not null,
  description           text,
  kind                  text not null default 'general' check (kind in ('customer', 'employee', 'general')),
  status                text not null default 'to_review' check (status in ('to_review', 'reviewed')),
  cascaded_from_id      uuid references public.ss_headlines(id) on delete set null,
  archived_at           timestamptz,
  deleted_at            timestamptz,
  created_by            uuid references public.ss_members(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── Scorecard ──────────────────────────────────────────────────────────────

create table public.ss_scorecards (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.ss_companies(id) on delete cascade,
  meeting_id        uuid unique references public.ss_meetings(id) on delete cascade,
  title             text not null default 'Scorecard',
  period            text not null default 'week' check (period in ('week', 'month', 'quarter', 'year')),
  periods_to_show   smallint not null default 13 check (periods_to_show between 1 and 52),
  show_total        boolean not null default false,
  show_average      boolean not null default false,
  newest_first      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.ss_measurables (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.ss_companies(id) on delete cascade,
  scorecard_id     uuid not null references public.ss_scorecards(id) on delete cascade,
  owner_member_id  uuid references public.ss_members(id) on delete set null,
  title            text not null,
  description      text,
  unit             text not null default 'number' check (unit in ('number', 'dollar', 'percent', 'hours', 'days')),
  comparison       text not null default 'gte' check (comparison in ('gte', 'lte', 'eq', 'between')),
  goal_value       numeric,
  goal_value_upper numeric, -- only for 'between'
  decimals         smallint not null default 0 check (decimals between 0 and 4),
  period_override  text check (period_override in ('week', 'month', 'quarter', 'year')),
  is_additive      boolean not null default true, -- totals add up (false = average makes more sense)
  sort_order       integer not null default 0,
  archived_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.ss_measurable_values (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.ss_companies(id) on delete cascade,
  measurable_id uuid not null references public.ss_measurables(id) on delete cascade,
  period_start  date not null,
  value         numeric,
  goal_value    numeric,        -- goal at the time of entry, so changing a goal does not recolour history
  goal_value_upper numeric,
  comparison    text,
  note          text,
  entered_by    uuid references public.ss_members(id) on delete set null,
  entered_at    timestamptz not null default now(),
  unique (measurable_id, period_start)
);

-- On track / off track, computed rather than stored.
create view public.ss_measurable_values_status with (security_invoker = true) as
select v.*,
  case
    when v.value is null or v.goal_value is null then null
    when v.comparison = 'gte' then v.value >= v.goal_value
    when v.comparison = 'lte' then v.value <= v.goal_value
    when v.comparison = 'eq' then v.value = v.goal_value
    when v.comparison = 'between' then v.value between v.goal_value and coalesce(v.goal_value_upper, v.goal_value)
  end as is_on_track
from public.ss_measurable_values v;

-- Copy the measurable's current goal onto each new value.
create function public.ss_stamp_measurable_goal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    select m.goal_value, m.goal_value_upper, m.comparison
      into new.goal_value, new.goal_value_upper, new.comparison
      from public.ss_measurables m where m.id = new.measurable_id;
    new.entered_at := now();
  end if;
  return new;
end $$;
create trigger ss_measurable_values_goal before insert or update on public.ss_measurable_values
  for each row execute function public.ss_stamp_measurable_goal();

-- ─── Vision & Plan ───────────────────────────────────────────────────────────────────

create table public.ss_plan_versions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.ss_companies(id) on delete cascade,
  title                 text not null default 'Vision & Plan',
  status                text not null default 'draft' check (status in ('draft', 'official', 'archived')),
  purpose    text,   -- purpose / cause / passion
  niche      text,
  long_term_target       text,
  long_term_target_date  date,
  target_market         text,   -- "the list"
  how_we_work        text,
  guarantee             text,
  three_year_date       date,
  three_year_revenue    text,
  three_year_profit     text,
  one_year_date         date,
  one_year_revenue      text,
  one_year_profit       text,
  quarter_date          date,
  quarter_revenue       text,
  quarter_profit        text,
  published_at          timestamptz,
  created_by            uuid references public.ss_members(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index ss_one_official_plan
  on public.ss_plan_versions (company_id) where status = 'official';

-- Every list on the Vision & Plan is one table, told apart by section.
create table public.ss_plan_items (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.ss_companies(id) on delete cascade,
  version_id      uuid not null references public.ss_plan_versions(id) on delete cascade,
  section         text not null check (section in (
                    'value', 'differentiator', 'three_year_measurable', 'three_year_goal',
                    'one_year_measurable', 'one_year_goal', 'quarter_measurable',
                    'quarter_goal', 'long_term_issue')),
  sort_order      integer not null default 0,
  title           text not null default '',
  notes           text,
  value           text,     -- measurable target, kept as typed ("$4M")
  owner_member_id uuid references public.ss_members(id) on delete set null,
  linked_goal_id  uuid references public.ss_goals(id) on delete set null,
  linked_issue_id uuid references public.ss_issues(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Org Chart ───────────────────────────────────────────────────

create table public.ss_org_charts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.ss_companies(id) on delete cascade,
  title        text not null default 'Org Chart',
  status       text not null default 'draft' check (status in ('draft', 'official', 'archived')),
  published_at timestamptz,
  created_by   uuid references public.ss_members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index ss_one_official_chart
  on public.ss_org_charts (company_id) where status = 'official';

create table public.ss_positions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.ss_companies(id) on delete cascade,
  chart_id       uuid not null references public.ss_org_charts(id) on delete cascade,
  parent_position_id uuid references public.ss_positions(id) on delete cascade,
  title          text not null,
  position_role       text not null default 'none' check (position_role in ('vision_lead', 'operations_lead', 'none')),
  is_assistant   boolean not null default false,
  roles          text[] not null default '{}', -- the position's (usually five) responsibilities
  notes          text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.ss_position_holders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.ss_companies(id) on delete cascade,
  position_id          uuid not null references public.ss_positions(id) on delete cascade,
  member_id        uuid references public.ss_members(id) on delete cascade,
  placeholder_name text, -- an open position or someone without a login
  is_primary       boolean not null default true,
  check (member_id is not null or placeholder_name is not null)
);

-- ─── Attachments and history ────────────────────────────────────────────────

create table public.ss_attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.ss_companies(id) on delete cascade,
  item_type    text not null check (item_type in ('goal', 'todo', 'issue', 'headline', 'meeting')),
  item_id      uuid not null,
  storage_path text not null, -- {company_id}/{item_type}/{item_id}/{file}
  file_name    text not null,
  content_type text,
  size_bytes   bigint,
  uploaded_by  uuid references public.ss_members(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.ss_activity_log (
  id         bigint generated always as identity primary key,
  company_id uuid not null,
  table_name text not null,
  row_id     uuid not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  member_id  uuid,
  changed_at timestamptz not null default now(),
  old_row    jsonb,
  new_row    jsonb
);
create index ss_activity_log_row on public.ss_activity_log (table_name, row_id, changed_at desc);
comment on table public.ss_activity_log is
  'who changed what and when. Written only by triggers; read-only to members.';

create function public.ss_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.ss_activity_log (company_id, table_name, row_id, action, member_id, old_row, new_row)
  values (
    (r->>'company_id')::uuid, tg_table_name, (r->>'id')::uuid, lower(tg_op),
    public.ss_my_member_id((r->>'company_id')::uuid),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- ─── Indexes on foreign keys and common filters ─────────────────────────────

create index on public.ss_members (user_id);
create index on public.ss_teams (company_id);
create index on public.ss_team_members (member_id);
create index on public.ss_meetings (company_id);
create index on public.ss_meeting_invitees (member_id);
create index on public.ss_agenda_items (meeting_id, sort_order);
create index on public.ss_meeting_sessions (meeting_id, started_at desc);
create index on public.ss_session_agenda (session_id, sort_order);
create index on public.ss_session_attendees (member_id);
create index on public.ss_session_events (session_id);
create index on public.ss_goals (company_id, quarter_year, quarter);
create index on public.ss_goals (meeting_id);
create index on public.ss_goals (owner_member_id);
create index on public.ss_goal_steps (goal_id, sort_order);
create index on public.ss_goal_resources (goal_id, sort_order);
create index on public.ss_todos (meeting_id, status);
create index on public.ss_todos (owner_member_id, status);
create index on public.ss_issues (meeting_id, status);
create index on public.ss_issues (owner_member_id);
create index on public.ss_headlines (meeting_id, status);
create index on public.ss_measurables (scorecard_id, sort_order);
create index on public.ss_measurable_values (measurable_id, period_start desc);
create index on public.ss_plan_items (version_id, section, sort_order);
create index on public.ss_positions (chart_id, parent_position_id);
create index on public.ss_position_holders (position_id);
create index on public.ss_attachments (item_type, item_id);

-- ─── Triggers, grants and row-level security for every ss_ table ───────────

do $$
declare
  t text;
  member_tables text[] := array[
    'ss_teams', 'ss_team_members', 'ss_meetings', 'ss_meeting_invitees', 'ss_agenda_items',
    'ss_meeting_sessions', 'ss_session_agenda', 'ss_session_attendees', 'ss_session_events',
    'ss_goals', 'ss_goal_steps', 'ss_goal_resources', 'ss_issues', 'ss_headlines',
    'ss_scorecards', 'ss_measurables', 'ss_measurable_values',
    'ss_plan_versions', 'ss_plan_items', 'ss_org_charts', 'ss_positions', 'ss_position_holders',
    'ss_attachments'];
  logged_tables text[] := array[
    'ss_goals', 'ss_goal_steps', 'ss_goal_resources', 'ss_todos', 'ss_issues', 'ss_headlines',
    'ss_measurables', 'ss_measurable_values', 'ss_plan_versions', 'ss_plan_items',
    'ss_positions', 'ss_position_holders', 'ss_meetings', 'ss_agenda_items', 'ss_members'];
begin
  -- Every ss_ table: RLS on, no access for anon.
  foreach t in array member_tables || array['ss_companies', 'ss_members', 'ss_invitations', 'ss_todos', 'ss_activity_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- Members can read and change everything; only owners hard-delete.
  foreach t in array member_tables loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.ss_is_member(company_id))', t);
    execute format('create policy "members add" on public.%I for insert to authenticated with check (public.ss_is_member(company_id))', t);
    execute format('create policy "members edit" on public.%I for update to authenticated using (public.ss_is_member(company_id)) with check (public.ss_is_member(company_id))', t);
    execute format('create policy "owners delete" on public.%I for delete to authenticated using (public.ss_is_owner(company_id))', t);
  end loop;

  foreach t in array logged_tables loop
    execute format('create trigger ss_log after insert or update or delete on public.%I for each row execute function public.ss_log_change()', t);
  end loop;

  foreach t in array array['ss_companies', 'ss_members', 'ss_teams', 'ss_meetings', 'ss_goals', 'ss_goal_steps',
                           'ss_goal_resources', 'ss_todos', 'ss_issues', 'ss_headlines', 'ss_scorecards',
                           'ss_measurables', 'ss_plan_versions', 'ss_plan_items', 'ss_org_charts', 'ss_positions'] loop
    execute format('create trigger ss_touch before update on public.%I for each row execute function public.ss_touch_updated_at()', t);
  end loop;
end $$;

-- To-Dos: personal ones are visible only to their owner.
create policy "members read" on public.ss_todos for select to authenticated
  using (public.ss_is_member(company_id)
         and (not is_personal or owner_member_id = public.ss_my_member_id(company_id)));
create policy "members add" on public.ss_todos for insert to authenticated
  with check (public.ss_is_member(company_id)
              and (not is_personal or owner_member_id = public.ss_my_member_id(company_id)));
create policy "members edit" on public.ss_todos for update to authenticated
  using (public.ss_is_member(company_id)
         and (not is_personal or owner_member_id = public.ss_my_member_id(company_id)))
  with check (public.ss_is_member(company_id)
              and (not is_personal or owner_member_id = public.ss_my_member_id(company_id)));
create policy "owners delete" on public.ss_todos for delete to authenticated
  using (public.ss_is_owner(company_id));

-- Company: members read; owners edit. Created only through ss_create_company().
create policy "members read" on public.ss_companies for select to authenticated
  using (public.ss_is_member(id));
create policy "owners edit" on public.ss_companies for update to authenticated
  using (public.ss_is_owner(id)) with check (public.ss_is_owner(id));

-- Members: everyone sees the roster; you edit your own profile, owners edit anyone.
-- Role and status changes are owner-only (enforced by ss_guard_member_change).
create policy "members read" on public.ss_members for select to authenticated
  using (public.ss_is_member(company_id));
create policy "self or owner edit" on public.ss_members for update to authenticated
  using (user_id = auth.uid() or public.ss_is_owner(company_id))
  with check (user_id = auth.uid() or public.ss_is_owner(company_id));
create policy "owners add" on public.ss_members for insert to authenticated
  with check (public.ss_is_owner(company_id));

create function public.ss_guard_member_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.role, new.status, new.user_id, new.company_id) is distinct from (old.role, old.status, old.user_id, old.company_id)
     and not public.ss_is_owner(old.company_id)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Only an owner can change roles, remove people or relink logins';
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active')
     and (select count(*) from public.ss_members
          where company_id = old.company_id and role = 'owner' and status = 'active') = 1 then
    raise exception 'The company needs at least one owner';
  end if;
  return new;
end $$;
create trigger ss_members_guard before update on public.ss_members
  for each row execute function public.ss_guard_member_change();

-- Invitations: owners manage them; members can see who is pending.
create policy "members read" on public.ss_invitations for select to authenticated
  using (public.ss_is_member(company_id));
create policy "owners add" on public.ss_invitations for insert to authenticated
  with check (public.ss_is_owner(company_id));
create policy "owners edit" on public.ss_invitations for update to authenticated
  using (public.ss_is_owner(company_id)) with check (public.ss_is_owner(company_id));
create policy "owners delete" on public.ss_invitations for delete to authenticated
  using (public.ss_is_owner(company_id));

-- Activity log: read-only to members (written by trigger as definer).
create policy "members read" on public.ss_activity_log for select to authenticated
  using (public.ss_is_member(company_id));
revoke insert, update, delete on public.ss_activity_log from authenticated;

-- ─── Set-up and invitation functions ────────────────────────────────────────

-- First sign-in: create the company, make the caller its owner, and seed a
-- Leadership team with a Weekly Meeting, standard agenda and empty Scorecard.
create function public.ss_create_company(p_name text, p_first_name text, p_last_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_member  uuid;
  v_team    uuid;
  v_meeting uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from public.ss_companies) then
    raise exception 'A company is already set up. Ask its owner for an invitation.';
  end if;

  insert into public.ss_companies (name) values (trim(p_name)) returning id into v_company;

  insert into public.ss_members (company_id, user_id, first_name, last_name, email, role)
  values (v_company, auth.uid(), trim(p_first_name), coalesce(trim(p_last_name), ''),
          lower(coalesce(auth.jwt()->>'email', '')), 'owner')
  returning id into v_member;

  insert into public.ss_teams (company_id, name, is_leadership, leader_member_id)
  values (v_company, 'Leadership Team', true, v_member) returning id into v_team;
  insert into public.ss_team_members (company_id, team_id, member_id, role)
  values (v_company, v_team, v_member, 'leader');

  insert into public.ss_meetings (company_id, team_id, title, meeting_type, cadence, owner_member_id, is_leadership)
  values (v_company, v_team, 'Leadership Weekly Meeting', 'weekly', 'weekly', v_member, true)
  returning id into v_meeting;
  insert into public.ss_meeting_invitees (company_id, meeting_id, member_id) values (v_company, v_meeting, v_member);

  insert into public.ss_agenda_items (company_id, meeting_id, sort_order, item_type, title, minutes, fill_time)
  values (v_company, v_meeting, 0, 'good_news',      'Good News',       5,  false),
         (v_company, v_meeting, 1, 'scorecard',  'Scorecard',   5,  false),
         (v_company, v_meeting, 2, 'goal_review','Goal review', 5,  false),
         (v_company, v_meeting, 3, 'headlines',  'Headlines',   5,  false),
         (v_company, v_meeting, 4, 'todo_list',  'To-Do list',  5,  false),
         (v_company, v_meeting, 5, 'discuss_solve',        'Discuss & Solve',         60, true),
         (v_company, v_meeting, 6, 'conclude',   'Conclude',    5,  false);

  insert into public.ss_scorecards (company_id, meeting_id) values (v_company, v_meeting);
  return v_company;
end $$;

-- Called after every sign-in: if this email has an open invitation, join.
create function public.ss_accept_invitation()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_inv   public.ss_invitations;
  v_member uuid;
begin
  if auth.uid() is null or v_email = '' then
    return null;
  end if;
  select * into v_inv from public.ss_invitations
   where lower(email) = v_email and accepted_at is null and revoked_at is null
   order by created_at desc limit 1;
  if not found then
    return null;
  end if;

  insert into public.ss_members (company_id, user_id, first_name, last_name, email, role)
  values (v_inv.company_id, auth.uid(), v_inv.first_name, v_inv.last_name, v_email, v_inv.role)
  on conflict (company_id, email) do update
    set user_id = excluded.user_id, status = 'active'
  returning id into v_member;

  update public.ss_invitations set accepted_at = now() where id = v_inv.id;
  return v_member;
end $$;

revoke execute on function public.ss_create_company(text, text, text) from public, anon;
revoke execute on function public.ss_accept_invitation() from public, anon;
grant execute on function public.ss_create_company(text, text, text) to authenticated;
grant execute on function public.ss_accept_invitation() to authenticated;
revoke execute on function public.ss_my_member_id(uuid) from public, anon;
revoke execute on function public.ss_is_member(uuid) from public, anon;
revoke execute on function public.ss_is_owner(uuid) from public, anon;
grant execute on function public.ss_my_member_id(uuid), public.ss_is_member(uuid), public.ss_is_owner(uuid) to authenticated;
revoke execute on function public.ss_log_change() from public, anon, authenticated;

-- ─── File storage for attachments ───────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('ss-attachments', 'ss-attachments', false, 26214400)
on conflict (id) do nothing;

-- Paths are {company_id}/...; other buckets, and paths that do not start with
-- a uuid, are refused instead of raising a cast error.
create function public.ss_can_access_file(p_bucket text, p_name text, p_owner_only boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  if p_bucket <> 'ss-attachments' then
    return false;
  end if;
  begin
    v_company := (split_part(p_name, '/', 1))::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return case when p_owner_only then public.ss_is_owner(v_company) else public.ss_is_member(v_company) end;
end $$;
revoke execute on function public.ss_can_access_file(text, text, boolean) from public, anon;
grant execute on function public.ss_can_access_file(text, text, boolean) to authenticated;

create policy "members read files" on storage.objects for select to authenticated
  using (public.ss_can_access_file(bucket_id, name, false));
create policy "members upload files" on storage.objects for insert to authenticated
  with check (public.ss_can_access_file(bucket_id, name, false));
create policy "owners delete files" on storage.objects for delete to authenticated
  using (public.ss_can_access_file(bucket_id, name, true));

-- ─── Live updates for the Weekly Meeting screen ────────────────────────────────

alter publication supabase_realtime add table
  public.ss_meeting_sessions, public.ss_session_attendees, public.ss_session_agenda,
  public.ss_session_events, public.ss_todos, public.ss_issues, public.ss_headlines,
  public.ss_goals, public.ss_measurable_values;
