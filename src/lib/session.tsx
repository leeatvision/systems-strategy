import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Company, type Member } from "./supabase";
import { clearOffline, offlineStatus, syncNow } from "./offline";
import { disablePush } from "./push";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; setupNeeded: boolean }
  | { kind: "no-access"; session: Session }
  | { kind: "ready"; session: Session; me: Member; company: Company };

interface SessionApi {
  state: State;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (session: Session | null) => {
    if (!session) {
      const { data } = await supabase.rpc("ss_setup_needed");
      setState({ kind: "signed-out", setupNeeded: data === true });
      return;
    }
    const { data: me } = await supabase
      .from("ss_members").select("*").eq("user_id", session.user.id).eq("status", "active").maybeSingle();
    if (!me) {
      setState({ kind: "no-access", session });
      return;
    }
    const { data: company } = await supabase.from("ss_companies").select("id, name, time_zone").eq("id", me.company_id).single();
    setState({ kind: "ready", session, me: me as Member, company: company as Company });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") load(session);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void syncNow();
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session);
  }, [load]);

  const signOut = useCallback(async () => {
    await syncNow();
    const { waiting } = await offlineStatus();
    if (waiting && !confirm(`${waiting} change${waiting === 1 ? " hasn't" : "s haven't"} reached the server yet and will be lost if you sign out now. Sign out anyway?`)) return;
    // Stop push on this device so a shared phone doesn't keep getting the last person's notifications.
    await disablePush().catch(() => {});
    await supabase.auth.signOut();
    await clearOffline();
  }, []);

  return <Ctx.Provider value={{ state, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** For screens that only render once signed in. */
export function useMe() {
  const { state } = useSession();
  if (state.kind !== "ready") throw new Error("Not signed in");
  return { me: state.me, company: state.company, isOwner: state.me.role === "owner" };
}
