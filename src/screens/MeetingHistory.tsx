import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, ChevronLeft, Square, Star, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { fmtDateTime, fmtDay, useMembers, useOpenParam } from "../lib/data";
import { mmss, type MeetingRow, type Session, type SessionAgenda } from "../lib/meetings";
import { Empty } from "../components/ui";
import { Sheet } from "../components/Sheet";

export function MeetingHistory() {
  const { id } = useParams();
  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    supabase.from("ss_meetings").select("*").eq("id", id).maybeSingle().then(({ data }) => setMeeting(data as MeetingRow | null));
    supabase.from("ss_meeting_sessions").select("*").eq("meeting_id", id).eq("status", "ended").is("deleted_at", null).order("started_at", { ascending: false })
      .then(({ data }) => setSessions((data ?? []) as Session[]));
  }, [id, reload]);
  const toBin = async (s: Session) => {
    if (!confirm(`Move the ${fmtDay(s.started_at, true)} meeting to the recycle bin? Its To-Dos and Issues stay.`)) return;
    const { error } = await supabase.from("ss_meeting_sessions").update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    if (error) setError(friendlyError(error)); else { setOpen(null); setReload((n) => n + 1); }
  };
  useOpenParam(sessions, "ss_meeting_sessions", setOpen);

  const ratings = (sessions ?? []).map((s) => s.summary?.average_rating).filter((x): x is number => typeof x === "number");
  return (
    <div className="stack">
      <Link to={id ? `/meetings/${id}` : "/meetings"} className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />{meeting?.title ?? "Meetings"}</Link>
      <h1>Past Meetings</h1>
      {error && <p className="error">{error}</p>}
      {ratings.length > 0 && <p className="small muted">Average rating over {ratings.length} meeting{ratings.length === 1 ? "" : "s"}: <strong>{(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}</strong></p>}
      {sessions === null ? <p className="muted">Loading…</p> : sessions.length === 0 ? <Empty>No finished meetings yet.</Empty> : (
        <ul className="card list">
          {sessions.map((s) => (
            <li key={s.id} className="clickable" onClick={() => setOpen(s)} style={{ flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <div className="item-title">{fmtDateTime(s.started_at)}</div>
                <div className="small muted">{s.summary ? `${s.summary.minutes} min · ${s.summary.attendees.length} there · ${s.summary.issues_solved.length} Issue${s.summary.issues_solved.length === 1 ? "" : "s"} resolved · To-Dos ${s.summary.todos_total ? Math.round((s.summary.todos_done / s.summary.todos_total) * 100) : 0}% done` : ""}</div>
              </div>
              {s.summary?.average_rating != null && <span className="badge badge-green"><Star size={12} style={{ verticalAlign: -1 }} /> {s.summary.average_rating}</span>}
              <button className="btn btn-sm btn-ghost" aria-label="Move to recycle bin" title="Move to recycle bin" onClick={(e) => { e.stopPropagation(); toBin(s); }}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {open && <RecapSheet session={open} onClose={() => setOpen(null)} onBin={() => toBin(open)} />}
    </div>
  );
}

function RecapSheet({ session, onClose, onBin }: { session: Session; onClose: () => void; onBin: () => void }) {
  const { byId } = useMembers();
  const [agenda, setAgenda] = useState<SessionAgenda[]>([]);
  useEffect(() => {
    supabase.from("ss_session_agenda").select("*").eq("session_id", session.id).order("sort_order").then(({ data }) => setAgenda((data ?? []) as SessionAgenda[]));
  }, [session.id]);
  const r = session.summary;
  return (
    <Sheet title={`Meeting · ${fmtDay(session.started_at, true)}`} onClose={onClose}>
      {!r ? <p className="muted">No recap was saved for this meeting.</p> : (
        <div className="stack">
          <div className="row wrap">
            <span className="badge">{r.minutes} min</span>
            {r.average_rating != null && <span className="badge badge-green">Rating {r.average_rating}</span>}
            <span className="badge">To-Dos {r.todos_total ? Math.round((r.todos_done / r.todos_total) * 100) : 0}% done</span>
            <span className="badge">{r.headlines} Headlines</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h3>Who was there</h3>
            <div className="row wrap small">{r.ratings.map((x) => <span key={x.member_id} className="badge">{byId(x.member_id)?.first_name ?? "Someone"}: {x.rating ?? "–"}</span>)}</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h3>Issues resolved <span className="count">{r.issues_solved.length}</span></h3>
            {r.issues_solved.map((i) => <div key={i.id} className="row small"><Check size={14} color="var(--color-brand)" />{i.title}</div>)}
            {!r.issues_solved.length && <p className="small muted">None.</p>}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h3>New To-Dos <span className="count">{r.todos_created.length}</span></h3>
            {r.todos_created.map((t) => <div key={t.id} className="row small"><Square size={14} /><span style={{ flex: 1 }}>{t.title}</span>
              <span className="muted">{byId(t.owner_member_id)?.first_name} · {fmtDay(t.due_date)}</span></div>)}
            {!r.todos_created.length && <p className="small muted">None.</p>}
          </div>
          {agenda.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h3>Time per section</h3>
              {agenda.map((a) => (
                <div key={a.id} className={`row small${a.seconds_spent > a.minutes * 60 ? " overdue" : ""}`}>
                  <span style={{ flex: 1 }}>{a.title}</span><span>{mmss(a.seconds_spent)} of {a.minutes}:00</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="btn btn-sm btn-danger" style={{ marginTop: 16 }} onClick={onBin}><Trash2 size={16} />Move to recycle bin</button>
    </Sheet>
  );
}
