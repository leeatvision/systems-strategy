import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, History, Play, Plus, Radio, Settings, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, isoDay, nextMeeting, useMembers } from "../lib/data";
import {
  AGENDA_LABEL, CADENCE, MEETING_TYPE, STANDARD_AGENDA, type AgendaItem, type AgendaType, type MeetingRow, type Session,
} from "../lib/meetings";
import { Empty, OwnerChips } from "../components/ui";
import { Sheet } from "../components/Sheet";

export function Meetings() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null);
  const [running, setRunning] = useState<Session[]>([]);
  const [editing, setEditing] = useState<MeetingRow | "new" | null>(null);

  const load = useCallback(async () => {
    const [{ data: m }, { data: s }] = await Promise.all([
      supabase.from("ss_meetings").select("*").is("deleted_at", null).order("created_at"),
      supabase.from("ss_meeting_sessions").select("*").eq("status", "running"),
    ]);
    setMeetings((m ?? []) as MeetingRow[]);
    setRunning((s ?? []) as Session[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Meetings</h1>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={16} />New meeting</button>
      </div>
      {meetings === null ? <p className="muted">Loading…</p> : meetings.length === 0 ? <Empty>No meetings yet.</Empty> : (
        <ul className="card list">
          {meetings.map((m) => {
            const live = running.find((s) => s.meeting_id === m.id);
            const next = nextMeeting(m);
            return (
              <li key={m.id} style={{ flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div className="item-title">{m.title}</div>
                  <div className="small muted">{MEETING_TYPE[m.meeting_type]} · {CADENCE[m.cadence]}{next ? ` · next ${fmtDateTime(next)}` : ""}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" aria-label="Settings" title="Settings" onClick={() => setEditing(m)}><Settings size={18} /></button>
                  <Link className="btn btn-sm btn-ghost" to={`/meetings/${m.id}/history`} aria-label="History" title="History"><History size={18} /></Link>
                  {live
                    ? <button className="btn btn-sm btn-primary pulse" onClick={() => navigate(`/meetings/${m.id}/live`)}><Radio size={16} />Join live</button>
                    : <button className="btn btn-sm btn-primary" onClick={() => navigate(`/meetings/${m.id}/live`)}><Play size={16} />Start</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <MeetingSheet meeting={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

type DraftItem = Pick<AgendaItem, "item_type" | "title" | "minutes" | "fill_time"> & { id?: string };

function MeetingSheet({ meeting, onClose, onSaved }: { meeting: MeetingRow | null; onClose: () => void; onSaved: () => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const local = meeting?.first_meeting_at ? new Date(meeting.first_meeting_at) : null;
  const [form, setForm] = useState({
    title: meeting?.title ?? "", meeting_type: meeting?.meeting_type ?? ("weekly" as MeetingRow["meeting_type"]),
    cadence: meeting?.cadence ?? ("weekly" as MeetingRow["cadence"]), is_leadership: meeting?.is_leadership ?? false,
    day: local ? isoDay(local) : "", time: local ? `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}` : "08:00",
  });
  const [agenda, setAgenda] = useState<DraftItem[]>(meeting ? [] : STANDARD_AGENDA.map((a) => ({ ...a, fill_time: !!a.fill_time })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [invitees, setInvitees] = useState<string[]>(meeting ? [] : active.map((m) => m.id));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meeting) { if (!invitees.length) setInvitees(active.map((m) => m.id)); return; }
    supabase.from("ss_agenda_items").select("*").eq("meeting_id", meeting.id).order("sort_order")
      .then(({ data }) => setAgenda((data ?? []) as AgendaItem[]));
    supabase.from("ss_meeting_invitees").select("member_id").eq("meeting_id", meeting.id)
      .then(({ data }) => setInvitees((data ?? []).map((r) => r.member_id as string)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, active.length]);

  const total = agenda.reduce((n, a) => n + a.minutes, 0);
  const patch = (i: number, change: Partial<DraftItem>) => setAgenda(agenda.map((a, j) => (j === i ? { ...a, ...change } : a)));
  const move = (i: number, by: number) => {
    const next = [...agenda];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setAgenda(next);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true); setError("");
    try {
      const first = form.day ? new Date(`${form.day}T${form.time || "08:00"}:00`).toISOString() : null;
      const row = { title: form.title.trim(), meeting_type: form.meeting_type, cadence: form.cadence, is_leadership: form.is_leadership, first_meeting_at: first };
      let id = meeting?.id;
      if (meeting) {
        const { error } = await supabase.from("ss_meetings").update(row).eq("id", meeting.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ss_meetings").insert({ ...row, company_id: company.id, owner_member_id: me.id }).select("id").single();
        if (error) throw error;
        id = data.id;
        await supabase.from("ss_scorecards").insert({ company_id: company.id, meeting_id: id });
      }
      if (removed.length) await supabase.from("ss_agenda_items").delete().in("id", removed);
      for (const [i, a] of agenda.entries()) {
        const fields = { sort_order: i, item_type: a.item_type, title: a.title.trim() || AGENDA_LABEL[a.item_type], minutes: a.minutes, fill_time: a.fill_time };
        const { error } = a.id
          ? await supabase.from("ss_agenda_items").update(fields).eq("id", a.id)
          : await supabase.from("ss_agenda_items").insert({ ...fields, company_id: company.id, meeting_id: id });
        if (error) throw error;
      }
      await supabase.from("ss_meeting_invitees").delete().eq("meeting_id", id!);
      if (invitees.length) {
        const { error } = await supabase.from("ss_meeting_invitees").insert(invitees.map((m) => ({ company_id: company.id, meeting_id: id, member_id: m })));
        if (error) throw error;
      }
      onSaved();
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  const toBin = async () => {
    if (!meeting || !confirm("Remove this meeting? Its Goals, To-Dos and Issues stay.")) return;
    const { error } = await supabase.from("ss_meetings").update({ deleted_at: new Date().toISOString() }).eq("id", meeting.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  return (
    <Sheet title={meeting ? "Meeting settings" : "New meeting"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Title</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field"><span>Type</span>
            <select className="select" value={form.meeting_type} onChange={(e) => setForm({ ...form, meeting_type: e.target.value as MeetingRow["meeting_type"] })}>
              {Object.entries(MEETING_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field"><span>Repeats</span>
            <select className="select" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as MeetingRow["cadence"] })}>
              {Object.entries(CADENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field"><span>First (or next) date</span><input className="input" type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></label>
          <label className="field"><span>Time</span><input className="input" type="time" step={900} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_leadership} onChange={(e) => setForm({ ...form, is_leadership: e.target.checked })} />Leadership team meeting
        </label>

        <div className="stack" style={{ gap: 6 }}>
          <div className="row"><h3>Agenda</h3><span className="spacer" /><span className="small muted">{total} min</span></div>
          {agenda.map((a, i) => (
            <div key={a.id ?? `new-${i}`} className="agenda-row">
              <input className="input" value={a.title} aria-label="Section title" onChange={(e) => patch(i, { title: e.target.value })} />
              <select className="select" value={a.item_type} aria-label="Section type" onChange={(e) => patch(i, { item_type: e.target.value as AgendaType })}>
                {Object.entries(AGENDA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input className="input" type="number" min={0} max={600} value={a.minutes} aria-label="Minutes" onChange={(e) => patch(i, { minutes: Math.max(0, Number(e.target.value) || 0) })} />
              <div className="row" style={{ gap: 0 }}>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === agenda.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove section"
                  onClick={() => { if (a.id) setRemoved([...removed, a.id]); setAgenda(agenda.filter((_, j) => j !== i)); }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setAgenda([...agenda, { item_type: "custom", title: "", minutes: 5, fill_time: false }])}><Plus size={16} />Add section</button>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <h3>Who's invited</h3>
          <OwnerChips members={active} value={invitees} onChange={setInvitees} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{meeting ? "Save" : "Create meeting"}</button>
        {meeting && <button type="button" className="btn btn-sm btn-danger" onClick={toBin}><Trash2 size={16} />Remove meeting</button>}
      </form>
    </Sheet>
  );
}
