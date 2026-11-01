# API

How the app talks to its server. Everything runs on Supabase: one sign-in endpoint, the database's standard REST interface, a few database functions, file storage and live updates. There is no other server.

Tables and their fields are defined in [`supabase/migrations/`](../supabase/migrations/). This page covers how to call them and what each caller is allowed to do.

## Addresses and keys

| What | Value | Public? |
|---|---|---|
| Project address | `supabaseUrl` in the brand folder's `brand.json` (see README, "Branding") | Yes |
| Publishable key | `supabaseKey` in the same `brand.json` (starts `sb_publishable_`) | Yes. It only identifies the project; on its own it can read nothing. |
| Service key | Held by Supabase as the `SUPABASE_SERVICE_ROLE_KEY` secret of the `pin-auth` function | **Never.** It must not appear in this repo, the app or any browser. |

Every request sends the publishable key in an `apikey` header. Once signed in, requests also send `Authorization: Bearer <access_token>`. The Supabase JavaScript library (`supabase` in [`src/lib/supabase.ts`](../src/lib/supabase.ts)) adds both automatically.

## Sign-in: `POST /functions/v1/pin-auth`

Email plus a 6-digit PIN. Source: [`supabase/functions/pin-auth/index.ts`](../supabase/functions/pin-auth/index.ts).

**Sign in**

```json
{ "action": "login", "email": "you@company.com", "pin": "482913" }
```

**First-time set-up** (only while no company exists, and only for one of the two owner emails held in the database's server-only settings)

```json
{ "action": "setup", "email": "you@company.com", "pin": "482913",
  "companyName": "…", "firstName": "…", "lastName": "…" }
```

**Success** (`200`): `{ "access_token": "…", "refresh_token": "…" }`. Pass both to `supabase.auth.setSession()`; the app's `pinAuth()` helper does this.

**Errors** always come back as `{ "error": "<message to show the person>" }`:

| Status | When |
|---|---|
| 400 | Missing email, PIN not 6 digits, weak PIN at set-up, unknown action, or set-up details rejected |
| 401 | Email and PIN don't match |
| 403 | Set-up attempted with an email that isn't an owner's |
| 405 | Not a POST |
| 409 | Set-up attempted after the company already exists |
| 423 | Locked until an owner resets the PIN (30 wrong since the last good sign-in) |
| 429 | Locked for 15 minutes (5 wrong) or until tomorrow (10 wrong in a day) |
| 500 / 503 | Server problem, or sign-in briefly paused |

No email or text is ever sent. Setting a PIN (`ss_set_member_pin`, below) lifts any lockout.

## Tables: `/rest/v1/<table>`

Every `ss_` table is reached through Supabase's REST interface, normally via the library:

```ts
const { data, error } = await supabase
  .from("ss_goals")
  .select("id, title, status, owner_member_id")
  .eq("company_id", companyId)
  .order("due_date");
```

Access is enforced inside the database (row-level security), not by the app, so these rules hold whatever calls the API:

| Caller | Can do |
|---|---|
| Not signed in | Nothing, apart from `ss_setup_needed` (below). Every table refuses anonymous access. |
| Signed in, but not a member | Nothing. A login without a member record sees no rows. |
| Member | Read, add and edit their company's rows in every planning table: teams, meetings, live meeting sessions, Goals and their steps and resources, To-Dos, Issues, Headlines, Scorecard, Vision & Plan, Org Chart, attachments, To-Do checklists and comments. |
| Owner | Everything a member can, plus permanent delete, editing the company, and adding people and changing their roles. |

Rules that narrow this:

- **Personal To-Dos** (`is_personal`) are visible and editable only by their owner, and so are their checklist items, comments and files.
- **People** (`ss_members`): members can edit their own profile; only owners add people, change roles, remove people or relink logins (enforced in the database, not just the app). The last active owner can't be demoted or removed.
- **Comments**: written as yourself; only the author edits; owners delete.
- **Notifications**: each person sees and marks read only their own.
- **Calendar feeds**: each person manages only their own.
- **Activity log** (`ss_activity_log`): read-only. It is written only by the database, and hides history of personal To-Dos from everyone else.
- **Server-only tables** (`ss_private_settings`, `ss_member_pins`, `ss_pin_failures`): no access through the API at all.

Full detail is in the row-level security policies in `supabase/migrations/`.

## Database functions: `POST /rest/v1/rpc/<name>`

Called with `supabase.rpc(name, args)`.

| Function | Who can call | Arguments | Returns |
|---|---|---|---|
| `ss_setup_needed` | Anyone | none | `true` until first-time set-up has run. Reveals nothing else. |
| `ss_my_member_id` | Signed in | `p_company` | The caller's member id in that company, or null |
| `ss_is_member` | Signed in | `p_company` | Whether the caller is an active member |
| `ss_is_owner` | Signed in | `p_company` | Whether the caller is an owner |
| `ss_set_member_pin` | Signed in | `p_member`, `p_pin` | Sets a PIN. Anyone can set their own; only owners can set someone else's. Weak PINs are refused. Also lifts any lockout. |
| `ss_pin_is_acceptable` | Signed in | `p_pin` | Whether a PIN would be accepted (6 digits, not all the same, not a run like 123456) |
| `ss_members_with_pin` | Members | `p_company` | DiscussSolve of people who have a PIN (never the PIN itself) |
| `ss_locked_members` | Owners (others get an empty list) | `p_company` | DiscussSolve of people currently locked out |

Functions used only by the sign-in service (`ss_verify_pin`, `ss_bootstrap_company`, `ss_setup_allowed`, `ss_link_member_login`, `ss_unlinked_auth_user` and others) are closed to every API caller; only the service key can run them.

## Files: bucket `ss-attachments`

Private bucket, 25 MB per file. Paths start with the company id:

```
{company_id}/{item_type}/{item_id}/{file name}
```

Members can read and upload their company's files; only owners delete. Files on a personal To-Do (`{company_id}/todo/{todo_id}/…`) are only for that To-Do's owner. Each file also has a row in `ss_attachments`.

## Calendar feed: `GET /functions/v1/calendar-feed?token=<token>`

A read-only `.ics` subscription for Google, Outlook or Apple Calendar. Source: [`supabase/functions/calendar-feed/index.ts`](../supabase/functions/calendar-feed/index.ts).

- Each person creates or resets their own private token on **My profile** (a row in `ss_calendar_feeds`, which only its owner can see).
- Calendar apps can't sign in, so the token is the only key. It returns that person's open To-Dos (all-day on their due dates) and the meetings they're invited to, repeating on the meeting's cadence in the company's time zone.
- An unknown token, or a token for someone who has been removed, gets `404`.

## Push: `POST /functions/v1/push-send`

Source: [`supabase/functions/push-send/`](../supabase/functions/push-send/). Called by the database (a trigger on `ss_notifications`, through `pg_net`) with a shared secret from Supabase Vault; it sends each new notification to the recipient's devices (`ss_push_subscriptions`) if their settings (`ss_notification_prefs`) want that kind. `{"action": "init"}` makes sure the signing keys exist; the keys are created on the server and kept in Vault. Devices are saved with `ss_save_push_subscription`; the app reads the public key with `ss_push_public_key`. A `pg_cron` job runs `ss_queue_reminders()` every 15 minutes to send each person's daily To-Do reminder after their chosen time.

## Working offline

The app's database calls go through [`src/lib/offline.ts`](../src/lib/offline.ts). Reads are kept on the device; with no connection the last copy is shown, with waiting changes laid over it. Changes made offline are queued on the device and sent in order when the connection returns; new rows get their id on the device, so retries can't duplicate them. Anything the server refuses is kept for the person to see. Signing in, files, push settings and PIN changes need a connection. Everything kept on the device is cleared on sign-out.

## Live updates

The live Weekly Meeting screen subscribes through Supabase Realtime to changes in: `ss_meeting_sessions`, `ss_session_attendees`, `ss_session_agenda`, `ss_session_events`, `ss_todos`, `ss_issues`, `ss_headlines`, `ss_goals` and `ss_measurable_values`. The notification bell and comment threads also update live (`ss_notifications`, `ss_comments`). The same access rules apply, so people only receive rows they could read anyway.

```ts
supabase.channel("meeting")
  .on("postgres_changes", { event: "*", schema: "public", table: "ss_session_events",
        filter: `session_id=eq.${sessionId}` }, onChange)
  .subscribe();
```

## Keeping it safe on GitHub

This repo is public, so:

- Only the project address and publishable key appear in code. Both are meant to be public; access is decided by the database rules above.
- The service key, PINs, names, emails and imported data live only in Supabase, never in this repo.
- Database changes go in new files under [`supabase/migrations/`](../supabase/migrations/); every new `ss_` table needs row-level security turned on and anonymous access revoked, like the existing ones.
- Before pushing, check the diff for keys starting `sb_secret_`, anything starting `eyJ`, and real names, emails or phone numbers.
