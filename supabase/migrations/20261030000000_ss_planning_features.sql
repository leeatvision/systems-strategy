-- Planning features.
--   * To-Do scheduling: a "do on" date and optional time block, separate from
--     the due date, for board and calendar views.
--   * Repeating To-Dos: the next one is created when the current one is done.
--   * Checklists inside To-Dos.
--   * Comments with @mentions on Goals, To-Dos, Issues and Headlines, and an
--     in-app notification list (nothing is emailed).
--   * Private calendar-feed token per person (read-only .ics subscription).

alter table public.ss_todos
  add column scheduled_on     date,
  add column scheduled_time   time,
  add column duration_minutes integer check (duration_minutes between 5 and 1440),
  add column priority         text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  add column sort_order       integer not null default 0,
  add column repeat_rule      text check (repeat_rule in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly')),
  add column repeat_parent_id uuid references public.ss_todos(id) on delete set null;

create index on public.ss_todos (owner_member_id, scheduled_on);

-- When a repeating To-Do is ticked done, create the next one (once).
create function public.ss_repeat_todo()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_step interval;
  v_next date;
begin
  if new.repeat_rule is null or new.status <> 'done' or old.status = 'done' or new.deleted_at is not null then
    return new;
  end if;
  v_step := case new.repeat_rule
    when 'daily' then interval '1 day' when 'weekdays' then interval '1 day'
    when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days'
    when 'monthly' then interval '1 month' end;
  v_next := (new.due_date + v_step)::date;
  if new.repeat_rule = 'weekdays' then
    while extract(isodow from v_next) > 5 loop v_next := v_next + 1; end loop;
  end if;
  if exists (select 1 from public.ss_todos where repeat_parent_id = new.id) then
    return new;
  end if;
  insert into public.ss_todos (company_id, meeting_id, owner_member_id, title, description, due_date, is_personal,
                                scheduled_on, scheduled_time, duration_minutes, priority, repeat_rule, repeat_parent_id, created_by)
  values (new.company_id, new.meeting_id, new.owner_member_id, new.title, new.description, v_next, new.is_personal,
          case when new.scheduled_on is not null then v_next end, new.scheduled_time, new.duration_minutes,
          new.priority, new.repeat_rule, new.id, new.created_by);
  return new;
end $$;
create trigger ss_todos_repeat after update of status on public.ss_todos
  for each row execute function public.ss_repeat_todo();

create table public.ss_todo_checklist (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  todo_id    uuid not null references public.ss_todos(id) on delete cascade,
  sort_order integer not null default 0,
  title      text not null,
  is_done    boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.ss_todo_checklist (todo_id, sort_order);

create table public.ss_comments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  item_type  text not null check (item_type in ('goal', 'todo', 'issue', 'headline')),
  item_id    uuid not null,
  author_id  uuid not null references public.ss_members(id),
  body       text not null check (length(trim(body)) > 0),
  mentions   uuid[] not null default '{}', -- member ids
  edited_at  timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.ss_comments (item_type, item_id, created_at);

create table public.ss_notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.ss_companies(id) on delete cascade,
  recipient_id uuid not null references public.ss_members(id) on delete cascade,
  kind         text not null check (kind in ('mention', 'assigned', 'comment')),
  item_type    text not null,
  item_id      uuid not null,
  actor_id     uuid references public.ss_members(id) on delete set null,
  summary      text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.ss_notifications (recipient_id, read_at, created_at desc);

-- A mention in a comment notifies that person (not the author).
create function public.ss_notify_mentions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ss_notifications (company_id, recipient_id, kind, item_type, item_id, actor_id, summary)
  select new.company_id, m, 'mention', new.item_type, new.item_id, new.author_id, left(new.body, 200)
  from unnest(new.mentions) as m
  where m <> new.author_id
    and exists (select 1 from public.ss_members x where x.id = m and x.company_id = new.company_id);
  return new;
end $$;
create trigger ss_comments_mentions after insert on public.ss_comments
  for each row execute function public.ss_notify_mentions();
revoke execute on function public.ss_notify_mentions() from public, anon, authenticated;

-- Assigning a To-Do to someone else notifies them.
create function public.ss_notify_todo_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.ss_my_member_id(new.company_id);
begin
  if (tg_op = 'INSERT' or new.owner_member_id is distinct from old.owner_member_id)
     and v_actor is not null and new.owner_member_id <> v_actor then
    insert into public.ss_notifications (company_id, recipient_id, kind, item_type, item_id, actor_id, summary)
    values (new.company_id, new.owner_member_id, 'assigned', 'todo', new.id, v_actor, left(new.title, 200));
  end if;
  return new;
end $$;
create trigger ss_todos_notify after insert or update of owner_member_id on public.ss_todos
  for each row execute function public.ss_notify_todo_assignment();
revoke execute on function public.ss_notify_todo_assignment() from public, anon, authenticated;

-- Private token for the read-only calendar feed (one per person, revocable).
create table public.ss_calendar_feeds (
  member_id  uuid primary key references public.ss_members(id) on delete cascade,
  company_id uuid not null references public.ss_companies(id) on delete cascade,
  token      text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

-- Access rules.
alter table public.ss_todo_checklist enable row level security;
alter table public.ss_comments enable row level security;
alter table public.ss_notifications enable row level security;
alter table public.ss_calendar_feeds enable row level security;
revoke all on public.ss_todo_checklist, public.ss_comments, public.ss_notifications, public.ss_calendar_feeds from anon;

-- Checklist follows its To-Do (so personal To-Do checklists stay private).
create policy "members via todo" on public.ss_todo_checklist for all to authenticated
  using (exists (select 1 from public.ss_todos t where t.id = todo_id))
  with check (public.ss_is_member(company_id) and exists (select 1 from public.ss_todos t where t.id = todo_id));

-- Comments: members read and add; authors edit their own; owners delete.
create policy "members read" on public.ss_comments for select to authenticated
  using (public.ss_is_member(company_id));
create policy "members add as self" on public.ss_comments for insert to authenticated
  with check (public.ss_is_member(company_id) and author_id = public.ss_my_member_id(company_id));
create policy "authors edit" on public.ss_comments for update to authenticated
  using (author_id = public.ss_my_member_id(company_id))
  with check (author_id = public.ss_my_member_id(company_id));
create policy "owners delete" on public.ss_comments for delete to authenticated
  using (public.ss_is_owner(company_id));

-- Notifications: only the recipient sees them and marks them read.
create policy "recipient reads" on public.ss_notifications for select to authenticated
  using (recipient_id = public.ss_my_member_id(company_id));
create policy "recipient marks read" on public.ss_notifications for update to authenticated
  using (recipient_id = public.ss_my_member_id(company_id))
  with check (recipient_id = public.ss_my_member_id(company_id));

-- Calendar feed token: only its owner sees or resets it.
create policy "own feed" on public.ss_calendar_feeds for all to authenticated
  using (member_id = public.ss_my_member_id(company_id))
  with check (member_id = public.ss_my_member_id(company_id));

create trigger ss_log after insert or update or delete on public.ss_todo_checklist
  for each row execute function public.ss_log_change();
create trigger ss_log after insert or update or delete on public.ss_comments
  for each row execute function public.ss_log_change();

alter publication supabase_realtime add table public.ss_notifications, public.ss_comments;
