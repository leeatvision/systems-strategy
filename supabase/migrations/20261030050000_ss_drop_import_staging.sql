-- The one-time import is done and checked, so the staged
-- copy of the previous tool's data and the placeholder-to-person map go.

drop table public.ss_import_staging;
delete from public.ss_private_settings where key = 'import_people_map';
