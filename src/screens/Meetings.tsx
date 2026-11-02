import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, History as HistoryIcon, Pencil, Play, Plus, Radio, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, isoDay, nextMeeting, useMembers } from "../lib/data";
import {
  AGENDA_LABEL, CADENCE, MEETING_TYPE, STANDARD_AGENDA, type AgendaItem, type AgendaType, type MeetingRow, type Session,
} from "../lib/meetings";
import { Avatar, DateInput, Empty, Fold, Menu, OwnerChips } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { History } from "../components/History";

export function Meetings() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null);
  const [running, setRunning] = useState<Session[]>([]);
  const [creating, setCreating] = useState(false);

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
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} />New Meeting</button>
      </div>
      {meetings === null ? <p className="muted">Loading…</p> : meetings.length === 0 ? <Empty>No meetings yet.</Empty> : (
        <ul className="card list">
          {meetings.map((m) => {
            const live = running.find((s) => s.meeting_id === m.id);
            const next = nextMeeting(m);
            return (
              <li key={m.id} className="clickable" onClick={() => navigate(`/meetings/${m.id}`)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{m.title}</div>
                  <div className="small muted">{MEETING_TYPE[m.meeting_type]} · {CADENCE[m.cadence]}{next ? ` · next ${fmtDateTime(next)}` : ""}</div>
                </div>
                {live
                  ? <button className="btn btn-sm btn-primary pulse" onClick={(e) => { e.stopPropagation(); navigate(`/meetings/${m.id}/live`); }}><Radio size={16} />Join</button>
                  : <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); navigate(`/meetings/${m.id}/live`); }}><Play size={16} />Start</button>}
                <ChevronRight size={18} className="muted no-print" />
              </li>
            );
          })}
        </ul>
      )}
      {creating && <MeetingSheet meeting={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/meetings/${id}`)} />}
    </div>
  );
}

type MeetingFold = "invited" | "history";

/** One meeting: when it meets, its agenda (the main thing), who's invited and its change history. */
export function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company } = useMe();
  const { active, members, byId } = useMembers();
  const [m, setM] = useState<MeetingRow | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editItem, setEditItem] = useState<string | null>(null);
  const [open, setOpen] = useState<MeetingFold | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(5);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data }, { data: a }, { data: inv }, { data: s }] = await Promise.all([
      supabase.from("ss_meetings").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
      supabase.from("ss_agenda_items").select("*").eq("meeting_id", id).order("sort_order"),
      supabase.from("ss_meeting_invitees").select("member_id").eq("meeting_id", id),
      supabase.from("ss_meeting_sessions").select("id").eq("meeting_id", id).eq("status", "running"),
    ]);
    if (!data) { setError("That meeting wasn't found."); return; }
    setM(data as MeetingRow);
    setAgenda((a ?? []) as AgendaItem[]);
    setInvitees((inv ?? []).map((r) => r.member_id as string));
    setLive(!!s?.length);
    setHistoryKey((k) => k + 1);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (q: PromiseLike<{ error: unknown }>) => {
    const { error } = await q;
    if (error) setError(friendlyError(error)); else setError("");
    await load();
    return error ? friendlyError(error) : "";
  };

  if (!m) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const patchItem = (a: AgendaItem, change: Partial<AgendaItem>) => {
    setAgenda((list) => list.map((x) => (x.id === a.id ? { ...x, ...change } : x)));
    return run(supabase.from("ss_agenda_items").update(change).eq("id", a.id));
  };
  const move = async (i: number, by: number) => {
    const a = agenda[i], b = agenda[i + by];
    if (!a || !b) return;
    await supabase.from("ss_agenda_items").update({ sort_order: b.sort_order }).eq("id", a.id);
    await run(supabase.from("ss_agenda_items").update({ sort_order: a.sort_order === b.sort_order ? b.sort_order + 1 : a.sort_order }).eq("id", b.id));
  };
  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await run(supabase.from("ss_agenda_items").insert({ company_id: company.id, meeting_id: m.id, sort_order: (agenda.at(-1)?.sort_order ?? -1) + 1,
      item_type: "custom", title: newTitle.trim(), minutes: newMinutes, fill_time: false }));
    setNewTitle(""); setNewMinutes(5);
  };
  const setInvited = async (ids: string[]) => {
    const added = ids.filter((x) => !invitees.includes(x)), gone = invitees.filter((x) => !ids.includes(x));
    setInvitees(ids);
    if (gone.length) await supabase.from("ss_meeting_invitees").delete().eq("meeting_id", m.id).in("member_id", gone);
    if (added.length) await run(supabase.from("ss_meeting_invitees").insert(added.map((x) => ({ company_id: company.id, meeting_id: m.id, member_id: x }))));
    else await load();
  };
  const toBin = async () => {
    if (!confirm("Remove this meeting? Its Goals, To-Dos and Issues stay.")) return;
    const { error } = await supabase.from("ss_meetings").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (error) setError(friendlyError(error)); else navigate("/meetings");
  };

  const next = nextMeeting(m);
  const total = agenda.reduce((n, a) => n + a.minutes, 0);
  const toggle = (f: MeetingFold) => setOpen(open === f ? null : f);
  const invited = invitees.map((x) => byId(x)).filter(Boolean);

  return (
    <div className="stack goal-page" style={{ maxWidth: 760 }}>
      <div className="row">
        <Link to="/meetings" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Meetings</Link>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>
        <Menu items={[
          { label: "Past Meetings", icon: <HistoryIcon size={16} />, onSelect: () => navigate(`/meetings/${m.id}/history`) },
          { label: "Remove meeting", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{m.title}</h1>
          {live
            ? <button className="btn btn-sm btn-primary pulse" onClick={() => navigate(`/meetings/${m.id}/live`)}><Radio size={16} />Join</button>
            : <button className="btn btn-sm btn-primary" onClick={() => navigate(`/meetings/${m.id}/live`)}><Play size={16} />Start</button>}
        </div>
        <div className="goal-meta">
          <span>{MEETING_TYPE[m.meeting_type]}</span>
          <span>{CADENCE[m.cadence]}</span>
          <span>{next ? `Next ${fmtDateTime(next)}` : "No date set"}</span>
          {m.is_leadership && <span className="badge badge-green">Leadership</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="avatar-stack">{invited.slice(0, 6).map((x) => <Avatar key={x!.id} m={x} size={26} />)}</span>
          <span className="small muted">{invited.length} invited · {total} min</span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="steps-head">Agenda<span className="count">{total} min</span></h2>
        <div className="card">
          {agenda.length === 0 && <p className="small muted card-pad" style={{ margin: 0 }}>No sections yet.</p>}
          <ol className="list steps process-list">
            {agenda.map((a, i) => editItem === a.id ? (
              <li key={a.id} className="step-editing">
                <span className="step-num">{i + 1}</span>
                <div className="step-fields">
                  <input className="input" defaultValue={a.title} aria-label="Section title" autoFocus
                    onBlur={(e) => e.target.value.trim() !== a.title && patchItem(a, { title: e.target.value.trim() || AGENDA_LABEL[a.item_type] })} />
                  <div className="grid-2">
                    <label className="field"><span>Kind</span>
                      <select className="select" value={a.item_type} onChange={(e) => patchItem(a, { item_type: e.target.value as AgendaType })}>
                        {Object.entries(AGENDA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Minutes</span>
                      <input className="input" type="number" min={0} max={600} inputMode="numeric" defaultValue={a.minutes}
                        onBlur={(e) => { const n = Math.max(0, Math.min(600, Number(e.target.value) || 0)); if (n !== a.minutes) patchItem(a, { minutes: n }); }} />
                    </label>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                    <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === agenda.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                    <button className="btn btn-ghost btn-sm btn-danger" aria-label="Remove section"
                      onClick={() => { if (confirm("Remove this section?")) { setEditItem(null); run(supabase.from("ss_agenda_items").delete().eq("id", a.id)); } }}><Trash2 size={16} /></button>
                    <span className="spacer" />
                    <button className="btn btn-sm" onClick={() => setEditItem(null)}>Done</button>
                  </div>
                </div>
              </li>
            ) : (
              <li key={a.id}>
                <span className="step-num">{i + 1}</span>
                <button type="button" className="step-view agenda-view" onClick={() => setEditItem(a.id)} aria-label={`Edit section: ${a.title}`}>
                  <span className="step-text">{a.title}</span>
                  <span className="small muted nowrap">{a.minutes} min{a.fill_time ? " · uses spare time" : ""}</span>
                </button>
              </li>
            ))}
          </ol>
          <form className="step-add" onSubmit={addItem}>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" placeholder="Add a section…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label="New section" />
              <input className="input minutes-input" type="number" min={0} max={600} inputMode="numeric" value={newMinutes} aria-label="Minutes"
                onChange={(e) => setNewMinutes(Math.max(0, Math.min(600, Number(e.target.value) || 0)))} />
              <button className="btn btn-sm btn-primary" disabled={!newTitle.trim()}><Plus size={16} />Add</button>
            </div>
          </form>
        </div>
      </section>

      <div className="card folds">
        <Fold title="Who's Invited" count={invitees.length} open={open === "invited"} onToggle={() => toggle("invited")}>
          <OwnerChips members={active} value={invitees} onChange={setInvited} />
        </Fold>
        <Fold title="History" open={open === "history"} onToggle={() => toggle("history")}>
          <History key={historyKey} table="ss_meetings" rowId={m.id} childKey="meeting_id" members={members} />
        </Fold>
      </div>

      {editing && <MeetingSheet meeting={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

/** New Meeting (with the standard agenda and everyone invited) or Edit Meeting: the basics only. */
function MeetingSheet({ meeting, onClose, onSaved }: { meeting: MeetingRow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const local = meeting?.first_meeting_at ? new Date(meeting.first_meeting_at) : null;
  const [form, setForm] = useState({
    title: meeting?.title ?? "", meeting_type: meeting?.meeting_type ?? ("weekly" as MeetingRow["meeting_type"]),
    cadence: meeting?.cadence ?? ("weekly" as MeetingRow["cadence"]), is_leadership: meeting?.is_leadership ?? false,
    day: local ? isoDay(local) : null as string | null,
    time: local ? `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}` : "08:00",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true); setError("");
    try {
      const first = form.day ? new Date(`${form.day}T${form.time || "08:00"}:00`).toISOString() : null;
      const row = { title: form.title.trim(), meeting_type: form.meeting_type, cadence: form.cadence, is_leadership: form.is_leadership, first_meeting_at: first };
      if (meeting) {
        const { error } = await supabase.from("ss_meetings").update(row).eq("id", meeting.id);
        if (error) throw error;
        onSaved(meeting.id);
        return;
      }
      const { data, error } = await supabase.from("ss_meetings").insert({ ...row, company_id: company.id, owner_member_id: me.id }).select("id").single();
      if (error) throw error;
      const id = data.id as string;
      await supabase.from("ss_scorecards").insert({ company_id: company.id, meeting_id: id });
      const { error: e1 } = await supabase.from("ss_agenda_items").insert(STANDARD_AGENDA.map((a, i) => ({
        company_id: company.id, meeting_id: id, sort_order: i, item_type: a.item_type, title: a.title, minutes: a.minutes, fill_time: !!a.fill_time })));
      if (e1) throw e1;
      if (active.length) {
        const { error: e2 } = await supabase.from("ss_meeting_invitees").insert(active.map((x) => ({ company_id: company.id, meeting_id: id, member_id: x.id })));
        if (e2) throw e2;
      }
      onSaved(id);
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  return (
    <Sheet title={meeting ? "Edit Meeting" : "New Meeting"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Title</span><input className="input" required value={form.title} autoFocus={!meeting} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
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
          <div className="field"><span>First (or next) date</span><DateInput label="Meeting date" value={form.day} onChange={(v) => setForm({ ...form, day: v })} /></div>
          <label className="field"><span>Time</span><input className="input" type="time" step={900} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_leadership} onChange={(e) => setForm({ ...form, is_leadership: e.target.checked })} />Leadership team meeting
        </label>
        {!meeting && <p className="small muted">It starts with the standard agenda and everyone invited; change either on the meeting's page.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : meeting ? "Save" : "Create Meeting"}</button>
      </form>
    </Sheet>
  );
}
