-- "Scorecard" is now "Key Numbers" (table and code names stay; only shown titles change).
alter table public.ss_scorecards alter column title set default 'Key Numbers';
update public.ss_scorecards     set title = 'Key Numbers' where title = 'Scorecard';
update public.ss_agenda_items   set title = 'Key Numbers' where title = 'Scorecard';
update public.ss_session_agenda set title = 'Key Numbers' where title = 'Scorecard';
do $$
declare def text := pg_get_functiondef('public.ss_bootstrap_company'::regproc);
begin
  execute replace(def, '''Scorecard''', '''Key Numbers''');
end $$;
