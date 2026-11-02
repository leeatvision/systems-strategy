import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  addDays, currentQuarter, isoDay, qLabel, quarterEnd, shiftQuarter, today, useMembers,
  type Issue, type Quarter, type Goal, type Todo,
} from "../lib/data";
import { onTrack, periodLabel, periodStart, type Measurable, type MValue, type Period, type Scorecard } from "../lib/scorecard";
import type { Session } from "../lib/meetings";
import { Avatar, Empty, Section } from "../components/ui";

// Goals the team aims for: most Goals done each quarter, nearly every To-Do done by its due date.
const GOAL_TARGET = 80;
const TODO_GOAL = 90;

type TodoRow = Pick<Todo, "id" | "owner_member_id" | "due_date" | "status" | "completed_at">;
type IssueRow = Pick<Issue, "id" | "owner_member_id" | "status" | "created_at" | "solved_at">;
type SessionRow = Pick<Session, "id" | "meeting_id" | "started_at" | "summary">;
type MeasurableRow = Pick<Measurable, "id" | "scorecard_id" | "owner_member_id" | "title" | "period_override">;
type ValueRow = Pick<MValue, "measurable_id" | "period_start" | "value" | "goal_value" | "goal_value_upper" | "comparison">;

interface Data {
  goals: Goal[]; todos: TodoRow[]; overdue: TodoRow[]; solved: IssueRow[]; opened: IssueRow[]; openIssues: IssueRow[];
  sessions: SessionRow[]; meetings: Record<string, string>; measurables: MeasurableRow[]; values: ValueRow[];
}

const quarterStart = (q: Quarter) => isoDay(new Date(q.year, (q.quarter - 1) * 3, 1));
const localDay = (ts: string) => isoDay(new Date(ts));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const onTime = (t: TodoRow) => t.status === "done" && !!t.completed_at && localDay(t.completed_at) <= t.due_date;

/** How the quarter went: Goals, To-Dos, Issues, meetings and the Scorecard, overall and per person. */
export function Insights() {
  const { me } = useMe();
  const { members } = useMembers();
  const [q, setQ] = useState<Quarter>(currentQuarter());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const start = quarterStart(q);
  const end = quarterEnd(q);
  const upTo = end < today() ? end : today(); // To-Dos due later in the quarter aren't late yet
  const future = start > today();

  useEffect(() => {
    let live = true;
    setData(null); setError("");
    (async () => {
      const [goals, todos, overdue, solved, opened, openIssues, sessions, meetings, cards, measurables, values] = await Promise.all([
        supabase.from("ss_goals").select("*").eq("quarter", q.quarter).eq("quarter_year", q.year).is("deleted_at", null),
        supabase.from("ss_todos").select("id, owner_member_id, due_date, status, completed_at")
          .gte("due_date", start).lte("due_date", upTo).eq("is_personal", false).is("deleted_at", null),
        supabase.from("ss_todos").select("id, owner_member_id, due_date, status, completed_at")
          .eq("status", "open").lt("due_date", today()).eq("is_personal", false).is("deleted_at", null).is("archived_at", null),
        supabase.from("ss_issues").select("id, owner_member_id, status, created_at, solved_at")
          .gte("solved_at", `${start}T00:00:00`).lte("solved_at", `${end}T23:59:59`).is("deleted_at", null),
        supabase.from("ss_issues").select("id, owner_member_id, status, created_at, solved_at")
          .gte("created_at", `${start}T00:00:00`).lte("created_at", `${end}T23:59:59`).is("deleted_at", null),
        supabase.from("ss_issues").select("id, owner_member_id, status, created_at, solved_at")
          .eq("status", "open").is("deleted_at", null).is("archived_at", null),
        supabase.from("ss_meeting_sessions").select("id, meeting_id, started_at, summary").eq("status", "ended")
          .gte("started_at", `${start}T00:00:00`).lte("started_at", `${end}T23:59:59`).order("started_at"),
        supabase.from("ss_meetings").select("id, title"),
        supabase.from("ss_scorecards").select("id, period"),
        supabase.from("ss_measurables").select("id, scorecard_id, owner_member_id, title, period_override").is("deleted_at", null),
        supabase.from("ss_measurable_values").select("measurable_id, period_start, value, goal_value, goal_value_upper, comparison")
          .gte("period_start", start).lte("period_start", end),
      ]);
      const failed = [goals, todos, overdue, solved, opened, openIssues, sessions, meetings, cards, measurables, values].find((r) => r.error);
      if (!live) return;
      if (failed?.error) { setError(failed.error.message); return; }
      // Only weekly measurables: their hit rate lines up with the weeks below.
      const cardPeriod = Object.fromEntries((cards.data as Pick<Scorecard, "id" | "period">[]).map((c) => [c.id, c.period]));
      const weekly = (measurables.data as MeasurableRow[]).filter((m) => (m.period_override ?? cardPeriod[m.scorecard_id] as Period) === "week");
      setData({
        goals: (goals.data as Goal[]).filter((r) => r.is_live && r.status !== "canceled"),
        todos: todos.data as TodoRow[], overdue: overdue.data as TodoRow[],
        solved: solved.data as IssueRow[], opened: opened.data as IssueRow[], openIssues: openIssues.data as IssueRow[],
        sessions: (sessions.data as SessionRow[]).slice().sort((a, b) => a.started_at.localeCompare(b.started_at)),
        meetings: Object.fromEntries((meetings.data as { id: string; title: string }[]).map((m) => [m.id, m.title])),
        measurables: weekly, values: values.data as ValueRow[],
      });
    })();
    return () => { live = false; };
  }, [q.quarter, q.year, start, end, upTo]);

  // Week starts (Sundays) from the start of the quarter up to this week (or the quarter's last week).
  const weeks = useMemo(() => {
    const out: string[] = [];
    for (let w = periodStart("week", start); w <= upTo; w = addDays(w, 7)) out.push(w);
    return out;
  }, [start, upTo]);
  const weekOf = (day: string) => periodStart("week", day);

  const s = useMemo(() => {
    if (!data) return null;
    const goalsDone = data.goals.filter((r) => r.status === "done").length;
    const company = data.goals.filter((r) => r.goal_type === "company");
    const byStatus = (st: Goal["status"]) => data.goals.filter((r) => r.status === st).length;
    const todosOnTime = data.todos.filter(onTime).length;
    const weeklyIds = new Set(data.measurables.map((m) => m.id));
    const scored = data.values
      .filter((v) => weeklyIds.has(v.measurable_id))
      .map((v) => ({ ...v, ok: onTrack(v.value, v.goal_value, v.goal_value_upper, v.comparison) }))
      .filter((v) => v.ok !== null);
    const ratings = data.sessions.map((x) => x.summary?.average_rating).filter((x): x is number => typeof x === "number");
    return {
      goalsDone, goalsTotal: data.goals.length,
      companyDone: company.filter((r) => r.status === "done").length, companyTotal: company.length,
      onTrack: byStatus("on_track"), offTrack: byStatus("off_track"), notDone: byStatus("not_done"),
      todosOnTime, todosTotal: data.todos.length,
      scoreOn: scored.filter((v) => v.ok).length, scoreTotal: scored.length, scored,
      avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null, ratings: ratings.length,
      todoWeeks: weeks.map((w) => {
        const due = data.todos.filter((t) => weekOf(t.due_date) === w);
        const ok = due.filter(onTime).length;
        return { label: periodLabel("week", w), value: pct(ok, due.length), text: due.length ? `${ok} of ${due.length} done on time` : "No To-Dos due" };
      }),
      issueWeeks: weeks.map((w) => {
        const n = data.solved.filter((i) => i.solved_at && weekOf(localDay(i.solved_at)) === w).length;
        const added = data.opened.filter((i) => weekOf(localDay(i.created_at)) === w).length;
        return { label: periodLabel("week", w), value: n, text: `${n} resolved, ${added} added` };
      }),
      scoreWeeks: weeks.map((w) => {
        const vs = scored.filter((v) => v.period_start === w);
        const ok = vs.filter((v) => v.ok).length;
        return { label: periodLabel("week", w), value: pct(ok, vs.length), text: vs.length ? `${ok} of ${vs.length} numbers on track` : "No numbers entered" };
      }),
      meetingBars: data.sessions.map((x) => ({
        label: new Date(x.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: x.summary?.average_rating ?? null,
        text: `${data.meetings[x.meeting_id] ?? "Meeting"}: ${x.summary?.average_rating != null ? `rated ${x.summary.average_rating}` : "no rating"}${x.summary ? `, ${x.summary.minutes} min` : ""}`,
      })),
    };
  }, [data, weeks]);

  const people = useMemo(() => {
    if (!data || !s) return [];
    return members.filter((m) => m.status === "active").map((m) => {
      const goals = data.goals.filter((r) => r.owner_member_id === m.id);
      const todos = data.todos.filter((t) => t.owner_member_id === m.id);
      const mine = new Set(data.measurables.filter((x) => x.owner_member_id === m.id).map((x) => x.id));
      const scored = s.scored.filter((v) => mine.has(v.measurable_id));
      return {
        m, goalsDone: goals.filter((r) => r.status === "done").length, goalsTotal: goals.length,
        goalsOff: goals.filter((r) => r.status === "off_track").length,
        todosOnTime: todos.filter(onTime).length, todosTotal: todos.length,
        overdue: data.overdue.filter((t) => t.owner_member_id === m.id).length,
        issues: data.openIssues.filter((i) => i.owner_member_id === m.id).length,
        scoreOn: scored.filter((v) => v.ok).length, scoreTotal: scored.length,
      };
    }).sort((a, b) => (a.m.id === me.id ? -1 : b.m.id === me.id ? 1 : a.m.first_name.localeCompare(b.m.first_name)));
  }, [data, s, members, me.id]);

  return (
    <div className="stack">
      <div className="row page-head">
        <h1 style={{ flex: 1 }}>Insights</h1>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn btn-sm btn-ghost" aria-label="Previous quarter" onClick={() => setQ(shiftQuarter(q, -1))}><ChevronLeft size={18} /></button>
        <strong style={{ color: "var(--color-fg)", minWidth: 72, textAlign: "center" }}>{qLabel(q)}</strong>
        <button className="btn btn-sm btn-ghost" aria-label="Next quarter" onClick={() => setQ(shiftQuarter(q, 1))}><ChevronRight size={18} /></button>
      </div>

      {error && <p className="error">{error}</p>}
      {!s ? (!error && <p className="muted">Loading…</p>) : (
        <>
          <div className="tiles">
            <Tile label="Goals done" value={pct(s.goalsDone, s.goalsTotal)} unit="%" goal={GOAL_TARGET}
              detail={s.goalsTotal ? `${s.goalsDone} of ${s.goalsTotal}${s.companyTotal ? ` · company ${s.companyDone} of ${s.companyTotal}` : ""}` : "No Goals this quarter"} to="/goals" />
            <Tile label="To-Dos done on time" value={pct(s.todosOnTime, s.todosTotal)} unit="%" goal={TODO_GOAL}
              detail={s.todosTotal ? `${s.todosOnTime} of ${s.todosTotal} due so far` : future ? "Quarter hasn't started" : "None due yet"} to="/todos" />
            <Tile label="Issues resolved" value={data!.solved.length}
              detail={`${data!.opened.length} added · ${data!.openIssues.length} open now`} to="/issues" />
            <Tile label="Meeting rating" value={s.avgRating === null ? null : Math.round(s.avgRating * 10) / 10}
              detail={s.ratings ? `Average of ${s.ratings} meeting${s.ratings === 1 ? "" : "s"}, out of 10` : "No rated meetings"} to="/meetings" />
            <Tile label="Scorecard on track" value={pct(s.scoreOn, s.scoreTotal)} unit="%"
              detail={s.scoreTotal ? `${s.scoreOn} of ${s.scoreTotal} weekly numbers` : "No weekly numbers entered"} to="/scorecard" />
          </div>

          {s.goalsTotal > 0 && (
            <Section title="Goals by status">
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <StatusBar parts={[
                  { label: "Done", n: s.goalsDone, cls: "seg-done" }, { label: "On track", n: s.onTrack, cls: "seg-on" },
                  { label: "Off track", n: s.offTrack, cls: "seg-off" }, { label: "Not done", n: s.notDone, cls: "seg-not" },
                ]} />
              </div>
            </Section>
          )}

          {weeks.length > 0 && (
            <div className="insight-charts">
              <Section title="To-Dos done on time, by week due">
                <div className="card card-pad"><Bars data={s.todoWeeks} max={100} unit="%" goal={TODO_GOAL} /></div>
              </Section>
              <Section title="Scorecard numbers on track, by week">
                <div className="card card-pad"><Bars data={s.scoreWeeks} max={100} unit="%" /></div>
              </Section>
              <Section title="Issues resolved, by week">
                <div className="card card-pad"><Bars data={s.issueWeeks} max={Math.max(4, ...s.issueWeeks.map((w) => w.value ?? 0))} /></div>
              </Section>
              <Section title="Meeting ratings">
                <div className="card card-pad">{s.meetingBars.length ? <Bars data={s.meetingBars} max={10} /> : <p className="small muted">No finished meetings this quarter.</p>}</div>
              </Section>
            </div>
          )}

          <Section title="By person">
            {people.length === 0 ? <Empty>No one to show.</Empty> : (
              <>
              <div className="card table-scroll person-table">
                <table className="insight-table">
                  <thead><tr><th>Person</th><th>Goals done</th><th>To-Dos on time</th><th>Overdue now</th><th>Open Issues</th><th>Scorecard</th></tr></thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.m.id}>
                        <th scope="row"><span className="row" style={{ gap: 8 }}><Avatar m={p.m} size={24} />{p.m.first_name} {p.m.last_name}</span></th>
                        <td>{p.goalsTotal ? <>{p.goalsDone}/{p.goalsTotal}{p.goalsOff > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{p.goalsOff} off</span>}</> : <span className="muted">–</span>}</td>
                        <td>{p.todosTotal ? <PctCell n={p.todosOnTime} d={p.todosTotal} goal={TODO_GOAL} /> : <span className="muted">–</span>}</td>
                        <td>{p.overdue ? <span className="badge badge-red">{p.overdue}</span> : <span className="muted">0</span>}</td>
                        <td>{p.issues || <span className="muted">0</span>}</td>
                        <td>{p.scoreTotal ? <PctCell n={p.scoreOn} d={p.scoreTotal} /> : <span className="muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="card list person-cards">
                {people.map((p) => (
                  <li key={p.m.id} className="stack" style={{ alignItems: "stretch", gap: 6 }}>
                    <span className="row item-title" style={{ gap: 8 }}><Avatar m={p.m} size={24} />{p.m.first_name} {p.m.last_name}</span>
                    <dl className="person-stats small">
                      <dt>Goals done</dt><dd>{p.goalsTotal ? <>{p.goalsDone}/{p.goalsTotal}{p.goalsOff > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{p.goalsOff} off</span>}</> : "–"}</dd>
                      <dt>To-Dos on time</dt><dd>{p.todosTotal ? <PctCell n={p.todosOnTime} d={p.todosTotal} goal={TODO_GOAL} /> : "–"}</dd>
                      <dt>Overdue now</dt><dd>{p.overdue ? <span className="badge badge-red">{p.overdue}</span> : "0"}</dd>
                      <dt>Open Issues</dt><dd>{p.issues}</dd>
                      <dt>Scorecard</dt><dd>{p.scoreTotal ? <PctCell n={p.scoreOn} d={p.scoreTotal} /> : "–"}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
              </>
            )}
            <p className="small muted">Personal To-Dos aren't counted. Goals count when they're live and not canceled.</p>
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, unit = "", goal, detail, to }: { label: string; value: number | null; unit?: string; goal?: number; detail: string; to?: string }) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value === null ? "–" : `${value}${unit}`}</span>
      {goal !== undefined && value !== null && (
        <span className={`small ${value >= goal ? "tile-good" : "tile-short"}`}>{value >= goal ? "At or above" : "Below"} the {goal}% goal</span>
      )}
      <span className="small muted">{detail}</span>
    </>
  );
  return to ? <Link to={to} className="card tile">{body}</Link> : <div className="card tile">{body}</div>;
}

function PctCell({ n, d, goal }: { n: number; d: number; goal?: number }) {
  const p = Math.round((n / d) * 100);
  return <span title={`${n} of ${d}`}>{p}%<span className="muted small"> ({n}/{d})</span>{goal !== undefined && p < goal && <span className="sr-only"> below goal</span>}</span>;
}

/** One stacked bar of Goal statuses, with a legend that carries the counts. */
function StatusBar({ parts }: { parts: { label: string; n: number; cls: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <>
      <div className="statusbar" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {parts.filter((p) => p.n).map((p) => <span key={p.label} className={p.cls} style={{ flexGrow: p.n }} title={`${p.label}: ${p.n} of ${total}`} />)}
      </div>
      <div className="row wrap small" style={{ gap: 12 }}>
        {parts.map((p) => <span key={p.label} className="row" style={{ gap: 6 }}><span className={`swatch ${p.cls}`} />{p.label} <strong>{p.n}</strong></span>)}
      </div>
    </>
  );
}

/** Single-series column chart. Tap or hover a column to read it; empty periods show as a dot. */
function Bars({ data, max, unit = "", goal }: { data: { label: string; value: number | null; text: string }[]; max: number; unit?: string; goal?: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const shown = pick ?? data.map((d) => d.value !== null).lastIndexOf(true);
  const cur = shown >= 0 ? data[shown] : null;
  return (
    <div className="bars-wrap">
      <p className="small bars-readout" aria-live="polite">
        {cur ? <><strong>{cur.label}</strong> · {cur.value === null ? cur.text : `${cur.value}${unit} · ${cur.text}`}</> : "No data yet"}
      </p>
      <div className="bars" onMouseLeave={() => setPick(null)}>
        {goal !== undefined && <span className="bars-goal" style={{ bottom: `${(goal / max) * 100}%` }}><span>{goal}{unit} goal</span></span>}
        {data.map((d, i) => (
          <button key={i} type="button" className={`bar-col${i === shown ? " is-picked" : ""}`} onMouseEnter={() => setPick(i)} onFocus={() => setPick(i)} onClick={() => setPick(i)}
            aria-label={`${d.label}: ${d.value === null ? d.text : `${d.value}${unit}, ${d.text}`}`}>
            {d.value === null ? <span className="bar-empty" /> : <span className="bar" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />}
          </button>
        ))}
      </div>
      <div className="bars-axis small muted">
        <span>{data[0]?.label}</span>{data.length > 1 && <span>{data[data.length - 1].label}</span>}
      </div>
    </div>
  );
}
