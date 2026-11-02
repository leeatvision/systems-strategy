import { useState, type DragEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Member } from "../lib/supabase";
import { addDays, endOfWeek, fmtDay, isoDay, startOfWeek, today, type Todo } from "../lib/data";
import { PersonalBadge, Chips, Tick } from "../components/ui";

interface ViewProps {
  todos: Todo[];
  showOwner: boolean;
  byId: (id: string | null | undefined) => Member | undefined;
  onOpen: (t: Todo) => void;
  onToggle: (t: Todo) => void;
  onMove: (t: Todo, change: Partial<Todo>) => void;
}

const DRAG_TYPE = "text/x-todo-id";
const startDrag = (t: Todo) => (e: DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.effectAllowed = "move"; };

function DropZone({ onDrop, className, children }: { onDrop?: (id: string) => void; className: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  if (!onDrop) return <div className={className}>{children}</div>;
  return (
    <div className={`${className}${over ? " drop-over" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) onDrop(id); }}>
      {children}
    </div>
  );
}

function Card({ t, p, compact }: { t: Todo; p: ViewProps; compact?: boolean }) {
  const now = today();
  const owner = p.byId(t.owner_member_id);
  return (
    <div className={`todo-card${t.status === "done" ? " is-done" : ""}`} draggable onDragStart={startDrag(t)} onClick={() => p.onOpen(t)}>
      <Tick done={t.status === "done"} label={t.status === "done" ? "Mark not done" : "Mark done"} onToggle={() => p.onToggle(t)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={`card-title${t.status === "done" ? " struck" : ""}`}>
          {t.title}
        </div>
        {!compact && (
          <div className="small muted row" style={{ gap: 6, flexWrap: "wrap" }}>
            {p.showOwner && owner && <span>{owner.first_name}</span>}
            <span className={t.status === "open" && t.due_date < now ? "overdue" : ""}>Due {fmtDay(t.due_date)}</span>
            {t.is_personal && <PersonalBadge />}
            {t.priority === "high" && <span className="badge badge-danger">High</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Board ──────────────────────────────────────────────────────────────────

export function TodoBoard(p: ViewProps) {
  const now = today(), weekEnd = endOfWeek(), nextEnd = addDays(weekEnd, 7);
  const friday = (saturday: string) => addDays(saturday, -1);
  const open = p.todos.filter((t) => t.status === "open");
  const cols: { key: string; title: string; list: Todo[]; due?: string }[] = [
    { key: "overdue", title: "Overdue", list: open.filter((t) => t.due_date < now) },
    { key: "week", title: "This week", list: open.filter((t) => t.due_date >= now && t.due_date <= weekEnd), due: friday(weekEnd) < now ? weekEnd : friday(weekEnd) },
    { key: "next", title: "Next week", list: open.filter((t) => t.due_date > weekEnd && t.due_date <= nextEnd), due: friday(nextEnd) },
    { key: "later", title: "Later", list: open.filter((t) => t.due_date > nextEnd), due: friday(addDays(nextEnd, 7)) },
    { key: "done", title: "Done", list: p.todos.filter((t) => t.status === "done") },
  ];
  const drop = (col: (typeof cols)[number]) => (id: string) => {
    const t = p.todos.find((x) => x.id === id);
    if (!t) return;
    if (col.key === "done") { if (t.status !== "done") p.onToggle(t); return; }
    if (col.due) p.onMove(t, { due_date: col.due, ...(t.status === "done" ? { status: "open", completed_at: null } : {}) });
  };
  return (
    <div className="board">
      {cols.map((c) => (
        <DropZone key={c.key} className="board-col" onDrop={c.key === "overdue" ? undefined : drop(c)}>
          <div className="label board-head">{c.title}<span className="count">{c.list.length}</span></div>
          {c.list.map((t) => <Card key={t.id} t={t} p={p} />)}
          {c.list.length === 0 && <p className="small muted board-empty">{c.key === "overdue" ? "Nothing overdue" : "Drop here"}</p>}
        </DropZone>
      ))}
    </div>
  );
}

// ─── Calendar ───────────────────────────────────────────────────────────────

const dayOf = (t: Todo) => t.due_date;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function TodoCalendar(p: ViewProps) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today());
  const now = today();

  const byDay = new Map<string, Todo[]>();
  for (const t of p.todos) {
    const k = dayOf(t);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }

  let days: string[];
  let title: string;
  if (mode === "week") {
    const mon = startOfWeek(anchor);
    days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    title = `${fmtDay(days[0])} – ${fmtDay(days[6], true)}`;
  } else {
    const a = new Date(`${anchor}T12:00:00`);
    const first = isoDay(new Date(a.getFullYear(), a.getMonth(), 1));
    const last = isoDay(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    const start = startOfWeek(first);
    const weeks = Math.ceil((((new Date(`${last}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000) + 1) / 7);
    days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
    title = a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const month = anchor.slice(0, 7);
  const shift = (n: number) => {
    if (mode === "week") setAnchor(addDays(anchor, 7 * n));
    else { const a = new Date(`${anchor}T12:00:00`); setAnchor(isoDay(new Date(a.getFullYear(), a.getMonth() + n, 1))); }
  };
  const drop = (day: string) => (id: string) => {
    const t = p.todos.find((x) => x.id === id);
    if (t && dayOf(t) !== day) p.onMove(t, { due_date: day });
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row wrap">
        <button className="btn btn-sm btn-ghost" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <strong style={{ color: "var(--color-fg)" }}>{title}</strong>
        <button className="btn btn-sm btn-ghost" aria-label="Next" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button className="btn btn-sm" onClick={() => setAnchor(today())}>Today</button>
        <span className="spacer" />
        <Chips value={mode} onChange={setMode} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      </div>
      <p className="small muted">To-Dos sit on their due date. On a computer, drag one to another day to change its due date; on a phone, tap it and change Due.</p>

      {mode === "week" ? (
        <div className="cal-week">
          {days.map((d, i) => (
            <DropZone key={d} className={`cal-day${d === now ? " is-today" : ""}`} onDrop={drop(d)}>
              <div className="cal-day-head"><span className="label">{WEEKDAY_NAMES[i]}</span> <strong>{fmtDay(d)}</strong></div>
              {(byDay.get(d) ?? []).map((t) => <Card key={t.id} t={t} p={p} />)}
            </DropZone>
          ))}
        </div>
      ) : (
        <div className="cal-month">
          {WEEKDAY_NAMES.map((n) => <div key={n} className="label cal-month-head">{n}</div>)}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <DropZone key={d} className={`cal-cell${d.slice(0, 7) !== month ? " other-month" : ""}${d === now ? " is-today" : ""}`} onDrop={drop(d)}>
                <button className="cal-date" onClick={() => { setAnchor(d); setMode("week"); }}>{Number(d.slice(8))}</button>
                {list.slice(0, 3).map((t) => <Card key={t.id} t={t} p={p} compact />)}
                {list.length > 3 && <button className="link-btn small" onClick={() => { setAnchor(d); setMode("week"); }}>+{list.length - 3} more</button>}
              </DropZone>
            );
          })}
        </div>
      )}
    </div>
  );
}
