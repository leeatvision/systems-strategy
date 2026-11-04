import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Play, Plus, RotateCcw, Square, SquareCheck } from "lucide-react";
import { friendlyError, fullName, supabase, type Member } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  GOAL_STATUS, addDays, currentQuarter, fmtDateTime, fmtDay, today, useMembers,
  type Headline, type Issue, type Goal, type Todo,
} from "../lib/data";
import { fmtValue, goalText, nearestMeeting, onTrack, parseNumber, recentPeriods, scheduleOf, timeline, type MValue, type Measurable, type Period } from "../lib/scorecard";
import {
  mmss, type AgendaItem, type Attendee, type MeetingRow, type Recap, type Session, type SessionAgenda, type SessionEvent,
} from "../lib/meetings";
import { Avatar, Empty, OwnerSelect, Tick } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { GoalDetail } from "./GoalDetail";
import { TodoSheet } from "./Todos";
import { IssueSheet } from "./Issues";
import { HeadlineSheet } from "./Headlines";

const nowIso = () => new Date().toISOString();

export function MeetingLive() {
  const { id: meetingId } = useParams();
  const { me, company } = useMe();
  const { members, byId } = useMembers();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [template, setTemplate] = useState<AgendaItem[]>([]);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [agenda, setAgenda] = useState<SessionAgenda[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tick, setTick] = useState(0); // bumps when meeting items change, so sections reload
  const [, setClock] = useState(0);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    if (!meetingId) return;
    const { data } = await supabase.from("ss_meeting_sessions").select("*").eq("meeting_id", meetingId).eq("status", "running").maybeSingle();
    const s = (data ?? null) as Session | null;
    setSession(s);
    if (!s) return;
    const [{ data: a }, { data: at }] = await Promise.all([
      supabase.from("ss_session_agenda").select("*").eq("session_id", s.id).order("sort_order"),
      supabase.from("ss_session_attendees").select("*").eq("session_id", s.id).order("joined_at"),
    ]);
    setAgenda((a ?? []) as SessionAgenda[]);
    setAttendees((at ?? []) as Attendee[]);
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) return;
    supabase.from("ss_meetings").select("*").eq("id", meetingId).maybeSingle().then(({ data }) => setMeeting(data as MeetingRow | null));
    supabase.from("ss_agenda_items").select("*").eq("meeting_id", meetingId).order("sort_order").then(({ data }) => setTemplate((data ?? []) as AgendaItem[]));
    loadSession();
  }, [meetingId, loadSession]);

  // Join: everyone who opens a running meeting is counted as attending.
  useEffect(() => {
    if (session && !attendees.some((a) => a.member_id === me.id)) {
      supabase.from("ss_session_attendees").insert({ company_id: company.id, session_id: session.id, member_id: me.id })
        .then(() => loadSession());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, attendees.length]);

  // Live: follow the facilitator and everyone's changes.
  useEffect(() => {
    if (!meetingId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => setTick((t) => t + 1), 250); };
    const ch = supabase.channel(`meeting-${meetingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_meeting_sessions", filter: `meeting_id=eq.${meetingId}` }, () => loadSession())
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_session_agenda" }, () => loadSession())
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_session_attendees" }, () => loadSession())
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_todos", filter: `meeting_id=eq.${meetingId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_issues", filter: `meeting_id=eq.${meetingId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_headlines", filter: `meeting_id=eq.${meetingId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_goals", filter: `meeting_id=eq.${meetingId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_measurable_values" }, bump)
      .subscribe();
    const clock = setInterval(() => setClock((c) => c + 1), 1000);
    return () => { clearTimeout(timer); clearInterval(clock); supabase.removeChannel(ch); };
  }, [meetingId, loadSession]);

  const start = async () => {
    if (!meeting) return;
    setError("");
    const { data, error } = await supabase.from("ss_meeting_sessions")
      .insert({ company_id: company.id, meeting_id: meeting.id, created_by: me.id, scribe_member_id: me.id }).select("*").single();
    if (error) { loadSession(); return; } // someone else started it a moment ago: join theirs
    const s = data as Session;
    const items = template.length ? template : [{ item_type: "custom", title: "Meeting", minutes: 60 } as AgendaItem];
    const { error: aErr } = await supabase.from("ss_session_agenda").insert(items.map((a, i) => ({
      company_id: company.id, session_id: s.id, sort_order: i, item_type: a.item_type, title: a.title, minutes: a.minutes,
      started_at: i === 0 ? nowIso() : null,
    })));
    if (aErr) setError(friendlyError(aErr));
    loadSession();
  };

  /** Move everyone to another section, banking the time spent on this one. */
  const goTo = async (index: number) => {
    if (!session || index < 0 || index >= agenda.length || index === session.current_agenda_index) return;
    const cur = agenda[session.current_agenda_index];
    const spent = cur?.started_at ? Math.round((Date.now() - new Date(cur.started_at).getTime()) / 1000) : 0;
    setSession({ ...session, current_agenda_index: index });
    await Promise.all([
      cur && supabase.from("ss_session_agenda").update({ seconds_spent: cur.seconds_spent + spent, started_at: null }).eq("id", cur.id),
      supabase.from("ss_session_agenda").update({ started_at: nowIso() }).eq("id", agenda[index].id),
      supabase.from("ss_meeting_sessions").update({ current_agenda_index: index }).eq("id", session.id),
    ]);
    loadSession();
  };

  // Keep the current section visible in the scrolling strip on phones.
  useEffect(() => {
    document.querySelector(".live-step.on")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [session?.current_agenda_index]);

  const logEvent = useCallback((item_type: SessionEvent["item_type"], item_id: string, action: SessionEvent["action"]) => {
    if (session) supabase.from("ss_session_events").insert({ company_id: company.id, session_id: session.id, item_type, item_id, action, member_id: me.id }).then(() => {});
  }, [session, company.id, me.id]);

  if (!meeting || session === undefined) return <p className="muted">Loading…</p>;

  if (!session) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <Link to="/meetings" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Meetings</Link>
        <h1>{meeting.title}</h1>
        <div className="card card-pad stack">
          <h2>Agenda · {template.reduce((n, a) => n + a.minutes, 0)} min</h2>
          <ol className="agenda-preview">{template.map((a) => <li key={a.id}><span>{a.title}</span><span className="muted">{a.minutes} min</span></li>)}</ol>
          <button className="btn btn-primary" onClick={start}><Play size={18} />Start meeting</button>
          <p className="small muted">Everyone who opens this meeting while it's running follows along live.</p>
        </div>
        {error && <p className="error">{error}</p>}
        <Link to={`/meetings/${meeting.id}/history`} className="small">Past meetings</Link>
      </div>
    );
  }

  const idx = Math.min(session.current_agenda_index, Math.max(agenda.length - 1, 0));
  const current = agenda[idx];
  const used = (a: SessionAgenda) => a.seconds_spent + (a.started_at ? (Date.now() - new Date(a.started_at).getTime()) / 1000 : 0);
  const left = current ? current.minutes * 60 - used(current) : 0;
  const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000;
  const props: SectionProps = { meeting, session, me, companyId: company.id, members, byId, attendees, tick, logEvent, onError: setError, reload: loadSession };

  return (
    <div className="live">
      <div className="live-head">
        <Link to="/meetings" className="btn btn-sm btn-ghost" aria-label="Leave"><ChevronLeft size={18} /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title">{meeting.title}</div>
          <div className="small muted">Started {fmtDateTime(session.started_at)} · {mmss(elapsed)} in</div>
        </div>
        <div className="avatars">{attendees.map((a) => <Avatar key={a.id} m={byId(a.member_id)} size={28} />)}</div>
      </div>

      <div className="live-body">
        <nav className="live-agenda" aria-label="Agenda">
          {agenda.map((a, i) => {
            const u = used(a);
            return (
              <button key={a.id} className={`live-step${i === idx ? " on" : ""}${u > a.minutes * 60 ? " over" : ""}`} onClick={() => goTo(i)}>
                <span>{a.title}</span><span className="small">{u > 0 ? `${mmss(u)} / ` : ""}{a.minutes}m</span>
              </button>
            );
          })}
        </nav>

        <section className="live-main">
          {current && (
            <div className="row live-title">
              <h1>{current.title}</h1>
              <span className="spacer" />
              <span className={`live-timer${left < 0 ? " over" : left < 60 ? " soon" : ""}`}>{mmss(left)}</span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {current && <SectionBody type={current.item_type} p={props} onEnd={(recapId) => navigate(`/meetings/${meeting.id}/history?open=${recapId}`)} agenda={agenda} used={used} />}
          <div className="row live-nav">
            <button className="btn" disabled={idx === 0} onClick={() => goTo(idx - 1)}><ChevronLeft size={18} />Back</button>
            <span className="spacer" />
            {idx < agenda.length - 1 && <button className="btn btn-primary" onClick={() => goTo(idx + 1)} title={`Next: ${agenda[idx + 1].title}`}><span className="next-label">Next: {agenda[idx + 1].title}</span><ChevronRight size={18} style={{ flex: "none" }} /></button>}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

interface SectionProps {
  meeting: MeetingRow;
  session: Session;
  me: Member;
  companyId: string;
  members: Member[];
  byId: (id: string | null | undefined) => Member | undefined;
  attendees: Attendee[];
  tick: number;
  logEvent: (t: SessionEvent["item_type"], id: string, a: SessionEvent["action"]) => void;
  onError: (msg: string) => void;
  reload: () => void;
}

function SectionBody({ type, p, onEnd, agenda, used }: {
  type: SessionAgenda["item_type"]; p: SectionProps; onEnd: (sessionId: string) => void;
  agenda: SessionAgenda[]; used: (a: SessionAgenda) => number;
}) {
  switch (type) {
    case "good_news": case "check_in": return <GoAround p={p} prompt={type === "good_news" ? "One personal and one business good news each." : "How is everyone doing? One word or one sentence each."} />;
    case "scorecard": return <ScorecardReview p={p} />;
    case "goal_review": return <GoalReview p={p} />;
    case "headlines": return <HeadlineReview p={p} />;
    case "todo_list": return <TodoReview p={p} />;
    case "discuss_solve": return <DiscussSolve p={p} />;
    case "conclude": return <Conclude p={p} onEnd={onEnd} agenda={agenda} used={used} />;
    default: return <p className="muted">Use this time for {agenda.find((a) => a.item_type === type)?.title ?? "this section"}.</p>;
  }
}

/** Shared helper: drop something into this meeting's Issues. */
async function dropToIssues(p: SectionProps, title: string, owner: string | null, source: { type: "goal" | "todo" | "headline" | "measurable"; id: string }, description?: string | null) {
  const { data, error } = await supabase.from("ss_issues").insert({
    company_id: p.companyId, meeting_id: p.meeting.id, owner_member_id: owner, title, description: description ?? null,
    source_type: source.type, source_id: source.id, created_by: p.me.id, created_in_session_id: p.session.id,
  }).select("id").single();
  if (error) { p.onError(friendlyError(error)); return; }
  p.logEvent(source.type, source.id, "dropped_to_issues");
  p.logEvent("issue", data.id, "added");
}

function GoAround({ p, prompt }: { p: SectionProps; prompt: string }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <div className="stack">
      <p className="muted">{prompt}</p>
      <ul className="card list">
        {p.attendees.map((a) => {
          const m = p.byId(a.member_id);
          const on = done.has(a.member_id);
          return (
            <li key={a.id} className="clickable" onClick={() => setDone(new Set(on ? [...done].filter((x) => x !== a.member_id) : [...done, a.member_id]))}>
              <Tick done={on} label={on ? "Not yet" : "Shared"} onToggle={() => setDone(new Set(on ? [...done].filter((x) => x !== a.member_id) : [...done, a.member_id]))} />
              <Avatar m={m} /><span className={`item-title${on ? " struck" : ""}`}>{m ? fullName(m) : "Someone"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Key Numbers at the meeting: weekly numbers under the last few meeting dates, with today's column to fill in;
 * at the first meeting of a month (or year) the monthly (or yearly) numbers for the one just ended too.
 */
function ScorecardReview({ p }: { p: SectionProps }) {
  const [data, setData] = useState<{ list: Measurable[]; values: MValue[]; period: Period } | null>(null);
  const [error, setError] = useState("");
  const sched = scheduleOf(p.meeting);
  const t = useMemo(() => {
    // The column for this meeting is the scheduled date closest to today.
    const day = sched ? nearestMeeting(sched) : today();
    return { day, tl: timeline(sched, day) };
  }, [sched?.first, sched?.step]); // the schedule, not the object
  const weeks = t.tl.periods("week", 4);
  const prevDay = sched ? addDays(t.day, -sched.step) : addDays(t.day, -7);
  const firstOfMonth = prevDay.slice(0, 7) !== t.day.slice(0, 7);
  const firstOfYear = prevDay.slice(0, 4) !== t.day.slice(0, 4);
  const months = recentPeriods("month", 3, addDays(`${t.day.slice(0, 7)}-01`, -1));
  const years = recentPeriods("year", 2, addDays(`${t.day.slice(0, 4)}-01-01`, -1));

  const load = useCallback(async () => {
    const { data: card } = await supabase.from("ss_scorecards").select("id, period").eq("meeting_id", p.meeting.id).maybeSingle();
    if (!card) { setData({ list: [], values: [], period: "week" }); return; }
    const { data: ms } = await supabase.from("ss_measurables").select("*").eq("scorecard_id", card.id).is("deleted_at", null).is("archived_at", null).order("sort_order");
    const list = (ms ?? []) as Measurable[];
    const from = [weeks[0], months[0], years[0]].sort()[0];
    const { data: vs } = list.length ? await supabase.from("ss_measurable_values").select("*").in("measurable_id", list.map((m) => m.id)).gte("period_start", from) : { data: [] };
    setData({ list, values: (vs ?? []) as MValue[], period: card.period as Period });
  }, [p.meeting.id, weeks.join(), months.join(), years.join()]); // the dates, not the arrays
  useEffect(() => { load(); }, [load, p.tick]);

  if (!data) return <p className="muted">Loading…</p>;
  const per = (m: Measurable): Period => m.period_override ?? data.period;
  const valueFor = (m: Measurable, ps: string) => data.values.find((x) => x.measurable_id === m.id && x.period_start === ps);
  const save = async (m: Measurable, ps: string, text: string) => {
    const n = parseNumber(text);
    const existing = valueFor(m, ps);
    if (Number.isNaN(n)) { setError(`"${text}" isn't a number.`); return; }
    setError("");
    const q = n === null ? (existing ? supabase.from("ss_measurable_values").delete().eq("id", existing.id) : null)
      : existing ? (existing.value === n ? null : supabase.from("ss_measurable_values").update({ value: n }).eq("id", existing.id))
      : supabase.from("ss_measurable_values").insert({ company_id: p.companyId, measurable_id: m.id, period_start: ps, value: n });
    if (!q) return;
    const { error } = await q;
    if (error) setError(friendlyError(error)); else load();
  };

  const table = (list: Measurable[], period: Period, cols: string[], title?: string) => list.length > 0 && (
    <div className="stack" style={{ gap: 6 }}>
      {title && <h3 className="label section-label">{title}</h3>}
      <div className="card sc-wrap" ref={(el) => { if (el && !el.dataset.scrolled) { el.scrollLeft = el.scrollWidth; el.dataset.scrolled = "1"; } }}>
        <table className="sc">
          <thead><tr><th className="sc-title">Number · goal</th>{cols.map((c, i) => (
            <th key={c} className={`sc-head${i === cols.length - 1 ? " sc-now" : ""}`}>{t.tl.label(period, c)}</th>
          ))}<th /></tr></thead>
          <tbody>
            {list.map((m) => {
              const cur = valueFor(m, cols.at(-1)!);
              const off = onTrack(cur?.value ?? null, cur?.goal_value ?? null, cur?.goal_value_upper ?? null, cur?.comparison ?? null) === false;
              return (
                <tr key={m.id}>
                  <td className="sc-title"><div className="row" style={{ gap: 8 }}><Avatar m={p.byId(m.owner_member_id)} size={26} />
                    <div><div className="sc-name">{m.title}</div><div className="small muted">{goalText(m)}</div></div></div></td>
                  {cols.map((c, i) => {
                    const x = valueFor(m, c);
                    const ok = onTrack(x?.value ?? null, x?.goal_value ?? null, x?.goal_value_upper ?? null, x?.comparison ?? null);
                    const cls = `sc-cell${ok === true ? " sc-on" : ok === false ? " sc-off" : ""}`;
                    return i === cols.length - 1
                      ? <td key={c} className={`${cls} sc-now`}><input key={`${c}-${x?.value ?? ""}`} className="sc-input" inputMode="decimal" defaultValue={x?.value?.toString() ?? ""}
                          aria-label={`${m.title}, ${t.tl.label(period, c)}`} placeholder="—" onBlur={(e) => save(m, c, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></td>
                      : <td key={c} className={cls} style={{ cursor: "default" }}>{fmtValue(x?.value, m.unit, m.decimals)}</td>;
                  })}
                  <td>{off && <button className="btn btn-sm" onClick={() => dropToIssues(p, `${m.title}: off track`, m.owner_member_id, { type: "measurable", id: m.id })}><CircleAlert size={14} />Issue</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const weekly = data.list.filter((m) => per(m) === "week");
  const monthly = firstOfMonth ? data.list.filter((m) => per(m) === "month") : [];
  const yearly = firstOfYear ? data.list.filter((m) => per(m) === "year") : [];
  if (!weekly.length && !monthly.length && !yearly.length) return <Empty>No Key Numbers for this meeting yet.</Empty>;
  return (
    <div className="stack">
      <p className="muted">Fill in today's column (or check what owners entered beforehand). Each owner reports on track or off track; anything off track goes to Issues, to discuss there.</p>
      {error && <p className="error">{error}</p>}
      {table(weekly, "week", weeks, monthly.length || yearly.length ? "Weekly" : undefined)}
      {table(monthly, "month", months, `Monthly · for ${new Date(`${months.at(-1)!}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`)}
      {table(yearly, "year", years, `Yearly · for ${years.at(-1)!.slice(0, 4)}`)}
      <Link to="/key-numbers" className="small">Open Key Numbers</Link>
    </div>
  );
}

function GoalReview({ p }: { p: SectionProps }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const q = currentQuarter();
  useEffect(() => {
    supabase.from("ss_goals").select("*").eq("meeting_id", p.meeting.id).eq("is_live", true).is("deleted_at", null).is("archived_at", null)
      .or(`and(quarter.eq.${q.quarter},quarter_year.eq.${q.year}),quarter.is.null`).order("owner_member_id")
      .then(({ data }) => setGoals((data ?? []) as Goal[]));
  }, [p.meeting.id, p.tick, q.quarter, q.year, reload]);
  const set = async (r: Goal, status: Goal["status"]) => {
    setGoals((l) => l?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? null);
    await supabase.from("ss_goals").update({ status }).eq("id", r.id);
    p.logEvent("goal", r.id, "reviewed");
  };
  if (!goals) return <p className="muted">Loading…</p>;
  if (!goals.length) return <Empty>No live Goals on this meeting this quarter.</Empty>;
  return (
    <div className="stack">
      <p className="muted">Each owner says on track or off track. Off-track Goals go to Issues.</p>
      <ul className="card list">
        {goals.map((r) => (
          <li key={r.id} style={{ flexWrap: "wrap" }}>
            <Avatar m={p.byId(r.owner_member_id)} />
            <button type="button" className="item-title live-open" style={{ flex: "1 1 200px" }} onClick={() => setOpened(r.id)}>{r.title}</button>
            <div className="chips">
              {(["on_track", "off_track", "done"] as const).map((s) => (
                <button key={s} className={`chip${r.status === s ? (s === "off_track" ? " chip-off" : " chip-on") : ""}`} onClick={() => set(r, s)}>{GOAL_STATUS[s].label}</button>
              ))}
            </div>
            {r.status === "off_track" && <button className="btn btn-sm" onClick={() => dropToIssues(p, r.title, r.owner_member_id, { type: "goal", id: r.id })}><CircleAlert size={14} />Issue</button>}
          </li>
        ))}
      </ul>
      {opened && (
        <Sheet title="Goal" onClose={() => { setOpened(null); setReload((n) => n + 1); }}>
          <GoalDetail goalId={opened} onClose={() => setOpened(null)} onChanged={() => setReload((n) => n + 1)} />
        </Sheet>
      )}
    </div>
  );
}

function HeadlineReview({ p }: { p: SectionProps }) {
  const [items, setItems] = useState<Headline[] | null>(null);
  const [opened, setOpened] = useState<Headline | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    supabase.from("ss_headlines").select("*").eq("meeting_id", p.meeting.id).is("deleted_at", null).is("archived_at", null)
      .or(`status.eq.to_review,updated_at.gte."${p.session.started_at}"`).order("created_at")
      .then(({ data }) => setItems((data ?? []) as Headline[]));
  }, [p.meeting.id, p.tick, p.session.started_at, reload]);
  const review = async (h: Headline, reviewed: boolean) => {
    setItems((l) => l?.map((x) => (x.id === h.id ? { ...x, status: reviewed ? "reviewed" : "to_review" } : x)) ?? null);
    await supabase.from("ss_headlines").update({ status: reviewed ? "reviewed" : "to_review" }).eq("id", h.id);
    if (reviewed) p.logEvent("headline", h.id, "reviewed");
  };
  const add = async (title: string, owner: string | null) => {
    const { error } = await supabase.from("ss_headlines").insert({ company_id: p.companyId, meeting_id: p.meeting.id, owner_member_id: owner, title, created_by: p.me.id });
    if (error) { p.onError(friendlyError(error)); return false; }
    setReload((n) => n + 1);
    return true;
  };
  if (!items) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <p className="muted">Short good or bad news about customers and people. Anything that needs discussing goes to Issues.</p>
      {items.length ? (
        <ul className="card list">
          {items.map((h) => (
            <li key={h.id} style={{ flexWrap: "wrap" }}>
              <Avatar m={p.byId(h.owner_member_id)} />
              <button type="button" className={`item-title live-open${h.status === "reviewed" ? " struck" : ""}`} style={{ flex: "1 1 200px" }} onClick={() => setOpened(h)}>{h.title}</button>
              {h.status === "to_review"
                ? <button className="btn btn-sm" onClick={() => review(h, true)}><Check size={14} />Reviewed</button>
                : <button className="btn btn-sm btn-ghost" aria-label="Undo" onClick={() => review(h, false)}><RotateCcw size={14} /></button>}
              <button className="btn btn-sm" onClick={() => { review(h, true); dropToIssues(p, h.title, h.owner_member_id, { type: "headline", id: h.id }, h.description); }}><CircleAlert size={14} />Issue</button>
            </li>
          ))}
        </ul>
      ) : <Empty>No Headlines this week.</Empty>}
      <LiveAdd p={p} placeholder="Add a Headline…" onAdd={(t, o) => add(t, o)} />
      {opened && <HeadlineSheet key={opened.id} h={opened} members={p.members.filter((m) => m.status === "active")} onClose={() => setOpened(null)}
        onSaved={() => { setOpened(null); setReload((n) => n + 1); }} onChanged={() => setReload((n) => n + 1)} />}
    </div>
  );
}

function TodoReview({ p }: { p: SectionProps }) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [opened, setOpened] = useState<Todo | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    // Due within a week, plus any added during this meeting (so they can be opened and changed).
    supabase.from("ss_todos").select("*").eq("meeting_id", p.meeting.id).eq("is_personal", false).is("deleted_at", null).is("archived_at", null)
      .or(`due_date.lte.${addDays(today(), 7)},created_in_session_id.eq.${p.session.id}`).order("owner_member_id").order("due_date")
      .then(({ data }) => setTodos((data ?? []) as Todo[]));
  }, [p.meeting.id, p.session.id, p.tick, reload]);
  const add = async (title: string, owner: string | null, due?: string) => {
    const { data, error } = await supabase.from("ss_todos").insert({ company_id: p.companyId, meeting_id: p.meeting.id, owner_member_id: owner ?? p.me.id,
      title, due_date: due ?? addDays(today(), 7), created_in_session_id: p.session.id, created_by: p.me.id }).select("id").single();
    if (error) { p.onError(friendlyError(error)); return false; }
    p.logEvent("todo", data.id, "added");
    setReload((n) => n + 1);
    return true;
  };
  const toggle = async (t: Todo) => {
    const done = t.status !== "done";
    setTodos((l) => l?.map((x) => (x.id === t.id ? { ...x, status: done ? "done" : "open" } : x)) ?? null);
    await supabase.from("ss_todos").update({ status: done ? "done" : "open", completed_at: done ? nowIso() : null }).eq("id", t.id);
    if (done) p.logEvent("todo", t.id, "done");
  };
  if (!todos) return <p className="muted">Loading…</p>;
  const done = todos.filter((t) => t.status === "done").length;
  const sheet = opened && <TodoSheet key={opened.id} todo={opened} onClose={() => setOpened(null)} onSaved={() => { setOpened(null); setReload((n) => n + 1); }} onChanged={() => setReload((n) => n + 1)} />;
  if (!todos.length) return <div className="stack"><Empty>No To-Dos due on this meeting.</Empty><LiveAdd p={p} placeholder="Add a To-Do…" withDue onAdd={add} />{sheet}</div>;
  return (
    <div className="stack">
      <div className="row">
        <p className="muted" style={{ flex: 1 }}>Done or not done. Anything stuck goes to Issues.</p>
        <span className="pct">{Math.round((done / todos.length) * 100)}%</span>
      </div>
      <ul className="card list">
        {todos.map((t) => (
          <li key={t.id} style={{ flexWrap: "wrap" }}>
            <Tick done={t.status === "done"} label={t.status === "done" ? "Not done" : "Done"} onToggle={() => toggle(t)} />
            <button type="button" className="live-open" style={{ flex: "1 1 200px", minWidth: 0 }} onClick={() => setOpened(t)}>
              <div className={`item-title${t.status === "done" ? " struck" : ""}`}>{t.title}</div>
              <div className={`small ${t.status === "open" && t.due_date < today() ? "overdue" : "muted"}`}>{p.byId(t.owner_member_id)?.first_name} · due {fmtDay(t.due_date)}{t.created_in_session_id === p.session.id ? " · new" : ""}</div>
            </button>
            {t.status === "open" && <button className="btn btn-sm" onClick={() => dropToIssues(p, t.title, t.owner_member_id, { type: "todo", id: t.id }, t.description)}><CircleAlert size={14} />Issue</button>}
          </li>
        ))}
      </ul>
      <LiveAdd p={p} placeholder="Add a To-Do…" withDue onAdd={add} />
      {sheet}
    </div>
  );
}

function DiscussSolve({ p }: { p: SectionProps }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [opened, setOpened] = useState<Issue | null>(null);
  const [openTodo, setOpenTodo] = useState<Todo | null>(null);
  const [made, setMade] = useState<Todo[]>([]);
  const [todoFor, setTodoFor] = useState<{ issue: Issue; title: string; owner: string | null; due: string } | null>(null);
  const load = useCallback(() => {
    supabase.from("ss_issues").select("*").eq("meeting_id", p.meeting.id).is("deleted_at", null).is("archived_at", null)
      .or(`status.eq.open,solved_at.gte."${p.session.started_at}"`).order("sort_order").order("created_at")
      .then(({ data }) => setIssues((data ?? []) as Issue[]));
    // To-Dos made from Issues in this meeting, shown under their Issue so they can be opened and changed.
    supabase.from("ss_todos").select("*").eq("created_in_session_id", p.session.id).eq("source_type", "issue").is("deleted_at", null).order("created_at")
      .then(({ data }) => setMade((data ?? []) as Todo[]));
  }, [p.meeting.id, p.session.started_at, p.session.id]);
  useEffect(() => { load(); }, [load, p.tick]);

  const setPriority = async (i: Issue, n: number | null) => {
    const holder = issues?.find((x) => x.status === "open" && x.priority === n && x.id !== i.id);
    if (n && holder) await supabase.from("ss_issues").update({ priority: null }).eq("id", holder.id);
    await supabase.from("ss_issues").update({ priority: n }).eq("id", i.id);
    load();
  };
  const solve = async (i: Issue, solved: boolean) => {
    await supabase.from("ss_issues").update(solved ? { status: "solved", solved_at: nowIso(), priority: null } : { status: "open", solved_at: null }).eq("id", i.id);
    if (solved) p.logEvent("issue", i.id, "solved");
    load();
  };
  const add = async (title: string, owner: string | null) => {
    const { data, error } = await supabase.from("ss_issues").insert({ company_id: p.companyId, meeting_id: p.meeting.id, owner_member_id: owner,
      title, created_by: p.me.id, created_in_session_id: p.session.id, sort_order: (issues?.length ?? 0) + 1 }).select("id").single();
    if (error) { p.onError(friendlyError(error)); return false; }
    p.logEvent("issue", data.id, "added");
    load();
    return true;
  };
  const makeTodo = async (e: FormEvent) => {
    e.preventDefault();
    if (!todoFor || !todoFor.title.trim()) return;
    const { data, error } = await supabase.from("ss_todos").insert({ company_id: p.companyId, meeting_id: p.meeting.id, owner_member_id: todoFor.owner ?? p.me.id,
      title: todoFor.title.trim(), due_date: todoFor.due, source_type: "issue", source_id: todoFor.issue.id, created_in_session_id: p.session.id, created_by: p.me.id }).select("id").single();
    if (error) { p.onError(friendlyError(error)); return; }
    p.logEvent("todo", data.id, "added");
    setTodoFor({ ...todoFor, title: "" });
    load();
  };

  if (!issues) return <p className="muted">Loading…</p>;
  const open = issues.filter((i) => i.status === "open").sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.sort_order - b.sort_order);
  const solvedNow = issues.filter((i) => i.status === "solved");
  return (
    <div className="stack">
      <p className="muted">Pick the top 3. For each: identify the real issue, discuss, solve. Solutions usually become To-Dos.</p>
      <ul className="card list">
        {open.map((i) => (
          <li key={i.id} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <select className={`prio${i.priority ? " prio-on" : ""}`} aria-label="Top 3 priority" value={i.priority ?? ""} onChange={(e) => setPriority(i, e.target.value ? Number(e.target.value) : null)}>
              <option value="">–</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
            </select>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <button type="button" className="live-open" onClick={() => setOpened(i)}>
                <div className="item-title">{i.title}</div>
                <div className="small muted">{p.byId(i.owner_member_id)?.first_name ?? "Unassigned"}</div>
                {i.description && <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{i.description}</p>}
              </button>
              {made.filter((t) => t.source_id === i.id).map((t) => (
                <button key={t.id} type="button" className="made-todo" onClick={() => setOpenTodo(t)}>
                  <SquareCheck size={13} />{t.title} · {p.byId(t.owner_member_id)?.first_name ?? "?"} · {fmtDay(t.due_date)}
                </button>
              ))}
              {todoFor?.issue.id === i.id && (
                <form className="todo-inline" onSubmit={makeTodo}>
                  <input className="input" placeholder="New To-Do" autoFocus value={todoFor.title} onChange={(e) => setTodoFor({ ...todoFor, title: e.target.value })} />
                  <div className="row wrap">
                    <div style={{ minWidth: 140 }}><OwnerSelect members={p.members.filter((m) => m.status === "active")} value={todoFor.owner} onChange={(v) => setTodoFor({ ...todoFor, owner: v })} /></div>
                    <input className="input input-sm" type="date" value={todoFor.due} onChange={(e) => setTodoFor({ ...todoFor, due: e.target.value })} />
                    <button className="btn btn-sm btn-primary" disabled={!todoFor.title.trim()}><Plus size={14} />Add To-Do</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTodoFor(null)}>Close</button>
                  </div>
                </form>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setTodoFor({ issue: i, title: i.title, owner: i.owner_member_id, due: addDays(today(), 7) })}><SquareCheck size={14} />To-Do</button>
              <button className="btn btn-sm btn-primary" onClick={() => solve(i, true)}><Check size={14} />Resolved</button>
            </div>
          </li>
        ))}
      </ul>
      {!open.length && <Empty>No open Issues. Well done.</Empty>}
      <LiveAdd p={p} placeholder="Add an Issue…" onAdd={add} />
      {opened && <IssueSheet key={opened.id} issue={opened} members={p.members.filter((m) => m.status === "active")} onClose={() => setOpened(null)}
        onSaved={() => { setOpened(null); load(); }} onChanged={load} />}
      {openTodo && <TodoSheet key={openTodo.id} todo={openTodo} onClose={() => setOpenTodo(null)} onSaved={() => { setOpenTodo(null); load(); }} onChanged={load} />}
      {solvedNow.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Resolved this meeting <span className="count">{solvedNow.length}</span></h3>
          {solvedNow.map((i) => (
            <div key={i.id} className="row small"><Check size={14} color="var(--color-brand)" /><span style={{ flex: 1 }}>{i.title}</span>
              <button className="link-btn" onClick={() => solve(i, false)}>Reopen</button></div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Add an item during the meeting with its owner (and due date) set right away. */
function LiveAdd({ p, placeholder, withDue, onAdd }: {
  p: SectionProps; placeholder: string; withDue?: boolean; onAdd: (title: string, owner: string | null, due?: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string | null>(p.me.id);
  const [due, setDue] = useState(addDays(today(), 7));
  const [busy, setBusy] = useState(false);
  return (
    <form className="live-add" onSubmit={async (e) => {
      e.preventDefault();
      if (!title.trim()) return;
      setBusy(true);
      if (await onAdd(title.trim(), owner, withDue ? due : undefined)) setTitle("");
      setBusy(false);
    }}>
      <input className="input" placeholder={placeholder} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={placeholder} />
      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}><OwnerSelect members={p.members.filter((m) => m.status === "active")} value={owner} onChange={setOwner} /></div>
        {withDue && <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value || due)} aria-label="Due" style={{ width: 160, flex: "none" }} />}
        <button className="btn btn-primary btn-sm" disabled={busy || !title.trim()}><Plus size={16} />Add</button>
      </div>
    </form>
  );
}

function Conclude({ p, onEnd, agenda, used }: { p: SectionProps; onEnd: (sessionId: string) => void; agenda: SessionAgenda[]; used: (a: SessionAgenda) => number }) {
  const [newTodos, setNewTodos] = useState<Todo[]>([]);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = p.attendees.find((a) => a.member_id === p.me.id);
  useEffect(() => {
    supabase.from("ss_todos").select("*").eq("created_in_session_id", p.session.id).is("deleted_at", null).order("owner_member_id")
      .then(({ data }) => setNewTodos((data ?? []) as Todo[]));
  }, [p.session.id, p.tick]);

  const rate = async (n: number) => {
    if (mine) await supabase.from("ss_session_attendees").update({ rating: n }).eq("id", mine.id);
    p.reload();
  };

  const end = async () => {
    if (!confirm("End the meeting for everyone?")) return;
    setBusy(true);
    try {
      const s = p.session;
      const [{ data: solved }, { data: meetingTodos }, { data: events }, { data: att }] = await Promise.all([
        supabase.from("ss_issues").select("id, title").eq("meeting_id", p.meeting.id).eq("status", "solved").gte("solved_at", s.started_at),
        supabase.from("ss_todos").select("id, status").eq("meeting_id", p.meeting.id).eq("is_personal", false).is("deleted_at", null).is("archived_at", null).lte("due_date", addDays(today(), 7)),
        supabase.from("ss_session_events").select("item_type, action").eq("session_id", s.id),
        supabase.from("ss_session_attendees").select("member_id, rating").eq("session_id", s.id),
      ]);
      const ratings = (att ?? []) as { member_id: string; rating: number | null }[];
      const rated = ratings.filter((r) => r.rating !== null);
      const recap: Recap = {
        minutes: Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000),
        average_rating: rated.length ? Math.round((rated.reduce((n, r) => n + r.rating!, 0) / rated.length) * 10) / 10 : null,
        ratings, attendees: ratings.map((r) => r.member_id),
        issues_solved: (solved ?? []) as { id: string; title: string }[],
        todos_created: newTodos.map((t) => ({ id: t.id, title: t.title, owner_member_id: t.owner_member_id, due_date: t.due_date })),
        todos_done: (meetingTodos ?? []).filter((t) => t.status === "done").length,
        todos_total: (meetingTodos ?? []).length,
        headlines: ((events ?? []) as { item_type: string; action: string }[]).filter((e) => e.item_type === "headline" && e.action === "reviewed").length,
      };
      const cur = agenda[s.current_agenda_index];
      if (cur?.started_at) await supabase.from("ss_session_agenda").update({ seconds_spent: Math.round(used(cur)), started_at: null }).eq("id", cur.id);
      const { error } = await supabase.from("ss_meeting_sessions").update({ status: "ended", ended_at: nowIso(), summary: recap, clear_done_items: clear }).eq("id", s.id);
      if (error) throw error;
      if (clear) {
        const at = nowIso();
        await Promise.all([
          supabase.from("ss_todos").update({ archived_at: at }).eq("meeting_id", p.meeting.id).eq("status", "done").is("archived_at", null),
          supabase.from("ss_issues").update({ archived_at: at }).eq("meeting_id", p.meeting.id).eq("status", "solved").is("archived_at", null),
          supabase.from("ss_headlines").update({ archived_at: at }).eq("meeting_id", p.meeting.id).eq("status", "reviewed").is("archived_at", null),
        ]);
      }
      onEnd(s.id);
    } catch (err) { p.onError(friendlyError(err)); setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <h3>New To-Dos <span className="count">{newTodos.length}</span></h3>
        {newTodos.length ? newTodos.map((t) => (
          <div key={t.id} className="row small"><Square size={14} /><span style={{ flex: 1 }}>{t.title}</span>
            <span className="muted">{p.byId(t.owner_member_id)?.first_name} · {fmtDay(t.due_date)}</span></div>
        )) : <p className="small muted">None added this meeting.</p>}
      </div>
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <h3>Rate this meeting</h3>
        <div className="rate">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} className={`rate-btn${mine?.rating === n ? " on" : ""}`} onClick={() => rate(n)} aria-label={`Rate ${n}`}>{n}</button>
          ))}
        </div>
        <div className="row wrap small">
          {p.attendees.map((a) => <span key={a.id} className="badge">{p.byId(a.member_id)?.first_name}: {a.rating ?? "–"}</span>)}
        </div>
        <p className="small muted">Anyone rating below 8 says why.</p>
      </div>
      <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
        Archive done To-Dos, resolved Issues and reviewed Headlines (they stay in history and search)
      </label>
      <button className="btn btn-primary" disabled={busy} onClick={end}>End meeting</button>
    </div>
  );
}
