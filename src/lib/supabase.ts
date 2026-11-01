import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";
import { offlineFetch, setTokenSource } from "./offline";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  // Keeps working with no connection: see offline.ts.
  global: { fetch: offlineFetch },
});
setTokenSource(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);

export type Role = "owner" | "leader" | "member";

export interface Member {
  id: string;
  company_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string | null;
  role: Role;
  status: "active" | "removed";
}

export interface Company {
  id: string;
  name: string;
  time_zone: string;
}

/** Calls the pin-auth edge function and stores the session it returns. */
export async function pinAuth(body: Record<string, string>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pin-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't sign in. Try again.");
  const { error } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (error) throw error;
}

export function fullName(m: Pick<Member, "first_name" | "last_name">): string {
  return `${m.first_name} ${m.last_name}`.trim();
}

export function initials(m: Pick<Member, "first_name" | "last_name">): string {
  return `${m.first_name[0] ?? ""}${m.last_name[0] ?? ""}`.toUpperCase();
}

/** Turns database errors into something readable. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (msg.includes("duplicate key") && msg.includes("email")) return "Someone with that email is already here.";
  return msg;
}
