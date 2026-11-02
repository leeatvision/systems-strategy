import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Download, Plus, Printer, RotateCcw, SquareCheck, Trash2 } from "lucide-react";
import { downloadCsv } from "../lib/csv";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { addDays, fmtDay, today, useMeetings, useMembers, useOpenParam, type Issue } from "../lib/data";
import { FilterButton, FilterPanel, MineToggle, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { Avatar, Empty, Menu, OwnerSelect, Section } from "../components/ui";
import { ItemPanel } from "../components/ItemPanel";

const SOURCE: Record<string, string> = { goal: "From a Goal", todo: "From a To-Do", headline: "From a Headline", measurable: "From Key Numbers" };

export function Issues() {
  const { me, company } = useMe();
  const { active, byId, members } = useMembers();
  const { defaultMeetingId } = useMeetings();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const DEFAULTS = { owner: "all", status: "all", top: "all", source: "all" };
  const filters = useFilters("issues", DEFAULTS);
  const f = filters.values;
  const [showSolved, setShowSolved] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Issue | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_issues").select("*").is("deleted_at", null).is("archived_at", null)
      .order("sort_order").order("created_at");
    setIssues((data ?? []) as Issue[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useOpenParam(issues, "ss_issues", setEditing);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("ss_issues").insert({
      company_id: company.id, meeting_id: defaultMeetingId, owner_member_id: me.id, title: title.trim(),
      sort_order: (issues?.reduce((m, i) => Math.max(m, i.sort_order), 0) ?? 0) + 1, created_by: me.id,
    });
    if (error) setError(friendlyError(error)); else { setTitle(""); setError(""); load(); }
  };

  /** Top 3: giving a number to one Issue takes it away from whichever had it. */
  const setPriority = async (issue: Issue, p: number | null) => {
    const holder = issues?.find((i) => i.status === "open" && i.priority === p && i.id !== issue.id);
    if (p && holder) await supabase.from("ss_issues").update({ priority: null }).eq("id", holder.id);
    await supabase.from("ss_issues").update({ priority: p }).eq("id", issue.id);
    load();
  };
  const solve = async (issue: Issue, solved: boolean) => {
    await supabase.from("ss_issues").update(solved
      ? { status: "solved", solved_at: new Date().toISOString(), priority: null }
      : { status: "open", solved_at: null }).eq("id", issue.id);
    load();
  };

  const list = (issues ?? []).filter((i) => ownerMatches(f.owner, i.owner_member_id, me.id)
    && (f.status === "all" || i.status === f.status)
    && (f.top === "all" || (f.top === "top" ? !!i.priority : !i.priority))
    && (f.source === "all" || (f.source === "none" ? !i.source_type : i.source_type === f.source)));
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "solved", label: "Resolved" }, { value: "all", label: "Open and resolved" }] },
    { key: "top", label: "Top 3", options: [{ value: "all", label: "Any" }, { value: "top", label: "Top 3 only" }, { value: "rest", label: "Not in top 3" }] },
    { key: "source", label: "Came from", options: [{ value: "all", label: "Anywhere" }, { value: "none", label: "Added directly" }, { value: "goal", label: "A Goal" },
      { value: "todo", label: "A To-Do" }, { value: "headline", label: "A Headline" }, { value: "measurable", label: "Key Numbers" }] },
  ];
  const open = list.filter((i) => i.status === "open")
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.sort_order - b.sort_order);
  const solved = list.filter((i) => i.status === "solved");
  const extra = filters.active - (f.owner !== DEFAULTS.owner ? 1 : 0);
  const exportCsv = () => downloadCsv(`issues-${today()}`, ["Title", "Owner", "Status", "Top 3", "Source", "Details", "Created", "Resolved"],
    [...open, ...solved].map((i) => {
      const o = byId(i.owner_member_id);
      return [i.title, o ? fullName(o) : "", i.status, i.priority, i.source_type, i.description, i.created_at.slice(0, 10), i.solved_at?.slice(0, 10)];
    }));

  const row = (i: Issue) => (
    <li key={i.id} className="clickable" onClick={() => setEditing(i)}>
      {i.status === "open" ? (
        <select className={`prio${i.priority ? " prio-on" : ""}`} aria-label="Top 3 priority" value={i.priority ?? ""}
          onClick={(e) => e.stopPropagation()} onChange={(e) => setPriority(i, e.target.value ? Number(e.target.value) : null)}>
          <option value="">–</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
        </select>
      ) : <Avatar m={byId(i.owner_member_id)} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{i.title}</div>
        <div className="row small muted" style={{ gap: 8, flexWrap: "wrap" }}>
          <span>{byId(i.owner_member_id)?.first_name ?? "Unassigned"}</span>
          {i.source_type && <span>{SOURCE[i.source_type]}</span>}
          {i.status === "solved" && i.solved_at && <span>Resolved {fmtDay(i.solved_at)}</span>}
        </div>
      </div>
      {i.status === "open"
        ? <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); solve(i, true); }}><Check size={16} />Resolved</button>
        : <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); solve(i, false); }}><RotateCcw size={16} />Reopen</button>}
    </li>
  );

  return (
    <div className="stack">
      <div className="page-head goals-head"><h1>Issues</h1></div>
      <h2 className="print-only">Issues</h2>
      <div className="toolbar no-print">
        <MineToggle value={f.owner} onChange={(v) => filters.set("owner", v)} />
        <span className="spacer" />
        <FilterButton open={showFilters} active={filters.active} onToggle={() => setShowFilters(!showFilters)} />
        <Menu items={[
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: exportCsv },
        ]} />
      </div>
      {showFilters && <FilterPanel fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={list.length} total={(issues ?? []).length} />}
      {!showFilters && extra > 0 && issues && (
        <p className="small muted no-print" style={{ margin: 0 }}>Showing {list.length} of {issues.length} · <button type="button" className="link-btn" onClick={filters.reset}>Clear filters</button></p>
      )}
      <form className="card card-pad row no-print" onSubmit={add}>
        <input className="input" placeholder="Add an Issue…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!title.trim()} aria-label="Add Issue"><Plus size={18} /></button>
      </form>
      {error && <p className="error">{error}</p>}

      {issues === null ? <p className="muted">Loading…</p> : <>
        <Section title="Open" count={open.length}>
          {open.length ? <ul className="card list">{open.map(row)}</ul> : <Empty>No open Issues.</Empty>}
        </Section>
        <p className="small muted">Pick the top 3 with the number on the left; those are discussed first.</p>
        {solved.length > 0 && (
          <Section title="Resolved" count={solved.length}
            action={<button className="btn btn-ghost btn-sm" onClick={() => setShowSolved(!showSolved)}>{showSolved ? "Hide" : "Show"}</button>}>
            {(showSolved || f.status === "solved") && <ul className="card list">{solved.map(row)}</ul>}
          </Section>
        )}
      </>}

      {editing && <IssueSheet issue={editing} members={active} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onChanged={load} />}
    </div>
  );
}

function IssueSheet({ issue: start, members, onClose, onSaved, onChanged }: {
  issue: Issue; members: ReturnType<typeof useMembers>["active"]; onClose: () => void; onSaved: () => void; onChanged: () => void;
}) {
  const { me, company } = useMe();
  const { byId } = useMembers();
  const [issue, setIssue] = useState(start);
  const blank = () => ({ title: issue.title, description: issue.description ?? "", owner_member_id: issue.owner_member_id });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [todo, setTodo] = useState<{ owner: string | null; due: string } | null>(null);
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
    const row = { ...form, title: form.title.trim(), description: form.description.trim() || null };
    run(supabase.from("ss_issues").update(row).eq("id", issue.id), () => { setIssue({ ...issue, ...row }); setEditing(false); onChanged(); });
  };
  const resolve = (solved: boolean) => {
    const change = solved ? { status: "solved", solved_at: new Date().toISOString(), priority: null } : { status: "open", solved_at: null };
    run(supabase.from("ss_issues").update(change).eq("id", issue.id), () => { setIssue({ ...issue, ...change } as Issue); onChanged(); });
  };
  const makeTodo = () => todo && run(supabase.from("ss_todos").insert({
    company_id: company.id, meeting_id: issue.meeting_id, owner_member_id: todo.owner ?? me.id, title: issue.title,
    description: issue.description, due_date: todo.due, source_type: "issue", source_id: issue.id, created_by: me.id,
  }), () => { setTodo(null); setNotice(`To-Do added for ${byId(todo.owner ?? me.id)?.first_name ?? "you"}, due ${fmtDay(todo.due)}.`); });
  const toBin = () => confirm("Move this Issue to the recycle bin?")
    && run(supabase.from("ss_issues").update({ deleted_at: new Date().toISOString() }).eq("id", issue.id), onSaved);
  const startTodo = () => setTodo({ owner: issue.owner_member_id ?? me.id, due: addDays(today(), 7) });
  const owner = byId(issue.owner_member_id);
  const solved = issue.status === "solved";

  const edit = (
    <form className="stack" onSubmit={save}>
      <label className="field"><span>Title</span>
        <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="field"><span>Details</span>
        <textarea className="input textarea" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="field"><span>Owner</span>
        <OwnerSelect members={members} allowNone value={form.owner_member_id} onChange={(v) => setForm({ ...form, owner_member_id: v })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setForm(blank()); setEditing(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );

  return (
    <ItemPanel heading="Issue" itemType="issue" itemId={issue.id} onClose={onClose} editing={editing} onEdit={() => { setForm(blank()); setEditing(true); }} edit={edit}
      actions={[
        { label: "Make a To-Do", icon: <SquareCheck size={16} />, onSelect: startTodo },
        { label: solved ? "Reopen" : "Resolved", icon: solved ? <RotateCcw size={16} /> : <Check size={16} />, onSelect: () => resolve(!solved) },
        { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
      ]}>
      <div className="card goal-summary">
        <div className="panel-title">
          <h2>{issue.title}</h2>
          <span className={`badge badge-lg ${solved ? "badge-done" : "badge-warn"}`} style={{ cursor: "default" }}>{solved ? "Resolved" : "Open"}</span>
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "No owner"}</span>
          {issue.priority && <span className="badge">Top 3 · #{issue.priority}</span>}
          {issue.source_type && SOURCE[issue.source_type] && <span>{SOURCE[issue.source_type]}</span>}
          <span>Added {fmtDay(issue.created_at)}</span>
          {solved && issue.solved_at && <span>Resolved {fmtDay(issue.solved_at)}</span>}
        </div>
        {issue.description && <p className="goal-desc">{issue.description}</p>}
      </div>
      {(error || notice) && <p className={error ? "error" : "notice"}>{error || notice}</p>}
      {todo ? (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <strong style={{ color: "var(--color-fg)" }}>New To-Do from this Issue</strong>
          <div className="grid-2">
            <label className="field"><span>For</span><OwnerSelect members={members} value={todo.owner} onChange={(v) => setTodo({ ...todo, owner: v })} /></label>
            <label className="field"><span>Due</span><input className="input" type="date" value={todo.due} onChange={(e) => setTodo({ ...todo, due: e.target.value || todo.due })} /></label>
          </div>
          <div className="row"><button className="btn btn-primary btn-sm" disabled={busy} onClick={makeTodo}>Add To-Do</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTodo(null)}>Cancel</button></div>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          {!solved && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => resolve(true)}><Check size={16} />Resolved</button>}
          {solved && <button className="btn btn-sm" disabled={busy} onClick={() => resolve(false)}><RotateCcw size={16} />Reopen</button>}
          <button className="btn btn-sm" onClick={startTodo}><SquareCheck size={16} />Make a To-Do</button>
        </div>
      )}
    </ItemPanel>
  );
}
