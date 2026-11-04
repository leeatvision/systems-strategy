-- Flexible repeating To-Dos. A To-Do's `repeat` holds its rule:
--   every   1, 2, 3…                    unit  day | week | month | year
--   weekdays [0..6] (weeks, Sun = 0)     monthly  day (dom: day of month) | weekday (nth: 1-4 or -1 = last, wd: 0..6)
--   from   due (on schedule) | done (counted from the day it's ticked done)
--   times  stop after this many         until  stop after this date       n  which one this is (1, 2, 3…)
-- When a repeating To-Do is ticked done, the next one is created (with its checklist, unticked).
-- The older repeat_rule values keep working.

alter table public.ss_todos add column if not exists repeat jsonb;

create or replace function public.ss_next_repeat(p jsonb, p_due date, p_done date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_every int := greatest(coalesce((p->>'every')::int, 1), 1);
  v_unit text := coalesce(p->>'unit', 'week');
  v_base date := case when p->>'from' = 'done' then coalesce(p_done, p_due) else p_due end;
  v_next date; v_days int[]; v_ws date; d date; i int; v_m date; v_dom int; v_nth int; v_wd int; v_last int;
begin
  if v_unit = 'day' then
    v_next := v_base + v_every;
  elsif v_unit = 'week' then
    select array_agg(x::int order by x::int) into v_days from jsonb_array_elements_text(coalesce(p->'weekdays', '[]'::jsonb)) x;
    if v_days is null then
      v_next := v_base + 7 * v_every;
    else
      -- The next chosen weekday later this week; otherwise the first chosen weekday `every` weeks on.
      v_ws := v_base - extract(dow from v_base)::int;
      for i in 1..6 loop
        d := v_base + i;
        exit when d >= v_ws + 7;
        if extract(dow from d)::int = any(v_days) then v_next := d; exit; end if;
      end loop;
      if v_next is null then v_next := v_ws + 7 * v_every + v_days[1]; end if;
    end if;
  elsif v_unit = 'month' then
    v_m := (date_trunc('month', v_base) + make_interval(months => v_every))::date;
    if p->>'monthly' = 'weekday' then
      v_nth := coalesce((p->>'nth')::int, 1);
      v_wd := coalesce((p->>'wd')::int, extract(dow from p_due)::int);
      if v_nth = -1 then
        d := (v_m + interval '1 month' - interval '1 day')::date;
        v_next := d - ((extract(dow from d)::int - v_wd + 7) % 7);
      else
        v_next := v_m + ((v_wd - extract(dow from v_m)::int + 7) % 7) + 7 * (v_nth - 1);
      end if;
    else
      v_dom := coalesce((p->>'dom')::int, extract(day from p_due)::int);
      v_last := extract(day from (v_m + interval '1 month' - interval '1 day'))::int;
      v_next := v_m + (least(v_dom, v_last) - 1);
    end if;
  else
    v_next := (v_base + make_interval(years => v_every))::date;
  end if;
  return v_next;
end $$;

create or replace function public.ss_repeat_todo()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_rule jsonb; v_next date; v_done date; v_n int; v_id uuid; i int := 0;
begin
  if (new.repeat is null and new.repeat_rule is null) or new.status <> 'done' or old.status = 'done' or new.deleted_at is not null then
    return new;
  end if;
  if exists (select 1 from public.ss_todos where repeat_parent_id = new.id) then return new; end if;
  v_rule := coalesce(new.repeat, case new.repeat_rule
    when 'daily' then '{"every":1,"unit":"day"}'::jsonb
    when 'weekdays' then '{"every":1,"unit":"week","weekdays":[1,2,3,4,5]}'::jsonb
    when 'weekly' then '{"every":1,"unit":"week"}'::jsonb
    when 'biweekly' then '{"every":2,"unit":"week"}'::jsonb
    else '{"every":1,"unit":"month"}'::jsonb end);
  v_n := coalesce((v_rule->>'n')::int, 1);
  if v_rule ? 'times' and v_n >= (v_rule->>'times')::int then return new; end if;
  select (now() at time zone c.time_zone)::date into v_done from public.ss_companies c where c.id = new.company_id;
  v_next := public.ss_next_repeat(v_rule, new.due_date, v_done);
  -- Ticked off late: skip ahead to the first one that isn't already past.
  while v_next < v_done and i < 400 loop
    v_next := public.ss_next_repeat(v_rule, v_next, v_done);
    i := i + 1;
  end loop;
  if v_rule ? 'until' and v_next > (v_rule->>'until')::date then return new; end if;

  insert into public.ss_todos (company_id, meeting_id, owner_member_id, title, description, due_date, is_personal,
                               scheduled_on, scheduled_time, duration_minutes, priority, repeat_rule, repeat, repeat_parent_id, created_by)
  values (new.company_id, new.meeting_id, new.owner_member_id, new.title, new.description, v_next, new.is_personal,
          case when new.scheduled_on is not null then v_next end, new.scheduled_time, new.duration_minutes,
          new.priority, null, v_rule || jsonb_build_object('n', v_n + 1), new.id, new.created_by)
  returning id into v_id;
  insert into public.ss_todo_checklist (company_id, todo_id, sort_order, title, is_done)
    select company_id, v_id, sort_order, title, false from public.ss_todo_checklist where todo_id = new.id;
  return new;
end $$;
