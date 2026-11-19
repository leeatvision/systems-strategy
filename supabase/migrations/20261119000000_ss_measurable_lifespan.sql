-- Key Numbers keep their history as the list changes:
--   active_from     the first day a number is on the list (shown in periods from then on)
--   archived_at     (existing, unused until now) the day it was retired: off the list from then on, history kept
--   replaced_by_id  when a number is replaced by a new one that measures something different
-- Adds two columns to ss_measurables and fills active_from for existing rows; nothing else changes.

alter table public.ss_measurables
  add column if not exists active_from date,
  add column if not exists replaced_by_id uuid references public.ss_measurables(id) on delete set null;

-- Existing numbers: live from their first entered number, or the day they were added if earlier.
update public.ss_measurables m
set active_from = least(m.created_at::date, coalesce((select min(v.period_start) from public.ss_measurable_values v where v.measurable_id = m.id), m.created_at::date))
where m.active_from is null;

alter table public.ss_measurables alter column active_from set default current_date;
alter table public.ss_measurables alter column active_from set not null;

-- A number is replaced by at most one other, never by itself, and retires no earlier than it starts.
create unique index if not exists ss_measurables_replaced_by on public.ss_measurables (replaced_by_id) where replaced_by_id is not null;
alter table public.ss_measurables add constraint ss_measurables_not_self check (replaced_by_id is null or replaced_by_id <> id);
alter table public.ss_measurables add constraint ss_measurables_retired_after_start check (archived_at is null or archived_at::date >= active_from);
