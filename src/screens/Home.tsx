import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, CircleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  GOAL_STATUS, currentQuarter, endOfWeek, fmtDateTime, fmtDay, nextMeeting, qLabel, today, useMeetings,
  type Goal, type Todo,
} from "../lib/data";
import { Empty, Progress, Section, Tick } from "../components/ui";
import { TodoSheet } from "./Todos";

/** "My Week": what needs me now. */
export function Home() {
  const { me, company } = useMe();
  const { meetings } = useMeetings();
  const navigate = useNavigate();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [steps, setSteps] = useState<Record<string, { done: number; total: number }>>({});
  const [issueCount, setIssueCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const q = currentQuarter();

  const load = useCallback(async () => {
    const [t, r, i] = await Promise.all([
      supabase.from("ss_todos").select("*").eq("owner_member_id", me.id).eq("status", "open")
        .is("deleted_at", null).is("archived_at", null).lte("due_date", endOfWeek()).order("due_date"),
      supabase.from("ss_goals").select("*").eq("owner_member_id", me.id).is("deleted_at", null)
        .in("status", ["on_track", "off_track"]).or(`and(quarter.eq.${q.quarter},quarter_year.eq.${q.year}),quarter.is.null`),
      supabase.from("ss_issues").select("id", { count: "exact", head: true }).eq("owner_member_id", me.id)
        .eq("status", "open").is("deleted_at", null).is("archived_at", null),
    ]);
    setTodos((t.data ?? []) as Todo[]);
    const myGoals = ((r.data ?? []) as Goal[]).sort((a, b) => (a.status === "off_track" ? 0 : 1) - (b.status === "off_track" ? 0 : 1));
    setGoals(myGoals);
    setIssueCount(i.count ?? 0);
    if (myGoals.length) {
      const { data: s } = await supabase.from("ss_goal_steps").select("goal_id, completed_on").in("goal_id", myGoals.map((x) => x.id));
      const tally: Record<string, { done: number; total: number }> = {};
      for (const row of (s ?? []) as { goal_id: string; completed_on: string | null }[]) {
        const x = (tally[row.goal_id] ??= { done: 0, total: 0 });
        x.total++; if (row.completed_on) x.done++;
      }
      setSteps(tally);
    }
  }, [me.id, q.quarter, q.year]);
  useEffect(() => { load(); }, [load]);

  const done = async (t: Todo) => {
    setTodos((l) => l?.filter((x) => x.id !== t.id) ?? null);
    await supabase.from("ss_todos").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", t.id);
  };

  const now = today();
  const overdue = (todos ?? []).filter((t) => t.due_date < now);
  const thisWeek = (todos ?? []).filter((t) => t.due_date >= now);
  const upcoming = meetings.map((m) => ({ m, at: nextMeeting(m) })).filter((x) => x.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())[0];

  const todoRow = (t: Todo) => (
    <li key={t.id} className="clickable" onClick={() => setEditing(t)}>
      <Tick done={false} label="Mark done" onToggle={() => done(t)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{t.title}</div>
        <div className={`small ${t.due_date < now ? "overdue" : "muted"}`}>Due {fmtDay(t.due_date)}</div>
      </div>
    </li>
  );

  return (
    <div className="stack">
      <div>
        <p className="label">{company.name}</p>
        <h1>Hi, {me.first_name}</h1>
      </div>

      <div className="row wrap">
        {upcoming && (
          <div className="card card-pad row" style={{ flex: "1 1 260px" }}>
            <CalendarClock size={22} color="var(--color-brand)" />
            <div><div className="small muted">Next meeting</div><strong style={{ color: "var(--color-fg)" }}>{upcoming.m.title}</strong>
              <div className="small">{fmtDateTime(upcoming.at!)}</div></div>
          </div>
        )}
        <Link to="/issues" className="card card-pad row" style={{ flex: "1 1 200px", color: "inherit" }}>
          <CircleAlert size={22} color="var(--color-brand)" />
          <div><div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)" }}>{issueCount ?? "–"}</div>
            <div className="small muted">My open Issues</div></div>
        </Link>
      </div>

      {todos === null ? <p className="muted">Loading…</p> : <>
        {overdue.length > 0 && (
          <Section title="Overdue" count={overdue.length}><ul className="card list">{overdue.map(todoRow)}</ul></Section>
        )}
        <Section title="Due this week" count={thisWeek.length} action={<Link to="/todos" className="small">All To-Dos</Link>}>
          {thisWeek.length ? <ul className="card list">{thisWeek.map(todoRow)}</ul> : <Empty>Nothing else due this week.</Empty>}
        </Section>
      </>}

      <Section title={`My Goals · ${qLabel(q)}`} count={goals.length} action={<Link to="/goals" className="small">All Goals</Link>}>
        {goals.length ? (
          <ul className="card list">
            {goals.map((r) => (
              <li key={r.id} className="clickable" onClick={() => navigate(`/goals/${r.id}`)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{r.title}</div>
                  <div className="row small muted" style={{ gap: 8 }}>
                    {r.due_date && <span>Due {fmtDay(r.due_date)}</span>}
                    <Progress {...(steps[r.id] ?? { done: 0, total: 0 })} />
                  </div>
                </div>
                <span className={`badge ${GOAL_STATUS[r.status].badge}`}>{GOAL_STATUS[r.status].label}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>No open Goals this quarter.</Empty>}
      </Section>

      {editing && <TodoSheet key={editing.id} todo={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onChanged={load} />}
    </div>
  );
}
