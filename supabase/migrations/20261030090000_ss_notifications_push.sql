-- Notification settings, a daily To-Do reminder, and push
-- notifications to phones and computers.
--
-- * Everything still lands on the in-app bell (ss_notifications).
-- * Each new notification is also handed to the push-send function, which
--   sends it to the person's devices if they turned push on for that kind.
-- * Every 15 minutes, people whose reminder time has passed get one daily
--   summary of overdue and due-today To-Dos (if they have any).
-- * Secrets (the push signing key and the shared secret between the database
--   and push-send) live in Supabase Vault, never in this repo.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Settings, one row per person (missing row = defaults).
create table public.ss_notification_prefs (
  member_id       uuid primary key references public.ss_members(id) on delete cascade,
  company_id      uuid not null references public.ss_companies(id) on delete cascade,
  daily_reminder  boolean not null default true,
  reminder_time   time not null default '07:30',
  push_mentions   boolean not null default true,
  push_assigned   boolean not null default true,
  push_reminders  boolean not null default true,
  updated_at      timestamptz not null default now()
);
alter table public.ss_notification_prefs enable row level security;
revoke all on public.ss_notification_prefs from anon;
create policy "own settings" on public.ss_notification_prefs for all to authenticated
  using (member_id = public.ss_my_member_id(company_id)) with check (member_id = public.ss_my_member_id(company_id));
create trigger ss_touch before update on public.ss_notification_prefs for each row execute function public.ss_touch_updated_at();

-- Devices that accepted push (one row per browser/phone).
create table public.ss_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.ss_members(id) on delete cascade,
  company_id    uuid not null references public.ss_companies(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
alter table public.ss_push_subscriptions enable row level security;
revoke all on public.ss_push_subscriptions from anon;
create policy "own devices" on public.ss_push_subscriptions for select to authenticated
  using (member_id = public.ss_my_member_id(company_id));
create policy "remove own devices" on public.ss_push_subscriptions for delete to authenticated
  using (member_id = public.ss_my_member_id(company_id));

-- Save this device for the signed-in person (a shared device moves to whoever turned push on last).
create function public.ss_save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_company uuid;
begin
  select id, company_id into v_member, v_company from public.ss_members where user_id = auth.uid() and status = 'active';
  if v_member is null then raise exception 'Not a member'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then raise exception 'Bad endpoint'; end if;
  insert into public.ss_push_subscriptions (member_id, company_id, endpoint, p256dh, auth, user_agent)
  values (v_member, v_company, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set member_id = excluded.member_id, company_id = excluded.company_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;
revoke execute on function public.ss_save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.ss_save_push_subscription(text, text, text, text) to authenticated;

-- New notification kinds: the daily reminder and a test from the settings page.
alter table public.ss_notifications drop constraint ss_notifications_kind_check;
alter table public.ss_notifications add constraint ss_notifications_kind_check
  check (kind in ('mention', 'assigned', 'comment', 'reminder', 'test'));

create function public.ss_send_test_notification()
returns void language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_company uuid;
begin
  select id, company_id into v_member, v_company from public.ss_members where user_id = auth.uid() and status = 'active';
  if v_member is null then raise exception 'Not a member'; end if;
  insert into public.ss_notifications (company_id, recipient_id, kind, item_type, item_id, actor_id, summary)
  values (v_company, v_member, 'test', 'settings', v_member, v_member, 'Notifications are working.');
end $$;
revoke execute on function public.ss_send_test_notification() from public, anon;
grant execute on function public.ss_send_test_notification() to authenticated;

-- Secrets for push. The hook secret is made here; push-send creates the signing keys on first use.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ss_push_hook_secret', 'database → push-send')
where not exists (select 1 from vault.secrets where name = 'ss_push_hook_secret');
-- Replace <project-ref> with your Supabase project's reference before running.
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-send', 'ss_push_url', 'push-send address')
where not exists (select 1 from vault.secrets where name = 'ss_push_url');

-- push-send only (service role): read and store its secrets.
create function public.ss_push_secrets()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
  where name in ('ss_push_hook_secret', 'ss_vapid_public', 'ss_vapid_private')
$$;
revoke execute on function public.ss_push_secrets() from public, anon, authenticated;
grant execute on function public.ss_push_secrets() to service_role;

create function public.ss_push_save_keys(p_public text, p_private text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'ss_vapid_public') then return; end if;
  perform vault.create_secret(p_public, 'ss_vapid_public', 'push public key');
  perform vault.create_secret(p_private, 'ss_vapid_private', 'push signing key (JWK)');
end $$;
revoke execute on function public.ss_push_save_keys(text, text) from public, anon, authenticated;
grant execute on function public.ss_push_save_keys(text, text) to service_role;

-- The app needs the public key to subscribe a device.
create function public.ss_push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ss_vapid_public'
$$;
revoke execute on function public.ss_push_public_key() from public, anon;
grant execute on function public.ss_push_public_key() to authenticated;

-- Hand every new notification to push-send (it decides whether to send).
create function public.ss_push_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.ss_push_subscriptions where member_id = new.recipient_id) then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ss_push_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ss_push_hook_secret';
  perform net.http_post(url := v_url, body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret), timeout_milliseconds := 5000);
  return new;
end $$;
revoke execute on function public.ss_push_notification() from public, anon, authenticated;
create trigger ss_push after insert on public.ss_notifications for each row execute function public.ss_push_notification();

-- Daily reminder: once a day, after each person's reminder time (company time zone).
create function public.ss_queue_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_overdue int; v_today int; n int := 0;
begin
  for r in
    select m.id, m.company_id, c.time_zone, (now() at time zone c.time_zone) local_now, coalesce(p.reminder_time, '07:30') at_time
    from public.ss_members m
    join public.ss_companies c on c.id = m.company_id
    left join public.ss_notification_prefs p on p.member_id = m.id
    where m.status = 'active' and m.user_id is not null and coalesce(p.daily_reminder, true)
  loop
    continue when r.local_now::time < r.at_time;
    continue when exists (select 1 from public.ss_notifications x where x.recipient_id = r.id and x.kind = 'reminder'
      and (x.created_at at time zone r.time_zone)::date = r.local_now::date);
    select count(*) filter (where due_date < r.local_now::date), count(*) filter (where due_date = r.local_now::date)
      into v_overdue, v_today
      from public.ss_todos where owner_member_id = r.id and status = 'open' and deleted_at is null and archived_at is null;
    continue when v_overdue + v_today = 0;
    insert into public.ss_notifications (company_id, recipient_id, kind, item_type, item_id, summary)
    values (r.company_id, r.id, 'reminder', 'todo_list', r.id,
      concat_ws(' and ', case when v_overdue > 0 then v_overdue || ' overdue To-Do' || case when v_overdue > 1 then 's' else '' end end,
                         case when v_today > 0 then v_today || ' due today' end));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.ss_queue_reminders() from public, anon, authenticated;

select cron.schedule('ss-daily-reminders', '*/15 * * * *', 'select public.ss_queue_reminders()');
