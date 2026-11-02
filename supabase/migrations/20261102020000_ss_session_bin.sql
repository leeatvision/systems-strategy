-- Past meetings can go to the recycle bin; archiving finished items at the end of a meeting starts unticked.
alter table public.ss_meeting_sessions add column if not exists deleted_at timestamptz;
alter table public.ss_meeting_sessions alter column clear_done_items set default false;
update public.ss_meeting_sessions set clear_done_items = false where status = 'running';
