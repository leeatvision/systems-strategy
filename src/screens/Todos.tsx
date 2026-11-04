import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, CircleAlert, Columns3, Download, List, Plus, Printer, Repeat, Trash2 } from "lucide-react";
import { downloadCsv } from "../lib/csv";
import { TodoBoard, TodoCalendar } from "./TodoViews";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  addDays, endOfWeek, fmtDay, parsePlainDate, today, useMeetings, useMembers, useOpenParam,
  type ChecklistItem, type Todo,
} from "../lib/data";
import { DATE_OPTIONS, FilterButton, FilterPanel, MineToggle, dateMatches, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { Empty, Menu, OwnerChips, OwnerSelect, PersonalBadge, Section, Tick } from "../components/ui";
import { ItemPanel } from "../components/ItemPanel";
import { RepeatPicker } from "../components/RepeatPicker";
import { repeatOf, repeatText, sameRule } from "../lib/repeat";

export function Todos() {
  const { me, company } = useMe();
  const { active, byId, members } = useMembers();
  const { defaultMeetingId } = useMeetings();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const DEFAULTS = { owner: "me", status: "open", due: "any", priority: "all", personal: "all" };
  // Open To-Dos only by default; done ones are a filter choice.
  const filters = useFilters("todos", DEFAULTS, { version: 2, renew: ["status"] });
  const f = filters.values;
  const who = f.owner === "me" ? "me" : "all";
  const [showDone, setShowDone] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [view, setViewState] = useState<"list" | "board" | "calendar">(() => {
    try { return (localStorage.getItem("ss.todoView") as "list" | "board" | "calendar") || "list"; } catch { return "list"; }
  });
  const setView = (v: typeof view) => { setViewState(v); try { localStorage.setItem("ss.todoView", v); } catch { /* private mode */ } };

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_todos").select("*").is("deleted_at", null).is("archived_at", null)
      .order("due_date").order("created_at");
    setTodos((data ?? []) as Todo[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useOpenParam(todos, "ss_todos", setEditing);

  const toggle = async (t: Todo) => {
    const done = t.status !== "done";
    setTodos((list) => list?.map((x) => (x.id === t.id ? { ...x, status: done ? "done" : "open" } : x)) ?? null);
    await supabase.from("ss_todos").update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null }).eq("id", t.id);
    load();
  };
  const move = async (t: Todo, change: Partial<Todo>) => {
    setTodos((list) => list?.map((x) => (x.id === t.id ? { ...x, ...change } : x)) ?? null);
    await supabase.from("ss_todos").update(change).eq("id", t.id);
    load();
  };
  const exportCsv = () => downloadCsv(`todos-${today()}`,
    ["Title", "Owner", "Due", "Status", "Priority", "Personal", "Repeats", "Notes", "Created"],
    mine.map((t) => {
      const o = byId(t.owner_member_id);
      return [t.title, o ? fullName(o) : "", t.due_date, t.status, t.priority, t.is_personal ? "yes" : "", repeatText(repeatOf(t)), t.description, t.created_at.slice(0, 10)];
    }));

  const mine = (todos ?? []).filter((t) => ownerMatches(f.owner, t.owner_member_id, me.id)
    && (f.status === "all" || t.status === f.status)
    && dateMatches(f.due, t.due_date, t.status === "open")
    && (f.priority === "all" || t.priority === f.priority)
    && (f.personal === "all" || (f.personal === "personal" ? t.is_personal : !t.is_personal)));
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "Open and done" }] },
    { key: "due", label: "Due", options: DATE_OPTIONS.filter((o) => o.value !== "none") },
    { key: "priority", label: "Priority", options: [{ value: "all", label: "Any priority" }, { value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }] },
    { key: "personal", label: "Personal", options: [{ value: "all", label: "Personal and shared" }, { value: "personal", label: "Personal only" }, { value: "shared", label: "Shared only" }] },
  ];
  const open = mine.filter((t) => t.status === "open");
  const extra = filters.active - (f.owner !== DEFAULTS.owner ? 1 : 0);
  const filterNote = f.status === "done" ? "Showing done To-Dos" : f.status === "all" ? "Showing open and done To-Dos"
    : `${extra} filter${extra === 1 ? "" : "s"} on`;
  const done = mine.filter((t) => t.status === "done");
  const now = today(), weekEnd = endOfWeek();
  const groups = [
    { title: "Overdue", list: open.filter((t) => t.due_date < now) },
    { title: "Due this week", list: open.filter((t) => t.due_date >= now && t.due_date <= weekEnd) },
    { title: "Later", list: open.filter((t) => t.due_date > weekEnd) },
  ];

  const row = (t: Todo) => {
    const owner = byId(t.owner_member_id);
    const overdue = t.status === "open" && t.due_date < now;
    return (
      <li key={t.id} className="clickable" onClick={() => setEditing(t)}>
        <Tick done={t.status === "done"} label={t.status === "done" ? "Mark not done" : "Mark done"} onToggle={() => toggle(t)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={`item-title${t.status === "done" ? " struck" : ""}`}>{t.title}</div>
          <div className="row small muted" style={{ gap: 8, flexWrap: "wrap" }}>
            {who === "all" && owner && <span>{owner.first_name}</span>}
            <span className={overdue ? "overdue" : ""}>Due {fmtDay(t.due_date)}</span>
            {repeatOf(t) && <span className="row" style={{ gap: 2 }}><Repeat size={12} />{repeatText(repeatOf(t))}</span>}
            {t.is_personal && <PersonalBadge />}
            {t.priority === "high" && <span className="badge badge-danger">High</span>}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="stack">
      <div className="page-head goals-head">
        <h1>To-Dos</h1>
      </div>
      <h2 className="print-only">To-Dos</h2>
      <div className="toolbar no-print">
        <span className="seg" role="group" aria-label="View">
          {([["list", "List", List], ["board", "Board", Columns3], ["calendar", "Calendar", CalendarDays]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} aria-label={label} title={label} onClick={() => setView(v)}><Icon size={18} /></button>
          ))}
        </span>
        <span className="spacer" />
        <MineToggle value={f.owner} onChange={(v) => filters.set("owner", v)} />
        <FilterButton open={showFilters} active={filters.active} onToggle={() => setShowFilters(!showFilters)} />
        <Menu items={[
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: exportCsv },
        ]} />
      </div>
      {showFilters && <FilterPanel fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={mine.length} total={(todos ?? []).length} />}
      {!showFilters && extra > 0 && todos && (
        <p className="small muted no-print" style={{ margin: 0 }}>{filterNote} · <button type="button" className="link-btn" onClick={filters.reset}>Clear filters</button></p>
      )}

      <QuickAdd companyId={company.id} meId={me.id} members={active} meetingId={defaultMeetingId} onAdded={load} />

      {todos !== null && view !== "list" && (view === "board"
        ? <TodoBoard todos={mine} showOwner={who === "all"} byId={byId} onOpen={setEditing} onToggle={toggle} onMove={move} />
        : <TodoCalendar todos={mine} showOwner={who === "all"} byId={byId} onOpen={setEditing} onToggle={toggle} onMove={move} />)}

      {todos === null ? <p className="muted">Loading…</p> : view === "list" && <>
        {f.status !== "done" && open.length === 0 && <Empty>{filters.active > (f.owner !== DEFAULTS.owner ? 1 : 0) ? "No open To-Dos match these filters." : "Nothing open. Nice."}</Empty>}
        {f.status === "done" && done.length === 0 && <Empty>No done To-Dos match these filters.</Empty>}
        {groups.map((g) => g.list.length > 0 && (
          <Section key={g.title} title={g.title} count={g.list.length}>
            <ul className="card list">{g.list.map(row)}</ul>
          </Section>
        ))}
        {done.length > 0 && (
          <Section title="Done" count={done.length}
            action={f.status === "all" && <button className="btn btn-ghost btn-sm" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"}</button>}>
            {(showDone || f.status === "done") && <ul className="card list">{done.map(row)}</ul>}
          </Section>
        )}
      </>}

      {editing && <TodoSheet key={editing.id} todo={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onChanged={load} />}
    </div>
  );
}

function QuickAdd({ companyId, meId, members, meetingId, onAdded }: {
  companyId: string; meId: string; members: ReturnType<typeof useMembers>["active"]; meetingId: string | null; onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [owners, setOwners] = useState<string[]>([meId]);
  const [due, setDue] = useState(addDays(today(), 7));
  const [personal, setPersonal] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const onlyMe = owners.length === 1 && owners[0] === meId;
  const parsed = parsePlainDate(title);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title || !owners.length) return;
    const { error } = await supabase.from("ss_todos").insert(owners.map((o) => ({
      company_id: companyId, meeting_id: meetingId, owner_member_id: o, title: parsed.title, due_date: parsed.due ?? due,
      is_personal: onlyMe && personal, created_by: meId,
    })));
    if (error) { setError(friendlyError(error)); return; }
    setTitle(""); setError(""); setPersonal(false); onAdded();
  };

  return (
    <form className="card card-pad stack no-print" style={{ gap: 10 }} onSubmit={add}>
      <div className="row">
        <input className="input" placeholder='Add a To-Do… (try "Call supplier fri")' value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setOpen(true)} />
        <button className="btn btn-primary btn-sm" disabled={!title.trim() || !owners.length} aria-label="Add To-Do"><Plus size={18} /></button>
      </div>
      {open && <>
        <div className="row wrap small"><span className="muted">For</span><OwnerChips members={members} value={owners} onChange={setOwners} /></div>
        <div className="row wrap small">
          {parsed.due ? (
            <span className="badge badge-green">Due {fmtDay(parsed.due)} (from "{parsed.said}")</span>
          ) : (
            <label className="row" style={{ gap: 6 }}><span className="muted">Due</span>
              <input className="input input-sm" type="date" value={due} onChange={(e) => setDue(e.target.value || addDays(today(), 7))} />
            </label>
          )}
          {onlyMe && <label className="row" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />Personal (only you see it)
          </label>}
          {owners.length > 1 && <span className="muted">Adds one To-Do for each person.</span>}
        </div>
      </>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function TodoSheet({ todo: start, onClose, onSaved, onChanged }: { todo: Todo; onClose: () => void; onSaved: () => void; onChanged?: () => void }) {
  const { me, company } = useMe();
  const { active, byId } = useMembers();
  const [todo, setTodo] = useState(start);
  const blank = () => ({
    title: todo.title, description: todo.description ?? "", owner_member_id: todo.owner_member_id,
    due_date: todo.due_date, priority: todo.priority, is_personal: todo.is_personal,
    repeat: repeatOf(todo),
  });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (p: PromiseLike<{ error: unknown }>, after: () => void) => {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    if (error) setError(friendlyError(error)); else { setError(""); after(); }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const row = {
      ...form, title: form.title.trim(), description: form.description.trim() || null,
      is_personal: form.owner_member_id === me.id && form.is_personal, repeat_rule: null,
      repeat: form.repeat && sameRule(form.repeat, repeatOf(todo)) ? { ...form.repeat, n: repeatOf(todo)?.n } : form.repeat,
    };
    run(supabase.from("ss_todos").update(row).eq("id", todo.id), () => { setTodo({ ...todo, ...row }); setEditing(false); onChanged?.(); });
  };
  const toggleDone = () => {
    const done = todo.status !== "done";
    const change = { status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null } as Partial<Todo>;
    setTodo({ ...todo, ...change });
    run(supabase.from("ss_todos").update(change).eq("id", todo.id), () => onChanged?.());
  };
  const dropToIssues = () => run(supabase.from("ss_issues").insert({
    company_id: company.id, meeting_id: todo.meeting_id, owner_member_id: todo.owner_member_id, title: todo.title,
    description: todo.description, source_type: "todo", source_id: todo.id, created_by: me.id,
  }), () => setNotice("Added to Issues."));
  const toBin = () => confirm("Move this To-Do to the recycle bin?")
    && run(supabase.from("ss_todos").update({ deleted_at: new Date().toISOString() }).eq("id", todo.id), onSaved);

  const owner = byId(todo.owner_member_id);
  const overdue = todo.status === "open" && todo.due_date < today();

  const edit = (
    <form className="stack" onSubmit={save}>
      <label className="field"><span>Title</span>
        <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="field"><span>Notes</span>
        <textarea className="input textarea" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="grid-2">
        <label className="field"><span>Owner</span>
          <OwnerSelect members={active} value={form.owner_member_id} onChange={(v) => v && setForm({ ...form, owner_member_id: v })} />
        </label>
        <label className="field"><span>Due</span>
          <input className="input" type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </label>
        <label className="field"><span>Priority</span>
          <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Todo["priority"] })}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </label>
      </div>
      <div className="field"><span>Repeats</span>
        <RepeatPicker due={form.due_date} value={form.repeat} onChange={(r) => setForm({ ...form, repeat: r })} />
      </div>
      {form.owner_member_id === me.id && (
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_personal} onChange={(e) => setForm({ ...form, is_personal: e.target.checked })} />
          Personal: only you can see it
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setForm(blank()); setEditing(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );

  return (
    <ItemPanel heading="To-Do" itemType="todo" itemId={todo.id} onClose={onClose} editing={editing} onEdit={() => { setForm(blank()); setEditing(true); }} edit={edit}
      actions={[
        { label: "Drop into Issues", icon: <CircleAlert size={16} />, onSelect: dropToIssues },
        { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
      ]}>
      <div className="card goal-summary">
        <div className="panel-title">
          <Tick done={todo.status === "done"} label={todo.status === "done" ? "Mark not done" : "Mark done"} onToggle={toggleDone} />
          <h2 className={todo.status === "done" ? "struck" : ""}>{todo.title}</h2>
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "No owner"}</span>
          <span className={overdue ? "overdue" : ""}>Due {fmtDay(todo.due_date)}{overdue ? " · overdue" : ""}</span>
          {repeatOf(todo) && <span className="row" style={{ gap: 3 }}><Repeat size={13} />{repeatText(repeatOf(todo))}</span>}
          {todo.priority === "high" && <span className="badge badge-danger">High</span>}
          {todo.is_personal && <PersonalBadge />}
        </div>
        {todo.description && <p className="goal-desc">{todo.description}</p>}
      </div>
      {(error || notice) && <p className={error ? "error" : "notice"}>{error || notice}</p>}
      <div className="card card-pad"><Checklist todo={todo} /></div>
    </ItemPanel>
  );
}

function Checklist({ todo }: { todo: Todo }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [draft, setDraft] = useState("");
  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_todo_checklist").select("*").eq("todo_id", todo.id).order("sort_order");
    setItems((data ?? []) as ChecklistItem[]);
  }, [todo.id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.trim()) return;
    await supabase.from("ss_todo_checklist").insert({
      company_id: todo.company_id, todo_id: todo.id, title: draft.trim(), sort_order: (items.at(-1)?.sort_order ?? 0) + 1,
    });
    setDraft(""); load();
  };
  const toggle = async (c: ChecklistItem) => {
    setItems((l) => l.map((x) => (x.id === c.id ? { ...x, is_done: !x.is_done } : x)));
    await supabase.from("ss_todo_checklist").update({ is_done: !c.is_done }).eq("id", c.id);
  };
  const done = items.filter((c) => c.is_done).length;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <h3>Checklist{items.length > 0 && <span className="count">{done}/{items.length}</span>}</h3>
      {items.map((c) => (
        <div key={c.id} className="row" style={{ gap: 8 }}>
          <Tick done={c.is_done} label={c.is_done ? "Mark not done" : "Mark done"} onToggle={() => toggle(c)} />
          <span className={c.is_done ? "struck" : ""} style={{ flex: 1 }}>{c.title}</span>
          <button type="button" className="link-btn" aria-label="Remove"
            onClick={() => supabase.from("ss_todo_checklist").delete().eq("id", c.id).then(load)}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="row">
        <input className="input" placeholder="Add a checklist item" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn btn-sm" disabled={!draft.trim()} onClick={add}><Plus size={16} /></button>
      </div>
    </div>
  );
}
