// Push sender.
//
// POST { notification_id }  with header x-hook-secret: called by the database for
//   every new notification; sends it to the recipient's devices if they turned
//   push on for that kind.
// POST { action: "init" }  : makes sure the signing keys exist (the app calls it
//   before the first device subscribes). Harmless to call again.
//
// The signing keys are generated here on first use and kept in Supabase Vault;
// they never leave the server. Deploy with verify_jwt off: the database can't
// send a user token, so the shared hook secret is what authorises sending.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { generateVapidKeys, sendPush, type VapidKeys } from "./webpush.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function secrets(): Promise<Record<string, string>> {
  const { data, error } = await db.rpc("ss_push_secrets");
  if (error) throw error;
  return (data ?? {}) as Record<string, string>;
}

async function keys(): Promise<VapidKeys> {
  const s = await secrets();
  if (s.ss_vapid_public && s.ss_vapid_private) return { publicKey: s.ss_vapid_public, privateJwk: JSON.parse(s.ss_vapid_private) };
  const fresh = await generateVapidKeys();
  const { error } = await db.rpc("ss_push_save_keys", { p_public: fresh.publicKey, p_private: JSON.stringify(fresh.privateJwk) });
  if (error) throw error;
  const again = await secrets(); // another call may have won the race; use whatever was stored
  return { publicKey: again.ss_vapid_public, privateJwk: JSON.parse(again.ss_vapid_private) };
}

/** Constant-time comparison so the hook secret can't be guessed by timing. */
function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function link(itemType: string, itemId: string): string {
  if (itemType === "goal") return `#/goals/${itemId}`;
  if (itemType === "process") return `#/processes/${itemId}`;
  if (itemType === "todo_list") return "#/todos";
  if (itemType === "key_numbers") return "#/key-numbers";
  if (itemType === "goals") return "#/goals";
  if (itemType === "meeting") return `#/meetings/${itemId}`;
  if (itemType === "settings") return "#/settings/notifications";
  const page: Record<string, string> = { todo: "todos", issue: "issues", headline: "headlines" };
  return page[itemType] ? `#/${page[itemType]}?open=${itemId}` : "#/notifications";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  let body: { notification_id?: string; action?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }

  try {
    if (body.action === "init") { await keys(); return json(200, { ok: true }); }

    const hook = (await secrets()).ss_push_hook_secret;
    if (!same(req.headers.get("x-hook-secret") ?? "", hook)) return json(401, { error: "Not allowed" });
    if (!body.notification_id) return json(400, { error: "Missing notification" });

    const { data: n } = await db.from("ss_notifications").select("*").eq("id", body.notification_id).maybeSingle();
    if (!n) return json(404, { error: "No such notification" });
    const { data: prefs } = await db.from("ss_notification_prefs").select("*").eq("member_id", n.recipient_id).maybeSingle();
    const wanted = n.kind === "test" ? true
      : n.kind === "mention" ? prefs?.push_mentions ?? true
      : n.kind === "assigned" ? prefs?.push_assigned ?? true
      : n.kind === "reminder" ? prefs?.push_reminders ?? true
      : false;
    if (!wanted) return json(200, { sent: 0, reason: "off for this kind" });

    const { data: subs } = await db.from("ss_push_subscriptions").select("*").eq("member_id", n.recipient_id);
    if (!subs?.length) return json(200, { sent: 0, reason: "no devices" });

    let actor = "Someone";
    if (n.actor_id) {
      const { data: a } = await db.from("ss_members").select("first_name").eq("id", n.actor_id).maybeSingle();
      if (a?.first_name) actor = a.first_name;
    }
    const title = n.title ? n.title
      : n.kind === "mention" ? `${actor} mentioned you`
      : n.kind === "assigned" ? `New To-Do from ${actor}`
      : n.kind === "reminder" ? "Your To-Dos today"
      : "Notification";
    const payload = { title, body: n.summary, url: link(n.item_type, n.item_id), tag: `${n.kind}-${n.item_id}` };

    const k = await keys();
    // Contact sent to push services with each message (an https address or mailto:), kept in Vault.
    const contact = (await secrets()).ss_push_subject ?? "";
    let sent = 0;
    for (const s of subs) {
      const status = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, k, contact).catch(() => 0);
      if (status === 404 || status === 410) await db.from("ss_push_subscriptions").delete().eq("id", s.id);
      else if (status >= 200 && status < 300) {
        sent++;
        await db.from("ss_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
      } else console.error("push failed", status, new URL(s.endpoint).host);
    }
    return json(200, { sent });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Push failed" });
  }
});
