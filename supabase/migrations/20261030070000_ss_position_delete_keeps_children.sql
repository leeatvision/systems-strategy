-- Deleting a position never deletes the positions under it.
--
-- They used to be removed with it (on delete cascade). Now they are kept and
-- become top-level positions, so no version of the app can wipe a branch of the
-- chart by removing one position. (The app also moves them up to the removed
-- position's parent first.)

alter table public.ss_positions drop constraint ss_positions_parent_position_id_fkey;
alter table public.ss_positions add constraint ss_positions_parent_position_id_fkey
  foreign key (parent_position_id) references public.ss_positions(id) on delete set null;
