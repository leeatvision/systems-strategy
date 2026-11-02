import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlarmClock, BarChart3, CalendarClock, MessageSquare, Mountain, Plus, SquareCheck, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { useMeetings, useMembers } from "../lib/data";
import { Empty, OwnerChips } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Kind = "key_numbers" | "todos_due" | "goal_check_in" | "meeting_coming_up" | "custom";
interface Reminder {
  id: string; company_id: string; kind: Kind; message: string | null; everyone: boolean; member_ids: string[];
  timing: "before_meeting" | "weekly"; meeting_id: string | null; days_before: number; weekdays: number[]; at_time: string; enabled: boolean;
}

export const KINDS: Record<Kind, { label: string; about: string; icon: typeof AlarmClock }> = {
  key_numbers: { label: "Key Numbers to Enter", about: "Their weekly Key Numbers still empty for the next meeting, by name.", icon: BarChart3 },
  todos_due: { label: "To-Dos Due", about: "Their overdue To-Dos and those due in the next 7 days, by name.", icon: SquareCheck },
  goal_check_in: { label: "Goal Check-In", about: "How many Goals they have open, which are off track, and steps due or late.", icon: Mountain },
  meeting_coming_up: { label: "Meeting Coming Up", about: "The meeting, its day and time, and the top open Issues on its list.", icon: CalendarClock },
  custom: { label: "Custom Message", about: "Your own words, as written.", icon: MessageSquare },
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function Reminders() {
  const { isOwner, me } = useMe();
  const { byId } = useMembers();
  const { meetings } = useMeetings();
  const [list, setList] = useState<Reminder[] | null>(null);
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_reminders").select("*").order("created_at");
    setList((data ?? []) as Reminder[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: Reminder) => {
    setList((l) => l?.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) ?? null);
    const { error } = await supabase.from("ss_reminders").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) setError(friendlyError(error));
    load();
  };
  const when = (r: Reminder) => r.timing === "weekly"
    ? `${r.weekdays.length === 7 ? "Every day" : [...r.weekdays].sort().map((d) => DAYS[d]).join(", ")} · ${fmtTime(r.at_time)}`
    : `${r.days_before === 0 ? "Day of" : `${r.days_before} day${r.days_before === 1 ? "" : "s"} before`} ${meetings.find((m) => m.id === r.meeting_id)?.title ?? "the meeting"} · ${fmtTime(r.at_time)}`;
  const who = (r: Reminder) => r.everyone ? "Everyone" : r.member_ids.map((id) => byId(id)?.first_name).filter(Boolean).join(", ") || "No one";

  return (
    <div className="stack">
      <div className="page-head goals-head">
        <h1>Reminders</h1>
        <span className="spacer" />
        {isOwner && <button className="btn btn-primary btn-sm desktop-only" onClick={() => setEditing("new")}><Plus size={16} />New Reminder</button>}
      </div>
      <p className="small muted">Each reminder goes to people's Notifications and phones, filled in with their own To-Dos, Goals, Key Numbers or meeting. If someone has nothing to report, theirs is skipped.{isOwner ? "" : " Owners set reminders up."}</p>
      {error && <p className="error">{error}</p>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty>No reminders yet.{isOwner ? " Add one to nudge people before the meeting." : ""}</Empty> : (
        <ul className="card list">
          {list.map((r) => {
            const K = KINDS[r.kind];
            const mine = r.everyone || r.member_ids.includes(me.id);
            return (
              <li key={r.id} className={isOwner ? "clickable" : ""} onClick={() => isOwner && setEditing(r)}>
                <K.icon size={20} color="var(--color-fg-muted)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{K.label}{r.kind === "custom" && r.message ? <span className="muted" style={{ fontWeight: 400 }}> · {r.message.slice(0, 60)}</span> : null}</div>
                  <div className="small muted">{when(r)} · {who(r)}{!isOwner && mine ? " · you get this" : ""}</div>
                </div>
                {isOwner
                  ? <button type="button" className={`switch${r.enabled ? " switch-on" : ""}`} role="switch" aria-checked={r.enabled} aria-label={r.enabled ? "Turn off" : "Turn on"}
                      onClick={(e) => { e.stopPropagation(); toggle(r); }}><span /></button>
                  : <span className={`badge ${r.enabled ? "badge-green" : ""}`}>{r.enabled ? "On" : "Off"}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="small muted">Phone pushes for reminders can be turned off per person in Notification settings.</p>
      {isOwner && <>
        <div className="fab-space" aria-hidden />
        <button type="button" className="fab no-print" onClick={() => setEditing("new")} aria-label="New Reminder"><Plus size={20} />New Reminder</button>
      </>}
      {editing && <ReminderSheet r={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ReminderSheet({ r, onClose, onSaved }: { r: Reminder | null; onClose: () => void; onSaved: () => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const { meetings, defaultMeetingId } = useMeetings();
  const [form, setForm] = useState(() => ({
    kind: r?.kind ?? ("key_numbers" as Kind), message: r?.message ?? "", everyone: r?.everyone ?? true, member_ids: r?.member_ids ?? [],
    timing: r?.timing ?? ("before_meeting" as Reminder["timing"]), meeting_id: r?.meeting_id ?? defaultMeetingId ?? meetings[0]?.id ?? null,
    days_before: r?.days_before ?? 1, weekdays: r?.weekdays ?? [1], at_time: (r?.at_time ?? "16:00").slice(0, 5),
  }));
  const [previewFor, setPreviewFor] = useState(me.id);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((f) => ({ ...f, [k]: v })); setError(""); };
  useEffect(() => { if (!form.meeting_id && (defaultMeetingId || meetings[0])) set("meeting_id", defaultMeetingId ?? meetings[0].id); }, [defaultMeetingId, meetings.length]); // fill once meetings load

  // What it would say to the chosen person today, from their real items.
  useEffect(() => {
    let live = true;
    setPreview(undefined);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("ss_reminder_preview", {
        p_kind: form.kind, p_member: previewFor, p_meeting: form.timing === "before_meeting" ? form.meeting_id : null, p_message: form.message || null,
      });
      if (live) setPreview(error ? `Couldn't preview: ${friendlyError(error)}` : typeof data === "string" ? data : null);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [form.kind, form.message, form.timing, form.meeting_id, previewFor]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (form.kind === "custom" && !form.message.trim()) { setError("Write the message."); return; }
    if (!form.everyone && !form.member_ids.length) { setError("Choose who gets it."); return; }
    if (form.timing === "weekly" && !form.weekdays.length) { setError("Choose at least one day."); return; }
    if (form.timing === "before_meeting" && !form.meeting_id) { setError("Choose the meeting."); return; }
    if (form.at_time > "21:45") { setError("Choose a time before 9:45 PM."); return; }
    setBusy(true);
    const row = { ...form, message: form.message.trim() || null, member_ids: form.everyone ? [] : form.member_ids };
    const { error } = r ? await supabase.from("ss_reminders").update(row).eq("id", r.id)
      : await supabase.from("ss_reminders").insert({ ...row, company_id: company.id, created_by: me.id });
    setBusy(false);
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const remove = async () => {
    if (!r || !confirm("Delete this reminder?")) return;
    const { error } = await supabase.from("ss_reminders").delete().eq("id", r.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const recipients = form.everyone ? active : active.filter((m) => form.member_ids.includes(m.id));

  return (
    <Sheet title={r ? "Edit Reminder" : "New Reminder"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>What it's about</span>
          <select className="select" value={form.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
            {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
          </select>
          <span className="small muted" style={{ fontWeight: 400 }}>{KINDS[form.kind].about}</span>
        </label>

        <div className="field"><span>Who gets it</span>
          <div className="chips">
            <button type="button" className={`chip${form.everyone ? " chip-on" : ""}`} onClick={() => set("everyone", true)}>Everyone</button>
            <button type="button" className={`chip${!form.everyone ? " chip-on" : ""}`} onClick={() => set("everyone", false)}>Choose people</button>
          </div>
          {!form.everyone && <OwnerChips members={active} value={form.member_ids} onChange={(v) => set("member_ids", v)} />}
        </div>

        <div className="field"><span>When</span>
          <div className="chips">
            <button type="button" className={`chip${form.timing === "before_meeting" ? " chip-on" : ""}`} onClick={() => set("timing", "before_meeting")}>Before a meeting</button>
            <button type="button" className={`chip${form.timing === "weekly" ? " chip-on" : ""}`} onClick={() => set("timing", "weekly")}>On set days</button>
          </div>
        </div>
        {form.timing === "before_meeting" ? (
          <div className="grid-2">
            <label className="field"><span>Meeting</span>
              <select className="select" value={form.meeting_id ?? ""} onChange={(e) => set("meeting_id", e.target.value)}>
                {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
            <label className="field"><span>Day</span>
              <select className="select" value={form.days_before} onChange={(e) => set("days_before", Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d === 0 ? "Day of the meeting" : `${d} day${d === 1 ? "" : "s"} before`}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="chips" role="group" aria-label="Days">
            {DAYS.map((d, i) => {
              const on = form.weekdays.includes(i);
              return <button key={d} type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on}
                onClick={() => set("weekdays", on ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i])}>{d}</button>;
            })}
          </div>
        )}
        <label className="field"><span>Time</span>
          <input className="input" type="time" step={900} value={form.at_time} onChange={(e) => set("at_time", e.target.value)} style={{ maxWidth: 180 }} />
        </label>

        <label className="field"><span>{form.kind === "custom" ? "Message" : "Note to add (optional)"}</span>
          <textarea className="input textarea" rows={2} maxLength={500} value={form.message} onChange={(e) => set("message", e.target.value)}
            placeholder={form.kind === "custom" ? "e.g. Bring your Goal updates to Tuesday's meeting." : "Shown above their details"} />
        </label>

        <div className="preview-box">
          <div className="row" style={{ gap: 8 }}>
            <span className="small" style={{ fontWeight: 600 }}>Preview for</span>
            <select className="select select-sm" style={{ width: "auto" }} value={previewFor} onChange={(e) => setPreviewFor(e.target.value)} aria-label="Preview for">
              {(recipients.some((m) => m.id === me.id) ? recipients : [...recipients, ...active.filter((m) => m.id === me.id)]).map((m) =>
                <option key={m.id} value={m.id}>{m.id === me.id ? `${fullName(m)} (you)` : fullName(m)}</option>)}
            </select>
          </div>
          <div className="preview-note">
            <strong>{KINDS[form.kind].label === "Custom Message" ? "Reminder" : KINDS[form.kind].label}</strong>
            <p>{preview === undefined ? "…" : preview ?? <span className="muted">Nothing to report for them today, so they'd be skipped.</span>}</p>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Uses today's information; when it goes out it uses that day's.</p>
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : r ? "Save" : "Add Reminder"}</button>
        {r && <button type="button" className="btn btn-sm btn-danger" onClick={remove}><Trash2 size={16} />Delete reminder</button>}
      </form>
    </Sheet>
  );
}
