import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarCheck, ChevronLeft, ChevronRight, Download, GanttChart, List, Plus, Printer } from "lucide-react";
import { downloadCsv } from "../lib/csv";
import { fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  GOAL_STATUS, GOAL_TYPE, currentQuarter, fmtDay, isoDay, qLabel, quarterEnd, shiftQuarter, today, useMembers,
  type Quarter, type Goal, type GoalStatus, type GoalType,
} from "../lib/data";
import { Avatar, Empty, Menu, Progress, Section } from "../components/ui";
import { QuarterClose } from "../components/QuarterClose";
import { DATE_OPTIONS, FilterButton, FilterPanel, dateMatches, ownerMatches, ownerOptions, useFilters } from "../components/Filters";

const GROUPS: GoalStatus[] = ["off_track", "on_track", "done", "not_done", "canceled"];

export function Goals() {
  const { me } = useMe();
  const { byId, members } = useMembers();
  const navigate = useNavigate();
  const [q, setQ] = useState<Quarter>(currentQuarter());
  const filters = useFilters("goals", { owner: "all", type: "all", status: "all", due: "any", finish: "any", sort: "status" });
  const f = filters.values;
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [steps, setSteps] = useState<Record<string, StepDot[]>>({});
  const [view, setView] = useState<"list" | "timeline">("list");
  const [closing, setClosing] = useState(false);
  const [showFilters, setShowFilters] = useState(filters.active > 0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setGoals(null);
    const isCurrent = q.quarter === currentQuarter().quarter && q.year === currentQuarter().year;
    // Goals without a quarter show up under the current quarter so they aren't lost.
    const inQuarter = `and(quarter.eq.${q.quarter},quarter_year.eq.${q.year})`;
    supabase.from("ss_goals").select("*").is("deleted_at", null)
      .or(isCurrent ? `${inQuarter},quarter.is.null` : inQuarter)
      .order("due_date", { nullsFirst: false }).order("title")
      .then(async ({ data }) => {
        if (!live) return;
        const list = (data ?? []) as Goal[];
        setGoals(list);
        if (!list.length) { setSteps({}); return; }
        const { data: s } = await supabase.from("ss_goal_steps").select("goal_id, due_on, completed_on, activity")
          .in("goal_id", list.map((r) => r.id)).order("sort_order");
        if (!live) return;
        const byGoal: Record<string, StepDot[]> = {};
        for (const row of (s ?? []) as (StepDot & { goal_id: string })[]) (byGoal[row.goal_id] ??= []).push(row);
        setSteps(byGoal);
      });
    return () => { live = false; };
  }, [q, reload]);

  const isOpen = (r: Goal) => r.status === "on_track" || r.status === "off_track";
  // Close-out is offered for this quarter and earlier ones, for Goals actually set to the quarter.
  const cur = currentQuarter();
  const canClose = q.year * 4 + q.quarter <= cur.year * 4 + cur.quarter;
  const toClose = (goals ?? []).filter((r) => isOpen(r) && r.quarter === q.quarter && r.quarter_year === q.year);
  // The Close out reminder shows in a quarter's last 4 weeks, or once it has ended, while its Goals are still open.
  const daysLeft = Math.round((new Date(`${quarterEnd(q)}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86400000);
  const remind = canClose && toClose.length > 0 && daysLeft <= 28;
  const whenText = daysLeft < 0 ? `${qLabel(q)} has ended` : daysLeft === 0 ? `Q${q.quarter} ends today`
    : daysLeft < 7 ? `Q${q.quarter} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
    : `Q${q.quarter} ends in ${Math.round(daysLeft / 7)} weeks`;
  const shown = (goals ?? []).filter((r) => ownerMatches(f.owner, r.owner_member_id, me.id)
    && (f.type === "all" || r.goal_type === f.type)
    && (f.status === "all" || (f.status === "open" ? isOpen(r) : r.status === f.status))
    && dateMatches(f.due, r.due_date, isOpen(r))
    && (f.finish === "reached" ? !!r.finish_line_completed_on : f.finish === "any" ? true : dateMatches(f.finish, r.finish_line_due, !r.finish_line_completed_on)))
    .sort((a, b) => f.sort === "due" ? (a.due_date ?? "9").localeCompare(b.due_date ?? "9")
      : f.sort === "finish" ? (a.finish_line_due ?? "9").localeCompare(b.finish_line_due ?? "9")
      : f.sort === "owner" ? (byId(a.owner_member_id)?.first_name ?? "").localeCompare(byId(b.owner_member_id)?.first_name ?? "")
      : f.sort === "title" ? a.title.localeCompare(b.title) : 0);
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "type", label: "Type", options: [{ value: "all", label: "All types" }, ...(Object.keys(GOAL_TYPE) as GoalType[]).map((t) => ({ value: t, label: GOAL_TYPE[t] }))] },
    { key: "status", label: "Status", options: [{ value: "all", label: "Any status" }, { value: "open", label: "On or off track" },
      ...(Object.keys(GOAL_STATUS) as GoalStatus[]).map((s) => ({ value: s, label: GOAL_STATUS[s].label }))] },
    { key: "due", label: "Due date", options: DATE_OPTIONS },
    { key: "finish", label: "Finish line", options: [...DATE_OPTIONS.map((o) => o.value === "none" ? { ...o, label: "No finish line date" } : o), { value: "reached", label: "Reached" }] },
    { key: "sort", label: "Sort by", options: [{ value: "status", label: "Status (grouped)" }, { value: "due", label: "Due date" },
      { value: "finish", label: "Finish line date" }, { value: "owner", label: "Owner" }, { value: "title", label: "Name" }] },
  ];
  const row = (r: Goal) => (
    <li key={r.id} className="clickable" onClick={() => navigate(`/goals/${r.id}`)}>
      <Avatar m={byId(r.owner_member_id)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{r.title}</div>
        <div className="row small muted" style={{ gap: 8, flexWrap: "wrap" }}>
          <span>{GOAL_TYPE[r.goal_type]}</span>
          {r.due_date && <span className={isOpen(r) && r.due_date < today() ? "overdue" : ""}>Due {fmtDay(r.due_date)}</span>}
          {r.finish_line_due && <span>Finish {fmtDay(r.finish_line_due)}{r.finish_line_completed_on ? " ✓" : ""}</span>}
          {!r.is_live && <span className="badge badge-warn">Draft</span>}
          <Progress {...tally(r.id)} />
        </div>
      </div>
      <span className={`badge ${GOAL_STATUS[r.status].badge}`}>{GOAL_STATUS[r.status].label}</span>
    </li>
  );
  const tally = (id: string) => ({ done: (steps[id] ?? []).filter((x) => x.completed_on).length, total: (steps[id] ?? []).length });
  const exportCsv = () => downloadCsv(`goals-${qLabel(q).replace(" ", "-")}`,
    ["Title", "Owner", "Type", "Status", "Draft", "Quarter", "Due", "Steps done", "Steps", "Specific", "Measurable", "Actionable", "Reviewable", "Time-framed", "Finish line", "Description"],
    shown.map((r) => {
      const o = byId(r.owner_member_id);
      const t = tally(r.id);
      return [r.title, o ? fullName(o) : "", GOAL_TYPE[r.goal_type], GOAL_STATUS[r.status].label, r.is_live ? "" : "yes",
        r.quarter ? `Q${r.quarter} ${r.quarter_year}` : "", r.due_date, t.done, t.total, r.smart_specific, r.smart_measurable,
        r.smart_actionable, r.smart_reviewable, r.smart_time_framed, r.finish_line, r.description];
    }));

  return (
    <div className="stack">
      <div className="page-head goals-head">
        <h1>Goals</h1>
        <span className="spacer" />
        <Link to="/goals/new" className="btn btn-primary btn-sm desktop-only"><Plus size={16} />New Goal</Link>
      </div>
      <h2 className="print-only">Goals · {qLabel(q)}</h2>

      <div className="toolbar no-print">
        <button className="btn btn-sm btn-ghost iconbtn" aria-label="Previous quarter" title="Previous quarter" onClick={() => setQ(shiftQuarter(q, -1))}><ChevronLeft size={18} /></button>
        <strong className="toolbar-q">{qLabel(q)}</strong>
        <button className="btn btn-sm btn-ghost iconbtn" aria-label="Next quarter" title="Next quarter" onClick={() => setQ(shiftQuarter(q, 1))}><ChevronRight size={18} /></button>
        <span className="spacer" />
        <span className="seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} aria-label="List" title="List" onClick={() => setView("list")}><List size={18} /></button>
          <button type="button" className={view === "timeline" ? "on" : ""} aria-pressed={view === "timeline"} aria-label="Timeline" title="Timeline" onClick={() => setView("timeline")}><GanttChart size={18} /></button>
        </span>
        <FilterButton open={showFilters} active={filters.active} onToggle={() => setShowFilters(!showFilters)} />
        <Menu items={[
          { label: `Close out ${qLabel(q)}`, icon: <CalendarCheck size={16} />, onSelect: () => setClosing(true), hidden: !(canClose && toClose.length > 0) },
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: exportCsv },
        ]} />
      </div>
      {showFilters && <FilterPanel fields={fields} values={f} defaults={{ owner: "all", type: "all", status: "all", due: "any", finish: "any", sort: "status" }}
        onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset} active={filters.active} shown={shown.length} total={goals?.length ?? 0} />}
      {!showFilters && filters.active > 0 && goals && (
        <p className="small muted no-print" style={{ margin: 0 }}>Showing {shown.length} of {goals.length} · <button type="button" className="link-btn" onClick={filters.reset}>Clear filters</button></p>
      )}
      {remind && (
        <div className="close-banner no-print">
          <span>{whenText} · {toClose.length} Goal{toClose.length === 1 ? "" : "s"} still open</span>
          <button type="button" className="link-btn" onClick={() => setClosing(true)}>Close out</button>
        </div>
      )}
      {closing && <QuarterClose q={q} goals={toClose} onClose={() => setClosing(false)} onDone={() => { setClosing(false); setReload((n) => n + 1); }} />}

      {goals === null ? <p className="muted">Loading…</p> : shown.length === 0 ? (
        <Empty>{goals.length ? "No Goals match these filters." : `No Goals for ${qLabel(q)}.`}</Empty>
      ) : view === "timeline" ? (
        <div className="card card-pad"><Timeline goals={shown} steps={steps} q={q} onOpen={(id) => navigate(`/goals/${id}`)} /></div>
      ) : f.sort !== "status" ? (
        <ul className="card list">{shown.map(row)}</ul>
      ) : GROUPS.map((g) => {
        const list = shown.filter((r) => r.status === g);
        if (!list.length) return null;
        return (
          <Section key={g} title={GOAL_STATUS[g].label} count={list.length}>
            <ul className="card list">{list.map(row)}</ul>
          </Section>
        );
      })}
      <div className="fab-space" aria-hidden />
      <Link to="/goals/new" className="fab no-print" aria-label="New Goal"><Plus size={20} />New Goal</Link>
    </div>
  );
}

interface StepDot { due_on: string | null; completed_on: string | null; activity: string }

function Timeline({ goals, steps, q, onOpen }: { goals: Goal[]; steps: Record<string, StepDot[]>; q: Quarter; onOpen: (id: string) => void }) {
  const start = isoDay(new Date(q.year, (q.quarter - 1) * 3, 1));
  const end = quarterEnd(q);
  const ms = (d: string) => new Date(`${d}T12:00:00`).getTime();
  const span = ms(end) - ms(start);
  const pos = (d: string) => `${Math.min(100, Math.max(0, ((ms(d) - ms(start)) / span) * 100))}%`;
  const now = today();
  const months = [0, 1, 2].map((i) => {
    const d = new Date(q.year, (q.quarter - 1) * 3 + i, 1);
    return { at: isoDay(d), label: d.toLocaleDateString(undefined, { month: "short" }) };
  });
  const sorted = [...goals].sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));

  return (
    <div className="timeline">
      <div className="tl-axis"><span /><div className="tl-months">{months.map((m) => <span key={m.at} style={{ left: pos(m.at) }}>{m.label}</span>)}</div></div>
      {sorted.map((r) => {
        const list = steps[r.id] ?? [];
        return (
          <div key={r.id} className="tl-row" onClick={() => onOpen(r.id)} title={r.title}>
            <span className="tl-name">{r.title}</span>
            <div className="tl-track">
              {r.due_date && <span className="tl-span" style={{ left: 0, width: pos(r.due_date) }} />}
              {now >= start && now <= end && <span className="tl-today" style={{ left: pos(now) }} />}
              {list.filter((s) => s.due_on).map((s, i) => (
                <span key={i} className={`tl-step${s.completed_on ? " done" : s.due_on! < now ? " late" : ""}`}
                  style={{ left: pos(s.due_on!) }} title={`${fmtDay(s.due_on)}: ${s.activity}${s.completed_on ? " (done)" : ""}`} />
              ))}
              {r.due_date && <span className="tl-due" style={{ left: pos(r.due_date) }} title={`Due ${fmtDay(r.due_date)}`} />}
            </div>
          </div>
        );
      })}
      <p className="small muted" style={{ marginTop: 6 }}>Dots are next steps (green done, red late). The dark mark is the due date; the green line is today.</p>
    </div>
  );
}
