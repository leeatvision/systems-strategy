-- Push sender contact: the address push services may use to reach the app's owner,
-- kept in Vault as ss_push_subject (an https address or mailto:) instead of in code.
-- Set it once with: select vault.create_secret('https://<your-app-address>/', 'ss_push_subject', 'push contact');
create or replace function public.ss_push_secrets()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
  where name in ('ss_push_hook_secret', 'ss_vapid_public', 'ss_vapid_private', 'ss_push_subject')
$$;
revoke execute on function public.ss_push_secrets() from public, anon, authenticated;
grant execute on function public.ss_push_secrets() to service_role;
