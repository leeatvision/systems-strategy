-- Files can be attached to a Vision and Plan version (uploaded while it's a draft).
alter table public.ss_attachments drop constraint ss_attachments_item_type_check;
alter table public.ss_attachments add constraint ss_attachments_item_type_check
  check (item_type in ('goal', 'todo', 'issue', 'headline', 'meeting', 'process', 'plan'));
