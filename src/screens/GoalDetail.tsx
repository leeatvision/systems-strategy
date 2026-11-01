import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, CircleAlert, Plus, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import {
  GOAL_STATUS, GOAL_STATUSES, GOAL_TYPE, currentQuarter, fmtDateTime, quarterEnd, today, useMeetings, useMembers,
  type Goal, type GoalResource, type GoalStep, type GoalType,
} from "../lib/data";
import { OwnerSelect, Progress, Tick } from "../components/ui";
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

export function GoalDetail() {
  const { id } = useParams();
  const isNew = id === "new";
  const { me, company } = useMe();
  const { active, members } = useMembers();
  const { meetings, defaultMeetingId } = useMeetings();
  const navigate = useNavigate();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [form, setForm] = useState<Form | null>(isNew ? blankGoal(me.id, null) : null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    const { data, error } = await supabase.from("ss_goals").select("*").eq("id", id).maybeSingle();
    if (error || !data) { setMsg({ ok: false, text: "That Goal wasn't found." }); return; }
    const r = data as Goal;
    setGoal(r);
    const { id: _i, company_id: _c, completed_at: _ca, deleted_at: _d, archived_at: _a, created_at: _cr, updated_at: _u, ...rest } = r;
    setForm(rest);
    setDirty(false);
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isNew && defaultMeetingId) setForm((f) => (f && !f.meeting_id ? { ...f, meeting_id: defaultMeetingId } : f));
  }, [isNew, defaultMeetingId]);

  if (!form) return msg ? <p className="error">{msg.text}</p> : <p className="muted">Loading…</p>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); setMsg(null); };
  const text = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, (e.target.value || null) as never);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim()) { setMsg({ ok: false, text: "Give the Goal a short title." }); return; }
    setBusy(true);
    const row = {
      ...form, title: form.title.trim(),
      completed_at: form.status === "done" ? (goal?.completed_at ?? new Date().toISOString()) : null,
    };
    if (isNew) {
      const { data, error } = await supabase.from("ss_goals")
        .insert({ ...row, company_id: company.id, created_by: me.id }).select("id").single();
      setBusy(false);
      if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
      navigate(`/goals/${data.id}`, { replace: true });
      return;
    }
    const { error } = await supabase.from("ss_goals").update(row).eq("id", goal!.id);
    setBusy(false);
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
    setMsg({ ok: true, text: "Saved." });
    await load();
    setHistoryKey((k) => k + 1);
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
    if (error) setMsg({ ok: false, text: friendlyError(error) }); else navigate("/goals");
  };

  const q = form.quarter && form.quarter_year ? `${form.quarter_year}-${form.quarter}` : "";
  const qOptions = [-1, 0, 1, 2, 3].map((n) => {
    const base = currentQuarter();
    const i = base.year * 4 + base.quarter - 1 + n;
    return { value: `${Math.floor(i / 4)}-${(i % 4) + 1}`, label: `Q${(i % 4) + 1} ${Math.floor(i / 4)}` };
  });
  if (q && !qOptions.some((o) => o.value === q)) qOptions.unshift({ value: q, label: `Q${form.quarter} ${form.quarter_year}` });

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <Link to="/goals" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Goals</Link>

      <form className="stack" onSubmit={save}>
        <div className="card card-pad stack">
          <label className="field"><span>Short title</span>
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} required autoFocus={isNew} />
          </label>
          <div className="grid-2">
            <label className="field"><span>Owner</span>
              <OwnerSelect members={active.some((m) => m.id === form.owner_member_id) ? active : members}
                value={form.owner_member_id} onChange={(v) => v && set("owner_member_id", v)} />
            </label>
            <label className="field"><span>Status</span>
              <select className="select" value={form.status} onChange={(e) => set("status", e.target.value as Goal["status"])}>
                {GOAL_STATUSES.map((s) => <option key={s} value={s}>{GOAL_STATUS[s].label}</option>)}
              </select>
            </label>
            <label className="field"><span>Type</span>
              <select className="select" value={form.goal_type} onChange={(e) => set("goal_type", e.target.value as GoalType)}>
                {(Object.keys(GOAL_TYPE) as GoalType[]).map((t) => <option key={t} value={t}>{GOAL_TYPE[t]}</option>)}
              </select>
            </label>
            <label className="field"><span>Quarter</span>
              <select className="select" value={q} onChange={(e) => {
                const [y, n] = e.target.value.split("-").map(Number);
                setForm({ ...form, quarter: n || null, quarter_year: y || null }); setDirty(true);
              }}>
                <option value="">No quarter</option>
                {qOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Due date</span>
              <input className="input" type="date" value={form.due_date ?? ""} onChange={text("due_date")} />
            </label>
            <label className="field"><span>Meeting</span>
              <select className="select" value={form.meeting_id ?? ""} onChange={(e) => set("meeting_id", e.target.value || null)}>
                <option value="">None</option>
                {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
          </div>
          <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={!form.is_live} onChange={(e) => set("is_live", !e.target.checked)} />
            Draft: keep it out of meetings until it's ready
          </label>
          <label className="field"><span>Describe the Goal</span>
            <textarea className="input textarea" rows={3} value={form.description ?? ""} onChange={text("description")} />
          </label>
        </div>

        <div className="card card-pad stack">
          <h2>SMART planner</h2>
          {SMART.map(({ key, label, hint }) => (
            <label key={key} className="field"><span>{label} <span className="muted" style={{ fontWeight: 400 }}>· {hint}</span></span>
              <textarea className="input textarea" rows={2} value={(form[key] as string | null) ?? ""} onChange={text(key)} />
            </label>
          ))}
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>Finish line <span className="muted" style={{ fontWeight: 400 }}>· What does done look like?</span></span>
              <textarea className="input textarea" rows={2} value={form.finish_line ?? ""} onChange={text("finish_line")} />
            </label>
            <label className="field"><span>Finish line due</span>
              <input className="input" type="date" value={form.finish_line_due ?? ""} onChange={text("finish_line_due")} />
            </label>
            <label className="field"><span>Finish line reached on</span>
              <input className="input" type="date" value={form.finish_line_completed_on ?? ""} onChange={text("finish_line_completed_on")} />
            </label>
            <label className="field"><span>Reviewed by</span>
              <OwnerSelect members={active} allowNone value={form.reviewed_by_member_id}
                onChange={(v) => { setForm({ ...form, reviewed_by_member_id: v, reviewed_by_text: v ? null : form.reviewed_by_text }); setDirty(true); }} />
            </label>
            {!form.reviewed_by_member_id && (
              <label className="field"><span>…or type a name</span>
                <input className="input" value={form.reviewed_by_text ?? ""} onChange={text("reviewed_by_text")} />
              </label>
            )}
          </div>
        </div>

        {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
        <div className={`row${isNew || dirty ? " save-bar" : ""}`}>
          <button className="btn btn-primary" disabled={busy || (!isNew && !dirty)}>{isNew ? "Create Goal" : dirty ? "Save changes" : "Saved"}</button>
          {isNew && <span className="small muted">Add next steps and resources once it's created.</span>}
        </div>
      </form>

      {goal && <>
        <Steps goal={goal} companyId={company.id} onChange={() => setHistoryKey((k) => k + 1)} />
        <Resources goalId={goal.id} companyId={company.id} />
        <div className="row wrap">
          <button className="btn btn-sm" onClick={dropToIssues}><CircleAlert size={16} />Drop into Issues</button>
          <span className="spacer" />
          <button className="btn btn-sm btn-danger" onClick={toBin}><Trash2 size={16} />Move to recycle bin</button>
        </div>
        <div className="card card-pad"><Attachments itemType="goal" itemId={goal.id} /></div>
        <div className="card card-pad"><Comments itemType="goal" itemId={goal.id} /></div>
        <div className="card card-pad stack">
          <h2>History</h2>
          <History key={historyKey} table="ss_goals" rowId={goal.id} childKey="goal_id" members={members} />
          <p className="small muted">Created {fmtDateTime(goal.created_at)}.</p>
        </div>
      </>}
    </div>
  );
}

function Steps({ goal, companyId, onChange }: { goal: Goal; companyId: string; onChange: () => void }) {
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [error, setError] = useState("");

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
  const add = () => run(supabase.from("ss_goal_steps").insert({
    company_id: companyId, goal_id: goal.id, sort_order: (steps.at(-1)?.sort_order ?? 0) + 1, activity: "",
  }));
  const move = async (i: number, by: number) => {
    const a = steps[i], b = steps[i + by];
    if (!a || !b) return;
    await supabase.from("ss_goal_steps").update({ sort_order: b.sort_order }).eq("id", a.id);
    await run(supabase.from("ss_goal_steps").update({ sort_order: a.sort_order }).eq("id", b.id));
  };
  const remove = (s: GoalStep) => run(supabase.from("ss_goal_steps").delete().eq("id", s.id));

  const done = steps.filter((s) => s.completed_on).length;

  return (
    <div className="card card-pad stack">
      <div className="row">
        <h2>Next steps</h2>
        <Progress done={done} total={steps.length} />
        <span className="spacer" />
        <span className="small muted">{steps.length}/20</span>
      </div>
      {steps.length === 0 && <p className="small muted">No steps yet. Break the Goal into dated steps; the progress bar fills as they're ticked off.</p>}
      <ul className="list steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            <Tick done={!!s.completed_on} label={s.completed_on ? "Mark not done" : "Mark done"}
              onToggle={() => patch(s, { completed_on: s.completed_on ? null : today() })} />
            <div className="step-fields">
              <textarea className="input textarea" rows={1} placeholder="What needs to happen" defaultValue={s.activity}
                onBlur={(e) => e.target.value !== s.activity && patch(s, { activity: e.target.value })} />
              <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="row" style={{ gap: 4 }}>By
                  <input className="input input-sm" type="date" value={s.due_on ?? ""} onChange={(e) => patch(s, { due_on: e.target.value || null })} />
                </label>
                {s.completed_on && <label className="row" style={{ gap: 4 }}>Done
                  <input className="input input-sm" type="date" value={s.completed_on} onChange={(e) => patch(s, { completed_on: e.target.value || null })} />
                </label>}
                <span className="spacer" />
                <span className="step-actions">
                  <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove step" onClick={() => confirm("Remove this step?") && remove(s)}><Trash2 size={16} /></button>
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-sm" disabled={steps.length >= 20} onClick={add}><Plus size={16} />Add step</button>
    </div>
  );
}

function Resources({ goalId, companyId }: { goalId: string; companyId: string }) {
  const [items, setItems] = useState<GoalResource[]>([]);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_goal_resources").select("*").eq("goal_id", goalId).order("sort_order");
    setItems((data ?? []) as GoalResource[]);
  }, [goalId]);
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
    <div className="card card-pad stack">
      <h2>Resources needed</h2>
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

