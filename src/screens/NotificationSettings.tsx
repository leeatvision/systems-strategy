import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, ChevronLeft, Send, Smartphone } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { APP_NAME } from "../lib/config";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";

interface Prefs {
  daily_reminder: boolean; reminder_time: string; push_mentions: boolean; push_assigned: boolean; push_reminders: boolean;
}
const DEFAULTS: Prefs = { daily_reminder: true, reminder_time: "07:30", push_mentions: true, push_assigned: true, push_reminders: true };

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row${disabled ? " is-disabled" : ""}`}>
      <span style={{ flex: 1, minWidth: 0 }}><span className="item-title">{label}</span>{hint && <span className="small muted" style={{ display: "block" }}>{hint}</span>}</span>
      <input type="checkbox" className="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function NotificationSettings() {
  const { me, company } = useMe();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, { count }] = await Promise.all([
      supabase.from("ss_notification_prefs").select("*").eq("member_id", me.id).maybeSingle(),
      supabase.from("ss_push_subscriptions").select("id", { count: "exact", head: true }).eq("member_id", me.id),
    ]);
    setPrefs(data ? { ...DEFAULTS, ...data, reminder_time: String(data.reminder_time).slice(0, 5) } : DEFAULTS);
    setDevices(count ?? 0);
    setState(await pushState().catch(() => "unsupported" as PushState));
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (change: Partial<Prefs>) => {
    const next = { ...(prefs ?? DEFAULTS), ...change };
    setPrefs(next);
    const { error } = await supabase.from("ss_notification_prefs").upsert({ member_id: me.id, company_id: company.id, ...next });
    setMsg(error ? { ok: false, text: friendlyError(error) } : null);
  };
  const device = async (on: boolean) => {
    setBusy(true); setMsg(null);
    try {
      if (on) await enablePush(); else await disablePush();
      setMsg({ ok: true, text: on ? "Notifications are on for this device." : "Notifications are off for this device." });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
    setBusy(false);
    load();
  };
  const test = async () => {
    const { error } = await supabase.rpc("ss_send_test_notification");
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: devices ? "Test sent. It should arrive in a few seconds." : "Test added to your bell. Turn on push to get it on this device too." });
  };

  if (!prefs || !state) return <p className="muted">Loading…</p>;
  const pushOn = state === "on";

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <Link to="/notifications" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Notifications</Link>
      <h1>Notification settings</h1>

      <div className="card card-pad stack">
        <div className="row"><Smartphone size={20} /><h2>Push on this device</h2></div>
        {state === "needs-install" && (
          <p className="notice">On iPhone and iPad, push notifications only work in the installed app. In Safari, tap the Share button, then <strong>Add to Home Screen</strong>, open {APP_NAME} from your Home Screen, and come back here.</p>
        )}
        {state === "unsupported" && <p className="small muted">This browser can't receive push notifications. Try Chrome, Edge or Safari, or the installed app.</p>}
        {state === "denied" && <p className="notice">Notifications are blocked for this app. Allow them in your browser or phone settings (look for Notifications under this site or app), then come back here.</p>}
        {(state === "on" || state === "off") && (
          <Toggle on={pushOn} disabled={busy} onChange={device} label={pushOn ? "On" : "Off"}
            hint="Pop-up notifications on this phone or computer, even when the app is closed. Turn on separately on each device." />
        )}
        <p className="small muted">{devices === 0 ? "No devices are getting push yet." : `${devices} device${devices === 1 ? "" : "s"} getting push.`}</p>
      </div>

      <div className="card card-pad stack">
        <div className="row"><BellRing size={20} /><h2>What to push</h2></div>
        <p className="small muted">Everything always appears on the bell in the app. These choose what also pops up on your devices.</p>
        <Toggle on={prefs.push_mentions} onChange={(v) => save({ push_mentions: v })} label="Someone @mentions me" />
        <Toggle on={prefs.push_assigned} onChange={(v) => save({ push_assigned: v })} label="Someone gives me a To-Do" />
        <Toggle on={prefs.push_reminders} onChange={(v) => save({ push_reminders: v })} label="My daily To-Do reminder" disabled={!prefs.daily_reminder} />
      </div>

      <div className="card card-pad stack">
        <h2>Daily reminder</h2>
        <Toggle on={prefs.daily_reminder} onChange={(v) => save({ daily_reminder: v })} label="Remind me about overdue and due-today To-Dos"
          hint="Once a day, only when there's something due. Sent to the bell, and pushed if that's on above." />
        {prefs.daily_reminder && (
          <label className="row" style={{ gap: 8 }}><span className="small">At</span>
            <input className="input input-sm" type="time" step={900} value={prefs.reminder_time} onChange={(e) => e.target.value && save({ reminder_time: e.target.value })} />
            <span className="small muted">company time</span>
          </label>
        )}
      </div>

      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
      <button className="btn" onClick={test}><Send size={16} />Send me a test notification</button>
    </div>
  );
}
