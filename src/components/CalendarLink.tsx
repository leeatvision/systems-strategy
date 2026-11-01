import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { SUPABASE_URL } from "../lib/config";
import { useMe } from "../lib/session";

/** Private read-only calendar subscription for Google, Outlook or Apple Calendar. */
export function CalendarLink() {
  const { me, company } = useMe();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_calendar_feeds").select("token").eq("member_id", me.id).maybeSingle();
    setToken(data?.token ?? null);
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const { error } = await supabase.from("ss_calendar_feeds").insert({ member_id: me.id, company_id: company.id });
    if (error) setError(friendlyError(error)); else { setError(""); load(); }
  };
  const reset = async () => {
    if (!confirm("Make a new link? The old one stops working, so you'll need to re-add the calendar anywhere you used it.")) return;
    await supabase.from("ss_calendar_feeds").delete().eq("member_id", me.id);
    create();
  };

  const url = token ? `${SUPABASE_URL}/functions/v1/calendar-feed?token=${token}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("Couldn't copy. Press and hold the link to copy it."); }
  };

  return (
    <div className="card card-pad stack">
      <h2>Calendar link</h2>
      <p className="small muted">Shows your open To-Dos (on their due dates) and your meetings in Google, Outlook or Apple Calendar. It's read-only and updates every hour or so.</p>
      {token === undefined ? <p className="small muted">Loading…</p> : token === null ? (
        <button className="btn" onClick={create}><CalendarPlus size={16} />Create my calendar link</button>
      ) : <>
        <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
        <div className="row wrap">
          <button className="btn btn-sm" onClick={copy}><Copy size={16} />{copied ? "Copied" : "Copy link"}</button>
          <a className="btn btn-sm" href={url.replace(/^https:/, "webcal:")}>Open in Apple Calendar</a>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={reset}><RefreshCw size={16} />Reset link</button>
        </div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Google Calendar</strong> (on a computer): Other calendars → + → From URL → paste the link.</li>
          <li><strong>Outlook</strong>: Add calendar → Subscribe from web → paste the link.</li>
          <li>Keep it private: anyone with the link can see these items. Reset it if it's shared by mistake.</li>
        </ul>
      </>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
