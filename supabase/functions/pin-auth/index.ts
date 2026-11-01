// PIN sign-in: email + 6-digit PIN instead of emailed codes.
//
// POST { action: "login", email, pin }
// POST { action: "setup", email, pin, companyName, firstName, lastName }   (first time only)
//   -> { access_token, refresh_token }  for supabase.auth.setSession()
//
// Never sends email: logins are created already confirmed, and each login's
// password is a server-derived secret (HMAC of the user id) that is set once
// and never shown to anyone. The PIN itself is checked in the database by
// ss_verify_pin, which also locks an email after repeated wrong tries
// (15 minutes, then 24 hours, then until an owner resets the PIN).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The derived password changes if this label or the service key changes; openSession re-sets it then.
async function loginSecret(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`systems-strategy:${userId}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Create a fresh Supabase login for someone signing in for the first time.
// Any login that already exists for the email but isn't linked to a person was
// not made by us (Supabase allows open sign-up), so it is deleted first; that
// also ends any session someone else may hold on it.
async function freshLogin(db: SupabaseClient, email: string): Promise<string> {
  const { data: stale, error } = await db.rpc("ss_unlinked_auth_user", { p_email: email });
  if (error) throw error;
  if (stale) {
    const { error: delError } = await db.auth.admin.deleteUser(stale as string);
    if (delError) throw delError;
  }

  const tempPassword = crypto.randomUUID() + crypto.randomUUID();
  const { data, error: createError } = await db.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true,
  });
  if (createError) throw createError;
  const userId = data.user.id;
  const { error: pwError } = await db.auth.admin.updateUserById(userId, { password: await loginSecret(userId) });
  if (pwError) throw pwError;
  return userId;
}

const LOCK_MESSAGES: Record<string, [number, string]> = {
  locked: [429, "Too many wrong PINs. Try again in 15 minutes."],
  locked_day: [429, "Too many wrong PINs today. Try again tomorrow, or ask an owner to reset your PIN."],
  locked_reset: [423, "This account is locked. Ask an owner to reset your PIN."],
  busy: [503, "Sign-in is paused for a few minutes. Try again shortly."],
};

async function openSession(db: SupabaseClient, userId: string, email: string) {
  const password = await loginSecret(userId);
  const signIn = () => serviceClient().auth.signInWithPassword({ email, password });
  let { data, error } = await signIn();
  if (error) {
    // Re-set the login once: the derived secret changes if the service key is rotated, and the
    // login's email must follow the person's email when an owner (or they) changed it.
    const { error: pwError } = await db.auth.admin.updateUserById(userId, { email, email_confirm: true, password });
    if (pwError) throw pwError;
    ({ data, error } = await signIn());
    if (error) throw error;
  }
  return { access_token: data.session!.access_token, refresh_token: data.session!.refresh_token };
}

async function login(db: SupabaseClient, email: string, pin: string) {
  const { data: memberId, error } = await db.rpc("ss_verify_pin", { p_email: email, p_pin: pin });
  if (error) {
    const lock = LOCK_MESSAGES[error.message];
    if (lock) return reply(lock[0], { error: lock[1] });
    throw error;
  }
  if (!memberId) return reply(401, { error: "That email and PIN don't match." });

  const { data: member, error: memberError } = await db
    .from("ss_members").select("id, email, user_id").eq("id", memberId).single();
  if (memberError) throw memberError;

  let userId = member.user_id as string | null;
  if (!userId) {
    userId = await freshLogin(db, member.email);
    const { error: linkError } = await db.rpc("ss_link_member_login", { p_member: member.id, p_user: userId });
    if (linkError) throw linkError;
  }
  return reply(200, await openSession(db, userId, member.email));
}

async function setup(db: SupabaseClient, body: Record<string, string>) {
  const email = (body.email ?? "").trim().toLowerCase();
  const { data: needed, error } = await db.rpc("ss_setup_needed");
  if (error) throw error;
  if (!needed) return reply(409, { error: "The app is already set up. Sign in with your PIN." });

  const { data: allowed, error: allowedError } = await db.rpc("ss_setup_allowed", { p_email: email });
  if (allowedError) throw allowedError;
  if (!allowed) {
    return reply(403, { error: "This email isn't the one chosen to set up the company." });
  }
  const { data: pinOk } = await db.rpc("ss_pin_is_acceptable", { p_pin: body.pin ?? "" });
  if (!pinOk) return reply(400, { error: "PIN must be 6 digits, not all the same and not a run like 123456." });

  const userId = await freshLogin(db, email);
  const { error: bootError } = await db.rpc("ss_bootstrap_company", {
    p_user: userId, p_email: email, p_company_name: body.companyName ?? "",
    p_first_name: body.firstName ?? "", p_last_name: body.lastName ?? "", p_pin: body.pin,
  });
  if (bootError) {
    await db.auth.admin.deleteUser(userId);
    console.error(bootError);
    return reply(400, { error: "Set-up didn't complete. Check the details and try again." });
  }
  return reply(200, await openSession(db, userId, email));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "");
    if (!email || email.length > 254 || !/^[0-9]{6}$/.test(pin)) return reply(400, { error: "Enter your email and 6-digit PIN." });
    const db = serviceClient();
    if (body.action === "login") return await login(db, email, pin);
    if (body.action === "setup") return await setup(db, { ...body, email, pin });
    return reply(400, { error: "Unknown action" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "Something went wrong signing in. Try again." });
  }
});
