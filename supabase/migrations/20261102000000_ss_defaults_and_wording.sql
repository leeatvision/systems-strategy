-- Column defaults on the live project that still carried names from before the rename,
-- and "&" written out as "and" in the app's own defaults and default titles.
-- Only ss_ tables and functions are touched.

alter table public.ss_meetings      alter column meeting_type set default 'weekly';
alter table public.ss_org_charts    alter column title        set default 'Org Chart';
alter table public.ss_plan_versions alter column title        set default 'Vision and Plan';

-- Default titles copied in when the company was set up (people's own titles are left alone).
update public.ss_agenda_items  set title = 'Discuss and Solve' where title = 'Discuss & Solve';
update public.ss_agenda_items  set title = 'To-Do List'        where title = 'To-Do list';
update public.ss_plan_versions set title = 'Vision and Plan'   where title = 'Vision & Plan';

-- The first-run setup uses the same agenda titles as the app.
do $$
declare def text := pg_get_functiondef('public.ss_bootstrap_company'::regproc);
begin
  def := replace(def, '''Discuss & Solve''', '''Discuss and Solve''');
  def := replace(def, '''Goal review''', '''Goal Review''');
  def := replace(def, '''To-Do list''', '''To-Do List''');
  execute def;
end $$;

-- Standard checkup question groups.
update public.ss_checkup_standard_questions set group_title = replace(group_title, ' & ', ' and ') where group_title like '% & %';

-- Weeks now run Sunday to Saturday: weekly Scorecard numbers move from their Monday to that week's Sunday.
update public.ss_measurable_values v set period_start = v.period_start - 1
from public.ss_measurables m join public.ss_scorecards s on s.id = m.scorecard_id
where m.id = v.measurable_id and coalesce(m.period_override, s.period) = 'week' and extract(dow from v.period_start) = 1;
