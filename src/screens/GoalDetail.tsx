import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  GOAL_STATUS, GOAL_STATUSES, GOAL_TYPE, currentQuarter, fmtDateTime, fmtDay, quarterEnd, today, useMeetings, useMembers,
  type Goal, type GoalResource, type GoalStep, type GoalType,
} from "../lib/data";
import { fullName, type Member } from "../lib/supabase";
import { DateInput, Fold, Menu, OwnerSelect, Tick } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { History } from "../components/History";
import { Comments } from "../components/Comments";
import { Attachments } from "../components/Attachments";

type Form = Omit<Goal, "id" | "company_id" | "completed_at" | "deleted_at" | "archived_at" | "created_at" | "updated_at">;

const SMART: { key: keyof Form; label: string; hint: string }[] = [
  { key: "smart_specific", label: "Specific", hint: "What specifically will I achieve?" },
  { key: "smart_measurable", label: "Measurable", hint: "How will I measure completion?" },
  { key: "smart_actionable", label: "Actionable", hint: "Is it actionable by me or the team now?" },
  { key: "smart_reviewable", label: "Reviewable", hint: "Can progress be reviewed?" },
  { key: "smart_time_framed", label: "Time-framed", hint: "Key dates and the final date" },
];

function blankGoal(ownerId: string, meetingId: string | null): Form {
  const q = currentQuarter();
  return {
    meeting_id: meetingId, owner_member_id: ownerId, title: "", description: null, goal_type: "company", is_live: true,
    status: "on_track", quarter: q.quarter, quarter_year: q.year, due_date: quarterEnd(q),
    reviewed_by_member_id: null, reviewed_by_text: null,
    smart_specific: null, smart_measurable: null, smart_actionable: null, smart_reviewable: null, smart_time_framed: null,
    finish_line: null, finish_line_due: null, finish_line_completed_on: null,
  };
}

type FoldName = "smart" | "resources" | "comments" | "files" | "history";

function toForm(r: Goal): Form {
  const { id: _i, company_id: _c, completed_at: _ca, deleted_at: _d, archived_at: _a, created_at: _cr, updated_at: _u, ...rest } = r;
  return rest;
}

/** A Goal's page; with `goalId` it's shown inside a panel (e.g. during a meeting) and `onClose` replaces leaving the page. */
export function GoalDetail({ goalId, onClose, onChanged }: { goalId?: string; onClose?: () => void; onChanged?: () => void } = {}) {
  const params = useParams();
  const id = goalId ?? params.id;
  const isNew = id === "new";
  const { me, company } = useMe();
  const { byId, members } = useMembers();
  const { defaultMeetingId } = useMeetings();
  const navigate = useNavigate();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [draft, setDraft] = useState<Form>(() => blankGoal(me.id, null));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [open, setOpen] = useState<FoldName | null>(null);
  const [counts, setCounts] = useState({ resources: 0, comments: 0, files: 0 });

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const { data, error } = await supabase.from("ss_goals").select("*").eq("id", id).maybeSingle();
    if (error || !data) { setMsg({ ok: false, text: "That Goal wasn't found." }); return; }
    setGoal(data as Goal);
  }, [id, isNew]);
  useEffect(() => { load(); }, [load]);

  // Counts for the folded sections, so it's clear what's inside before opening them.
  useEffect(() => {
    if (isNew || !id) return;
    Promise.all([
      supabase.from("ss_goal_resources").select("id", { count: "exact", head: true }).eq("goal_id", id),
      supabase.from("ss_comments").select("id", { count: "exact", head: true }).eq("item_type", "goal").eq("item_id", id).is("deleted_at", null),
      supabase.from("ss_attachments").select("id", { count: "exact", head: true }).eq("item_type", "goal").eq("item_id", id),
    ]).then(([r, c, f]) => setCounts({ resources: r.count ?? 0, comments: c.count ?? 0, files: f.count ?? 0 }));
  }, [id, isNew]);

  useEffect(() => {
    if (isNew && defaultMeetingId) setDraft((f) => (!f.meeting_id ? { ...f, meeting_id: defaultMeetingId } : f));
  }, [isNew, defaultMeetingId]);

  /** Saves changed fields; returns an error message, or "" when saved. */
  const update = async (change: Partial<Form>): Promise<string> => {
    if (!goal) return "";
    const row: Partial<Goal> = { ...change };
    if (change.status) row.completed_at = change.status === "done" ? (goal.completed_at ?? new Date().toISOString()) : null;
    setGoal({ ...goal, ...row });
    const { error } = await supabase.from("ss_goals").update(row).eq("id", goal.id);
    if (error) { await load(); return friendlyError(error); }
    setHistoryKey((k) => k + 1);
    onChanged?.();
    return "";
  };

  const create = async (form: Form): Promise<string> => {
    const { data, error } = await supabase.from("ss_goals")
      .insert({ ...form, title: form.title.trim(), completed_at: null, company_id: company.id, created_by: me.id }).select("id").single();
    if (error) return friendlyError(error);
    navigate(`/goals/${data.id}`, { replace: true });
    return "";
  };

  const dropToIssues = async () => {
    if (!goal) return;
    const { error } = await supabase.from("ss_issues").insert({
      company_id: company.id, meeting_id: goal.meeting_id, owner_member_id: goal.owner_member_id, title: goal.title,
      source_type: "goal", source_id: goal.id, created_by: me.id,
    });
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: "Added to Issues." });
  };

  const toBin = async () => {
    if (!goal || !confirm("Move this Goal to the recycle bin? You can restore it from More → Recycle bin.")) return;
    const { error } = await supabase.from("ss_goals").update({ deleted_at: new Date().toISOString() }).eq("id", goal.id);
    if (error) setMsg({ ok: false, text: friendlyError(error) }); else if (onClose) { onChanged?.(); onClose(); } else navigate("/goals");
  };

  const back = goalId ? <span /> : <Link to="/goals" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Goals</Link>;

  if (isNew) {
    return (
      <div className="stack" style={{ maxWidth: 760 }}>
        {back}
        <h1>New Goal</h1>
        <div className="card card-pad">
          <GoalForm initial={draft} isNew onSave={create} />
        </div>
      </div>
    );
  }
  if (!goal) return msg ? <p className="error">{msg.text}</p> : <p className="muted">Loading…</p>;

  const owner = byId(goal.owner_member_id);
  const reviewer = goal.reviewed_by_member_id ? byId(goal.reviewed_by_member_id) : undefined;
  const done = steps.filter((s) => s.completed_on).length;
  const isOpenGoal = goal.status === "on_track" || goal.status === "off_track";
  const toggle = (f: FoldName) => setOpen(open === f ? null : f);

  return (
    <div className="stack goal-page" style={{ maxWidth: 760 }}>
      <div className="row">
        {back}
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>
        <Menu items={[
          { label: "Drop into Issues", icon: <CircleAlert size={16} />, onSelect: dropToIssues },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{goal.title}</h1>
          <Menu label="Change status" className="menu-right" button={
            <span className={`badge badge-lg ${GOAL_STATUS[goal.status].badge}`}>{GOAL_STATUS[goal.status].label}<ChevronDown size={14} /></span>
          } items={GOAL_STATUSES.map((s) => ({
            label: GOAL_STATUS[s].label, onSelect: async () => { const e = await update({ status: s }); setMsg(e ? { ok: false, text: e } : null); },
          }))} />
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "Unassigned"}</span>
          <span>{GOAL_TYPE[goal.goal_type]}</span>
          {goal.due_date && <span className={isOpenGoal && goal.due_date < today() ? "overdue" : ""}>Due {fmtDay(goal.due_date)}</span>}
          {goal.quarter && <span>Q{goal.quarter} {goal.quarter_year}</span>}
          {!goal.is_live && <span className="badge badge-warn">Draft</span>}
        </div>
        {goal.finish_line && (
          <p className="goal-finish">
            <span className="muted">Finish line</span> {goal.finish_line}
            {goal.finish_line_completed_on ? <span className="muted nowrap"> · reached {fmtDay(goal.finish_line_completed_on)} ✓</span>
              : goal.finish_line_due ? <span className="muted nowrap"> · by {fmtDay(goal.finish_line_due)}</span> : null}
          </p>
        )}
        {goal.description && <p className="goal-desc">{goal.description}</p>}
        {steps.length > 0 && (
          <div className="goal-progress">
            <span className="progress-bar"><span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></span>
            <span className="small muted">{done} of {steps.length} steps</span>
          </div>
        )}
      </div>
      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}

      <Steps goal={goal} companyId={company.id} onSteps={setSteps} onChange={() => setHistoryKey((k) => k + 1)} />

      <div className="card folds">
        <Fold title="SMART Plan" open={open === "smart"} onToggle={() => toggle("smart")}>
          <SmartPlan goal={goal} reviewer={reviewer} onSave={update} />
        </Fold>
        <Fold title="Resources" count={counts.resources} open={open === "resources"} onToggle={() => toggle("resources")}>
          <Resources goalId={goal.id} companyId={company.id} onCount={(n) => setCounts((c) => ({ ...c, resources: n }))} />
        </Fold>
        <Fold title="Comments" count={counts.comments} open={open === "comments"} onToggle={() => toggle("comments")}>
          <Comments itemType="goal" itemId={goal.id} bare onCount={(n) => setCounts((c) => ({ ...c, comments: n }))} />
        </Fold>
        <Fold title="Files" count={counts.files} open={open === "files"} onToggle={() => toggle("files")}>
          <Attachments itemType="goal" itemId={goal.id} bare onCount={(n) => setCounts((c) => ({ ...c, files: n }))} />
        </Fold>
        <Fold title="History" open={open === "history"} onToggle={() => toggle("history")}>
          <History key={historyKey} table="ss_goals" rowId={goal.id} childKey="goal_id" members={members} />
          <p className="small muted">Created {fmtDateTime(goal.created_at)}.</p>
        </Fold>
      </div>

      {editing && (
        <Sheet title="Edit Goal" onClose={() => setEditing(false)}>
          <GoalForm initial={toForm(goal)} onSave={async (form) => {
            const change = Object.fromEntries(Object.entries(form).filter(([k, v]) => goal[k as keyof Goal] !== v)) as Partial<Form>;
            if (change.title !== undefined) change.title = change.title.trim();
            const e = Object.keys(change).length ? await update(change) : "";
            if (!e) setEditing(false);
            return e;
          }} />
        </Sheet>
      )}
    </div>
  );
}

/** The Goal's main details, with rarely used ones under "More". Used for New Goal and in the Edit Goal sheet. */
function GoalForm({ initial, isNew, onSave }: { initial: Form; isNew?: boolean; onSave: (form: Form) => Promise<string> }) {
  const { active, members } = useMembers();
  const { meetings } = useMeetings();
  const [form, setForm] = useState<Form>(initial);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A new Goal picks up the default meeting once the meetings have loaded.
  useEffect(() => { if (isNew && initial.meeting_id && !form.meeting_id) setForm((f) => ({ ...f, meeting_id: initial.meeting_id })); },
    [isNew, initial.meeting_id]); // only when the default arrives

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setError(""); };
  const text = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, (e.target.value || null) as never);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError("Give the Goal a short title."); return; }
    setBusy(true);
    const err = await onSave(form);
    setBusy(false);
    if (err) setError(err);
  };

  const q = form.quarter && form.quarter_year ? `${form.quarter_year}-${form.quarter}` : "";
  const qOptions = [-1, 0, 1, 2, 3].map((n) => {
    const base = currentQuarter();
    const i = base.year * 4 + base.quarter - 1 + n;
    return { value: `${Math.floor(i / 4)}-${(i % 4) + 1}`, label: `Q${(i % 4) + 1} ${Math.floor(i / 4)}` };
  });
  if (q && !qOptions.some((o) => o.value === q)) qOptions.unshift({ value: q, label: `Q${form.quarter} ${form.quarter_year}` });

  return (
    <form className="stack goal-form" onSubmit={submit}>
      <label className="field"><span>Short title</span>
        <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required autoFocus={isNew} />
      </label>
      <div className="grid-2">
        <label className="field"><span>Owner</span>
          <OwnerSelect members={active.some((m) => m.id === form.owner_member_id) ? active : members}
            value={form.owner_member_id} onChange={(v) => v && set("owner_member_id", v)} />
        </label>
        <label className="field"><span>Type</span>
          <select className="select" value={form.goal_type} onChange={(e) => set("goal_type", e.target.value as GoalType)}>
            {(Object.keys(GOAL_TYPE) as GoalType[]).map((t) => <option key={t} value={t}>{GOAL_TYPE[t]}</option>)}
          </select>
        </label>
      </div>
      <div className="field"><span>Due date</span><DateInput label="Due date" value={form.due_date} onChange={(v) => set("due_date", v)} /></div>
      <label className="field"><span>Finish line <span className="muted" style={{ fontWeight: 400 }}>· What does done look like?</span></span>
        <textarea className="input textarea" rows={2} value={form.finish_line ?? ""} onChange={text("finish_line")} />
      </label>
      <div className="field"><span>Finish line by</span>
        <DateInput label="Finish line date" value={form.finish_line_due} onChange={(v) => set("finish_line_due", v)} />
      </div>

      <button type="button" className="link-btn more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
        More: quarter, meeting, reviewed by, description <ChevronDown size={14} style={{ transform: more ? "rotate(180deg)" : undefined }} />
      </button>
      {more && (
        <div className="stack">
          <div className="grid-2">
            {isNew && (
              <label className="field"><span>Status</span>
                <select className="select" value={form.status} onChange={(e) => set("status", e.target.value as Goal["status"])}>
                  {GOAL_STATUSES.map((s) => <option key={s} value={s}>{GOAL_STATUS[s].label}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Quarter</span>
              <select className="select" value={q} onChange={(e) => {
                const [y, n] = e.target.value.split("-").map(Number);
                setForm((f) => ({ ...f, quarter: n || null, quarter_year: y || null }));
              }}>
                <option value="">No quarter</option>
                {qOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Meeting</span>
              <select className="select" value={form.meeting_id ?? ""} onChange={(e) => set("meeting_id", e.target.value || null)}>
                <option value="">None</option>
                {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
            <label className="field"><span>Reviewed by</span>
              <OwnerSelect members={active} allowNone value={form.reviewed_by_member_id}
                onChange={(v) => setForm((f) => ({ ...f, reviewed_by_member_id: v, reviewed_by_text: v ? null : f.reviewed_by_text }))} />
            </label>
            {!form.reviewed_by_member_id && (
              <label className="field"><span>…or type a name</span>
                <input className="input" value={form.reviewed_by_text ?? ""} onChange={text("reviewed_by_text")} />
              </label>
            )}
            <div className="field"><span>Finish line reached on</span>
              <DateInput label="Finish line reached date" value={form.finish_line_completed_on} onChange={(v) => set("finish_line_completed_on", v)} />
            </div>
          </div>
          <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={!form.is_live} onChange={(e) => set("is_live", !e.target.checked)} />
            Draft: keep it out of meetings until it's ready
          </label>
          <label className="field"><span>Describe the Goal</span>
            <textarea className="input textarea" rows={3} value={form.description ?? ""} onChange={text("description")} />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : isNew ? "Create Goal" : "Save"}</button>
      {isNew && <p className="small muted">Add steps, the SMART Plan and resources once it's created.</p>}
    </form>
  );
}

/** The SMART answers as text; the pencil makes them editable. Blank answers are hidden. */
function SmartPlan({ goal, reviewer, onSave }: { goal: Goal; reviewer: Member | undefined; onSave: (change: Partial<Form>) => Promise<string> }) {
  const [edit, setEdit] = useState<Partial<Form> | null>(null);
  const [error, setError] = useState("");
  const filled = SMART.filter(({ key }) => (goal[key] as string | null)?.trim());
  const reviewedBy = reviewer ? fullName(reviewer) : goal.reviewed_by_text;

  if (edit) {
    return (
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const change = Object.fromEntries(Object.entries(edit).filter(([k, v]) => goal[k as keyof Goal] !== v)) as Partial<Form>;
        const err = Object.keys(change).length ? await onSave(change) : "";
        if (err) setError(err); else { setEdit(null); setError(""); }
      }}>
        {SMART.map(({ key, label, hint }) => (
          <label key={key} className="field"><span>{label} <span className="muted" style={{ fontWeight: 400 }}>· {hint}</span></span>
            <textarea className="input textarea" rows={2} value={(edit[key] as string | null) ?? ""}
              onChange={(e) => setEdit({ ...edit, [key]: e.target.value || null })} />
          </label>
        ))}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn btn-primary btn-sm">Save</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEdit(null); setError(""); }}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {filled.length ? (
        <dl className="kv">
          {filled.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{goal[key] as string}</dd></div>)}
          {reviewedBy && <div><dt>Reviewed by</dt><dd>{reviewedBy}</dd></div>}
        </dl>
      ) : <p className="small muted">Not filled in yet. Answer the five questions to make the Goal clear and checkable.</p>}
      <div>
        <button type="button" className="btn btn-sm" onClick={() => setEdit(Object.fromEntries(SMART.map(({ key }) => [key, goal[key]])) as Partial<Form>)}>
          <Pencil size={14} />{filled.length ? "Edit SMART Plan" : "Fill in SMART Plan"}
        </button>
      </div>
    </div>
  );
}

function Steps({ goal, companyId, onChange, onSteps }: { goal: Goal; companyId: string; onChange: () => void; onSteps: (s: GoalStep[]) => void }) {
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState<string | null>(null);
  useEffect(() => { onSteps(steps); }, [steps]); // tells the summary's progress bar; onSteps is a state setter

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_goal_steps").select("*").eq("goal_id", goal.id).order("sort_order");
    setSteps((data ?? []) as GoalStep[]);
  }, [goal.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) setError(friendlyError(error)); else { setError(""); onChange(); }
    await load();
  };
  const patch = (s: GoalStep, change: Partial<GoalStep>) => {
    setSteps((list) => list.map((x) => (x.id === s.id ? { ...x, ...change } : x)));
    return run(supabase.from("ss_goal_steps").update(change).eq("id", s.id));
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || steps.length >= 20) return;
    await run(supabase.from("ss_goal_steps").insert({
      company_id: companyId, goal_id: goal.id, sort_order: (steps.at(-1)?.sort_order ?? 0) + 1, activity: newText.trim(), due_on: newDue,
    }));
    setNewText(""); setNewDue(null);
  };
  const move = async (i: number, by: number) => {
    const a = steps[i], b = steps[i + by];
    if (!a || !b) return;
    await supabase.from("ss_goal_steps").update({ sort_order: b.sort_order }).eq("id", a.id);
    await run(supabase.from("ss_goal_steps").update({ sort_order: a.sort_order }).eq("id", b.id));
  };
  const remove = async (s: GoalStep) => { setEditing(null); await run(supabase.from("ss_goal_steps").delete().eq("id", s.id)); };

  const done = steps.filter((s) => s.completed_on).length;
  const now = today();

  return (
    <section className="stack" style={{ gap: 8 }}>
      <h2 className="steps-head">Steps{steps.length > 0 && <span className="count">{done}/{steps.length}</span>}</h2>
      <div className="card">
        {steps.length === 0 && <p className="small muted card-pad" style={{ margin: 0 }}>No steps yet. Break the Goal into dated steps; the progress bar fills as they're ticked off.</p>}
        <ul className="list steps">
          {steps.map((s, i) => editing === s.id ? (
            <li key={s.id} className="step-editing">
              <div className="step-fields">
                <textarea className="input textarea" rows={2} placeholder="What needs to happen" defaultValue={s.activity} autoFocus
                  onBlur={(e) => e.target.value !== s.activity && patch(s, { activity: e.target.value })} />
                <div className="grid-2">
                  <div className="field"><span>By</span><DateInput small label="Step date" value={s.due_on} onChange={(v) => patch(s, { due_on: v })} /></div>
                  <div className="field"><span>Done</span><DateInput small label="Step done date" value={s.completed_on} onChange={(v) => patch(s, { completed_on: v })} /></div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                  <button className="btn btn-ghost btn-sm btn-danger" aria-label="Remove step" onClick={() => confirm("Remove this step?") && remove(s)}><Trash2 size={16} /></button>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>Done</button>
                </div>
              </div>
            </li>
          ) : (
            <li key={s.id}>
              <Tick done={!!s.completed_on} label={s.completed_on ? "Mark not done" : "Mark done"}
                onToggle={() => patch(s, { completed_on: s.completed_on ? null : today() })} />
              <button type="button" className="step-view" onClick={() => setEditing(s.id)} aria-label={`Edit step: ${s.activity || "untitled"}`}>
                <span className={`step-text${s.completed_on ? " step-done" : ""}`}>{s.activity || <span className="muted">Untitled step</span>}</span>
                {s.completed_on ? <span className="small muted">Done {fmtDay(s.completed_on)}</span>
                  : s.due_on ? <span className={`small ${s.due_on < now ? "overdue" : "muted"}`}>By {fmtDay(s.due_on)}{s.due_on < now ? " · overdue" : ""}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {steps.length < 20 ? (
          <form className="step-add" onSubmit={add}>
            <input className="input" placeholder="Add a step…" value={newText} onChange={(e) => setNewText(e.target.value)} aria-label="New step" />
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">By</span>
              <DateInput small label="New step date" value={newDue} onChange={setNewDue} />
              <span className="spacer" />
              <button className="btn btn-sm btn-primary" disabled={!newText.trim()}><Plus size={16} />Add</button>
            </div>
          </form>
        ) : <p className="small muted card-pad" style={{ margin: 0 }}>20 steps is the most a Goal can have.</p>}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Resources({ goalId, companyId, onCount }: { goalId: string; companyId: string; onCount: (n: number) => void }) {
  const [items, setItems] = useState<GoalResource[]>([]);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_goal_resources").select("*").eq("goal_id", goalId).order("sort_order");
    setItems((data ?? []) as GoalResource[]);
    onCount((data ?? []).length);
  }, [goalId]); // onCount only updates a count
  useEffect(() => { load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await supabase.from("ss_goal_resources").insert({
      company_id: companyId, goal_id: goalId, sort_order: (items.at(-1)?.sort_order ?? 0) + 1, description: draft.trim(),
    });
    setDraft(""); load();
  };

  return (
    <div className="stack">
      {items.length > 0 && (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
              <input className="input" defaultValue={r.description}
                onBlur={(e) => e.target.value !== r.description && supabase.from("ss_goal_resources").update({ description: e.target.value }).eq("id", r.id).then(load)} />
              <button className="btn btn-ghost btn-sm" aria-label="Remove"
                onClick={() => supabase.from("ss_goal_resources").delete().eq("id", r.id).then(load)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input className="input" placeholder="People, budget, tools…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-sm" disabled={!draft.trim()}><Plus size={16} />Add</button>
      </form>
    </div>
  );
}

