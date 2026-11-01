import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlarmClock, AtSign, BellRing, CheckCheck, Mail, MailOpen, Settings, Trash2, UserPlus } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, useMembers } from "../lib/data";
import { itemLink, notificationsChanged, type Notification } from "../lib/notifications";
import { Empty } from "../components/ui";

const WHAT: Record<string, string> = { goal: "a Goal", todo: "a To-Do", issue: "an Issue", headline: "a Headline", process: "a Process" };

export function Notifications() {
  const { me } = useMe();
  const { byId } = useMembers();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_notifications").select("*").eq("recipient_id", me.id)
      .order("created_at", { ascending: false }).limit(100);
    setItems((data ?? []) as Notification[]);
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  const open = async (n: Notification) => {
    if (!n.read_at) {
      await supabase.from("ss_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      notificationsChanged();
    }
    navigate(itemLink(n.item_type, n.item_id));
  };
  const setRead = async (n: Notification, read: boolean) => {
    const read_at = read ? new Date().toISOString() : null;
    setItems((l) => l?.map((x) => (x.id === n.id ? { ...x, read_at } : x)) ?? null);
    const { error } = await supabase.from("ss_notifications").update({ read_at }).eq("id", n.id);
    if (error) { setError(friendlyError(error)); load(); }
    notificationsChanged();
  };
  const remove = async (n: Notification) => {
    setItems((l) => l?.filter((x) => x.id !== n.id) ?? null);
    const { error } = await supabase.from("ss_notifications").delete().eq("id", n.id);
    if (error) { setError(friendlyError(error)); load(); }
    notificationsChanged();
  };
  const readAll = async () => {
    await supabase.from("ss_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", me.id).is("read_at", null);
    notificationsChanged(); load();
  };

  const unread = items?.filter((n) => !n.read_at).length ?? 0;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Notifications</h1>
        <span className="spacer" />
        {unread > 0 && <button className="btn btn-sm" onClick={readAll}><CheckCheck size={16} />Mark all as read</button>}
        <Link className="btn btn-sm btn-ghost" to="/settings/notifications" aria-label="Notification settings" title="Settings"><Settings size={18} /></Link>
      </div>
      {error && <p className="error">{error}</p>}
      {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? (
        <Empty>Nothing yet. You'll see it here when someone @mentions you or gives you a To-Do.</Empty>
      ) : (
        <ul className="card list">
          {items.map((n) => {
            const who = byId(n.actor_id)?.first_name ?? "Someone";
            const Icon = n.kind === "assigned" ? UserPlus : n.kind === "reminder" ? AlarmClock : n.kind === "test" ? BellRing : AtSign;
            const what = n.kind === "assigned" ? <><strong>{who}</strong> gave you a To-Do</>
              : n.kind === "reminder" ? <><strong>Daily reminder</strong></>
              : n.kind === "test" ? <><strong>Test notification</strong></>
              : <><strong>{who}</strong> mentioned you on {WHAT[n.item_type] ?? "an item"}</>;
            return (
              <li key={n.id} className={`clickable${n.read_at ? "" : " unread"}`} onClick={() => open(n)}>
                <Icon size={18} color="var(--color-fg-muted)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small">{what}</div>
                  <div className="item-title" style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.summary}</div>
                  <div className="small muted">{fmtDateTime(n.created_at)}</div>
                </div>
                {!n.read_at && <span className="dot" aria-label="Unread" />}
                <div className="note-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setRead(n, !n.read_at)}
                    aria-label={n.read_at ? "Mark as unread" : "Mark as read"} title={n.read_at ? "Mark as unread" : "Mark as read"}>
                    {n.read_at ? <Mail size={16} /> : <MailOpen size={16} />}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(n)} aria-label="Delete" title="Delete"><Trash2 size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
