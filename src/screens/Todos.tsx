import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleAlert, Download, Lock, Plus, Repeat, Trash2 } from "lucide-react";
import { downloadCsv } from "../lib/csv";
import { TodoBoard, TodoCalendar } from "./TodoViews";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  REPEAT, addDays, endOfWeek, fmtDay, parsePlainDate, today, useMeetings, useMembers, useOpenParam,
  type ChecklistItem, type RepeatRule, type Todo,
} from "../lib/data";
import { Comments } from "../components/Comments";
import { DATE_OPTIONS, FilterBar, dateMatches, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { Attachments } from "../components/Attachments";
import { Chips, Empty, OwnerChips, OwnerSelect, Section, Tick } from "../components/ui";
import { Sheet } from "../components/Sheet";

export function Todos() {
  const { me, company } = useMe();
  const { active, byId, members } = useMembers();
  const { defaultMeetingId } = useMeetings();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const DEFAULTS = { owner: "me", status: "all", due: "any", priority: "all", personal: "all" };
  const filters = useFilters("todos", DEFAULTS);
  const f = filters.values;
  const who = f.owner === "me" ? "me" : "all";
  const [showDone, setShowDone] = useState(false);
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
      return [t.title, o ? fullName(o) : "", t.due_date, t.status, t.priority, t.is_personal ? "yes" : "", t.repeat_rule, t.description, t.created_at.slice(0, 10)];
    }));

  const mine = (todos ?? []).filter((t) => ownerMatches(f.owner, t.owner_member_id, me.id)
    && (f.status === "all" || t.status === f.status)
    && dateMatches(f.due, t.due_date, t.status === "open")
    && (f.priority === "all" || t.priority === f.priority)
    && (f.personal === "all" || (f.personal === "personal" ? t.is_personal : !t.is_personal)));
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "status", label: "Status", options: [{ value: "all", label: "Open and done" }, { value: "open", label: "Open" }, { value: "done", label: "Done" }] },
    { key: "due", label: "Due", options: DATE_OPTIONS.filter((o) => o.value !== "none") },
    { key: "priority", label: "Priority", options: [{ value: "all", label: "Any priority" }, { value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }] },
    { key: "personal", label: "Personal", options: [{ value: "all", label: "Personal and shared" }, { value: "personal", label: "Personal only" }, { value: "shared", label: "Shared only" }] },
  ];
  const open = mine.filter((t) => t.status === "open");
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
            {t.repeat_rule && <span className="row" style={{ gap: 2 }}><Repeat size={12} />{REPEAT[t.repeat_rule]}</span>}
            {t.is_personal && <span className="row" style={{ gap: 2 }}><Lock size={12} />Personal</span>}
            {t.priority === "high" && <span className="badge badge-danger">High</span>}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>To-Dos</h1>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost no-print" onClick={exportCsv} aria-label="Export to CSV" title="Export to CSV"><Download size={18} /></button>
      </div>
      <div className="row wrap no-print">
        <Chips value={view} onChange={setView} options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }, { value: "calendar", label: "Calendar" }]} />
        <span className="spacer" />
        <Chips value={f.owner === "me" ? "me" : f.owner === "all" ? "all" : ""} onChange={(v) => filters.set("owner", v)}
          options={[{ value: "me", label: "Mine" }, { value: "all", label: "Everyone" }]} />
      </div>
      <FilterBar fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={mine.length} total={(todos ?? []).length} />

      <QuickAdd companyId={company.id} meId={me.id} members={active} meetingId={defaultMeetingId} onAdded={load} />

      {todos !== null && view !== "list" && (view === "board"
        ? <TodoBoard todos={mine} showOwner={who === "all"} byId={byId} onOpen={setEditing} onToggle={toggle} onMove={move} />
        : <TodoCalendar todos={mine} showOwner={who === "all"} byId={byId} onOpen={setEditing} onToggle={toggle} onMove={move} />)}

      {todos === null ? <p className="muted">Loading…</p> : view === "list" && <>
        {open.length === 0 && <Empty>Nothing open. Nice.</Empty>}
        {groups.map((g) => g.list.length > 0 && (
          <Section key={g.title} title={g.title} count={g.list.length}>
            <ul className="card list">{g.list.map(row)}</ul>
          </Section>
        ))}
        {done.length > 0 && (
          <Section title="Done" count={done.length}
            action={<button className="btn btn-ghost btn-sm" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"}</button>}>
            {showDone && <ul className="card list">{done.map(row)}</ul>}
          </Section>
        )}
      </>}

      {editing && <TodoSheet todo={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

export function TodoSheet({ todo, onClose, onSaved }: { todo: Todo; onClose: () => void; onSaved: () => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const [form, setForm] = useState({
    title: todo.title, description: todo.description ?? "", owner_member_id: todo.owner_member_id,
    due_date: todo.due_date, priority: todo.priority, is_personal: todo.is_personal,
    repeat_rule: (todo.repeat_rule ?? "") as RepeatRule | "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (p: PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    run(supabase.from("ss_todos").update({
      ...form, title: form.title.trim(), description: form.description.trim() || null,
      is_personal: form.owner_member_id === me.id && form.is_personal,
      repeat_rule: form.repeat_rule || null,
    }).eq("id", todo.id));
  };
  const dropToIssues = () => run(supabase.from("ss_issues").insert({
    company_id: company.id, meeting_id: todo.meeting_id, owner_member_id: todo.owner_member_id, title: todo.title,
    description: todo.description, source_type: "todo", source_id: todo.id, created_by: me.id,
  }));
  const toBin = () => run(supabase.from("ss_todos").update({ deleted_at: new Date().toISOString() }).eq("id", todo.id));

  return (
    <Sheet title="To-Do" onClose={onClose}>
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
          <label className="field"><span>Repeats</span>
            <select className="select" value={form.repeat_rule} onChange={(e) => setForm({ ...form, repeat_rule: e.target.value as RepeatRule | "" })}>
              <option value="">Doesn't repeat</option>
              {(Object.keys(REPEAT) as RepeatRule[]).map((k) => <option key={k} value={k}>{REPEAT[k]}</option>)}
            </select>
          </label>
          <label className="field"><span>Priority</span>
            <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Todo["priority"] })}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </label>
        </div>
        {form.owner_member_id === me.id && (
          <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_personal} onChange={(e) => setForm({ ...form, is_personal: e.target.checked })} />
            Personal: only you can see it
          </label>
        )}
        {form.repeat_rule && <p className="small muted">The next one is created when this one is ticked done.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>Save</button>
        <Checklist todo={todo} />
        <div className="row wrap">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={dropToIssues}><CircleAlert size={16} />Drop into Issues</button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={toBin}><Trash2 size={16} />Recycle bin</button>
        </div>
      </form>
      <div style={{ marginTop: 20 }}><Attachments itemType="todo" itemId={todo.id} /></div>
      <div style={{ marginTop: 20 }}><Comments itemType="todo" itemId={todo.id} /></div>
    </Sheet>
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
