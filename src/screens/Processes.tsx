import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, fmtDay, today, useMembers } from "../lib/data";
import { Avatar, Empty, Fold, Menu, OwnerSelect, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { Comments } from "../components/Comments";
import { Attachments } from "../components/Attachments";
import { History } from "../components/History";
import { FilterButton, FilterPanel, MineToggle, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { addDays } from "../lib/data";

export interface Process {
  id: string; company_id: string; owner_member_id: string | null; title: string; description: string | null;
  status: "draft" | "live"; followed_by_all: number | null; reviewed_on: string | null; sort_order: number;
  deleted_at: string | null; created_at: string; updated_at: string;
}
interface Step { id: string; process_id: string; sort_order: number; title: string; details: string | null; kind: "step" | "if"; answer_id: string | null }
interface Answer { id: string; process_id: string; step_id: string; label: string; sort_order: number; ends: boolean }

const fbaClass = (n: number | null) => (n === null ? "" : n >= 90 ? "badge-green" : n >= 70 ? "badge-warn" : "badge-danger");

export function Processes() {
  const { me, company } = useMe();
  const { byId, members } = useMembers();
  const DEFAULTS = { owner: "all", status: "all", review: "all" };
  const filters = useFilters("processes", DEFAULTS);
  const f = filters.values;
  const navigate = useNavigate();
  const [list, setList] = useState<Process[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    supabase.from("ss_processes").select("*").is("deleted_at", null).order("sort_order").order("title").then(async ({ data }) => {
      const ps = (data ?? []) as Process[];
      setList(ps);
      if (!ps.length) return;
      const { data: steps } = await supabase.from("ss_process_steps").select("process_id").in("process_id", ps.map((p) => p.id));
      const c: Record<string, number> = {};
      for (const s of (steps ?? []) as { process_id: string }[]) c[s.process_id] = (c[s.process_id] ?? 0) + 1;
      setCounts(c);
    });
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { data, error } = await supabase.from("ss_processes").insert({
      company_id: company.id, owner_member_id: me.id, title: title.trim(), created_by: me.id, sort_order: (list?.length ?? 0) + 1,
    }).select("id").single();
    if (error) setError(friendlyError(error)); else navigate(`/processes/${data.id}`);
  };

  const shown = (list ?? []).filter((p) => ownerMatches(f.owner, p.owner_member_id, me.id) && (f.status === "all" || p.status === f.status)
    && (f.review === "all" || (f.review === "never" ? !p.reviewed_on : f.review === "low" ? p.followed_by_all !== null && p.followed_by_all < 90
      : !p.reviewed_on || p.reviewed_on < addDays(today(), -90))));
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "status", label: "Status", options: [{ value: "all", label: "Any" }, { value: "live", label: "In use" }, { value: "draft", label: "Draft" }] },
    { key: "review", label: "Followed by all", options: [{ value: "all", label: "Any" }, { value: "low", label: "Below 90%" }, { value: "never", label: "Never reviewed" }, { value: "stale", label: "Not reviewed in 90 days" }] },
  ];
  const live = shown.filter((p) => p.status === "live");
  const drafts = shown.filter((p) => p.status === "draft");
  const row = (p: Process) => (
    <li key={p.id} className="clickable" onClick={() => navigate(`/processes/${p.id}`)}>
      <Avatar m={byId(p.owner_member_id)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{p.title}</div>
        <div className="small muted">{counts[p.id] ?? 0} steps{p.reviewed_on ? ` · reviewed ${fmtDay(p.reviewed_on, true)}` : " · not reviewed yet"}</div>
      </div>
      {p.followed_by_all !== null && <span className={`badge ${fbaClass(p.followed_by_all)}`} title="Followed by all">{p.followed_by_all}%</span>}
    </li>
  );

  return (
    <div className="stack">
      <div className="page-head goals-head"><h1>Processes</h1></div>
      <h2 className="print-only">Processes</h2>
      <div className="toolbar no-print">
        <MineToggle value={f.owner} onChange={(v) => filters.set("owner", v)} />
        <span className="spacer" />
        <FilterButton open={showFilters} active={filters.active} onToggle={() => setShowFilters(!showFilters)} />
        <Menu items={[{ label: "Print", icon: <Printer size={16} />, onSelect: () => print() }]} />
      </div>
      {showFilters && <FilterPanel fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={shown.length} total={(list ?? []).length} />}
      {!showFilters && filters.active - (f.owner !== DEFAULTS.owner ? 1 : 0) > 0 && list && (
        <p className="small muted no-print" style={{ margin: 0 }}>Showing {shown.length} of {list.length} · <button type="button" className="link-btn" onClick={filters.reset}>Clear filters</button></p>
      )}
      <p className="small muted">The core ways you do things, written down so everyone does them the same way.</p>
      <form className="card card-pad row no-print" onSubmit={add}>
        <input className="input" placeholder="New process, e.g. “Quote to job”" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!title.trim()}><Plus size={16} />Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty>No processes yet.</Empty> : <>
        {live.length > 0 && <Section title="In use" count={live.length}><ul className="card list">{live.map(row)}</ul></Section>}
        {drafts.length > 0 && <Section title="Drafts" count={drafts.length}><ul className="card list">{drafts.map(row)}</ul></Section>}
      </>}
    </div>
  );
}

type ProcessFold = "followed" | "files" | "comments" | "history";

export function ProcessDetail() {
  const { id } = useParams();
  const { company } = useMe();
  const { byId, members } = useMembers();
  const navigate = useNavigate();
  const [p, setP] = useState<Process | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<ProcessFold | null>(null);
  const [counts, setCounts] = useState({ files: 0, comments: 0 });

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data }, { data: s }, { data: a }] = await Promise.all([
      supabase.from("ss_processes").select("*").eq("id", id).maybeSingle(),
      supabase.from("ss_process_steps").select("*").eq("process_id", id).order("sort_order"),
      supabase.from("ss_process_answers").select("*").eq("process_id", id).order("sort_order"),
    ]);
    if (!data) { setError("That process wasn't found."); return; }
    setP(data as Process);
    setSteps((s ?? []) as Step[]);
    setAnswers((a ?? []) as Answer[]);
    setHistoryKey((k) => k + 1);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from("ss_attachments").select("id", { count: "exact", head: true }).eq("item_type", "process").eq("item_id", id),
      supabase.from("ss_comments").select("id", { count: "exact", head: true }).eq("item_type", "process").eq("item_id", id).is("deleted_at", null),
    ]).then(([f, c]) => setCounts({ files: f.count ?? 0, comments: c.count ?? 0 }));
  }, [id]);

  const run = async (q: PromiseLike<{ error: unknown }>) => {
    const { error } = await q;
    if (error) setError(friendlyError(error)); else { setError(""); load(); }
    return error ? friendlyError(error) : "";
  };
  const patch = (change: Partial<Process>) => (p ? run(supabase.from("ss_processes").update(change).eq("id", p.id)) : Promise.resolve(""));
  const toBin = async () => {
    if (!p || !confirm("Move this process to the recycle bin?")) return;
    await supabase.from("ss_processes").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    navigate("/processes");
  };

  if (!p) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const owner = byId(p.owner_member_id);
  const toggle = (f: ProcessFold) => setOpen(open === f ? null : f);

  return (
    <div className="stack goal-page" style={{ maxWidth: 760 }}>
      <div className="row no-print">
        <Link to="/processes" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Processes</Link>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>
        <Menu items={[
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{p.title}</h1>
          <Menu label="Change status" className="no-print" button={
            <span className={`badge badge-lg ${p.status === "live" ? "badge-green" : "badge-warn"}`}>{STATUS_LABEL[p.status]}<ChevronDown size={14} /></span>
          } items={(["live", "draft"] as const).map((st) => ({ label: STATUS_LABEL[st], onSelect: () => patch({ status: st }) }))} />
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "No owner"}</span>
          {p.followed_by_all !== null
            ? <span><span className={`badge ${fbaClass(p.followed_by_all)}`}>{p.followed_by_all}% followed</span> · reviewed {fmtDay(p.reviewed_on, true)}</span>
            : <span>Not reviewed yet</span>}
        </div>
        {p.description && <p className="goal-desc">{p.description}</p>}
      </div>
      {error && <p className="error">{error}</p>}

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="steps-head">Steps{steps.length > 0 && <span className="count">{steps.filter((x) => !x.answer_id).length}</span>}</h2>
        <div className="card">
          {steps.length === 0 && <p className="small muted card-pad" style={{ margin: 0 }}>Write the major steps, in order. Keep each one short; put the how-to in its details. Where it depends, add an If/Then Step.</p>}
          <StepList ctx={{ steps, answers, companyId: company.id, processId: p.id, run, reload: load }} answerId={null} prefix="" />
        </div>
      </section>

      <div className="card folds no-print">
        <Fold title="Followed by All" open={open === "followed"} onToggle={() => toggle("followed")}>
          <div className="stack" style={{ gap: 8 }}>
            <p className="small muted" style={{ margin: 0 }}>Every so often, check how consistently everyone actually follows this. Below 90% usually means training, or a process that needs simplifying.</p>
            <div className="row wrap">
              <select className="select" style={{ width: "auto" }} aria-label="Followed by all" value={p.followed_by_all ?? ""}
                onChange={(e) => patch({ followed_by_all: e.target.value === "" ? null : Number(e.target.value), reviewed_on: e.target.value === "" ? null : today() })}>
                <option value="">Not reviewed</option>
                {Array.from({ length: 21 }, (_, i) => 100 - i * 5).map((n) => <option key={n} value={n}>{n}% followed</option>)}
              </select>
              <span className="small muted">{p.reviewed_on ? `Reviewed ${fmtDay(p.reviewed_on, true)}` : "Not reviewed yet"}</span>
            </div>
          </div>
        </Fold>
        <Fold title="Files" count={counts.files} open={open === "files"} onToggle={() => toggle("files")}>
          <Attachments itemType="process" itemId={p.id} bare onCount={(n) => setCounts((c) => ({ ...c, files: n }))} />
        </Fold>
        <Fold title="Comments" count={counts.comments} open={open === "comments"} onToggle={() => toggle("comments")}>
          <Comments itemType="process" itemId={p.id} bare onCount={(n) => setCounts((c) => ({ ...c, comments: n }))} />
        </Fold>
        <Fold title="History" open={open === "history"} onToggle={() => toggle("history")}>
          <History key={historyKey} table="ss_processes" rowId={p.id} childKey="process_id" members={members} />
          <p className="small muted">Created {fmtDateTime(p.created_at)}.</p>
        </Fold>
      </div>

      {editing && <ProcessSheet p={p} onClose={() => setEditing(false)} onSave={async (change) => { const e = await patch(change); if (!e) setEditing(false); return e; }} />}
    </div>
  );
}

const STATUS_LABEL: Record<Process["status"], string> = { live: "In use", draft: "Draft" };

function ProcessSheet({ p, onClose, onSave }: { p: Process; onClose: () => void; onSave: (change: Partial<Process>) => Promise<string> }) {
  const { active, members } = useMembers();
  const [form, setForm] = useState({ title: p.title, owner_member_id: p.owner_member_id, status: p.status, description: p.description ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Edit Process" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!form.title.trim()) { setError("Give the process a name."); return; }
        setBusy(true);
        const err = await onSave({ ...form, title: form.title.trim(), description: form.description.trim() || null });
        setBusy(false);
        if (err) setError(err);
      }}>
        <label className="field"><span>Name</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
        <div className="grid-2">
          <label className="field"><span>Owner</span>
            <OwnerSelect members={active.some((m) => m.id === form.owner_member_id) || !form.owner_member_id ? active : members} allowNone
              value={form.owner_member_id} onChange={(v) => setForm({ ...form, owner_member_id: v })} />
          </label>
          <label className="field"><span>Status</span>
            <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Process["status"] })}>
              <option value="live">In use</option><option value="draft">Draft</option>
            </select>
          </label>
        </div>
        <label className="field"><span>What it covers</span>
          <textarea className="input textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </Sheet>
  );
}


// ─── Steps, with If/Then branches ───────────────────────────────────────────
// An If/Then Step asks a question; each answer holds its own steps (which can branch again).
// After the answers the process carries on with the next shared step, unless an answer ends it.

interface StepCtx {
  steps: Step[]; answers: Answer[]; companyId: string; processId: string;
  run: (q: PromiseLike<{ error: unknown }>) => Promise<string>; reload: () => void;
}
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function StepList({ ctx, answerId, prefix, ends }: { ctx: StepCtx; answerId: string | null; prefix: string; ends?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(!answerId);
  const list = ctx.steps.filter((x) => (x.answer_id ?? null) === answerId).sort((a, b) => a.sort_order - b.sort_order);
  const num = (i: number) => (prefix ? `${prefix}${prefix.match(/\d$/) ? LETTERS[i] ?? i + 1 : `.${i + 1}`}` : String(i + 1));
  const nextOrder = (list.at(-1)?.sort_order ?? 0) + 1;

  const add = async (kind: "step" | "if") => {
    const title = kind === "step" ? draft.trim() : "";
    if (kind === "step" && !title) return;
    const { data, error } = await supabase.from("ss_process_steps").insert({
      company_id: ctx.companyId, process_id: ctx.processId, sort_order: nextOrder, title, kind, answer_id: answerId,
    }).select("id").single();
    if (error) { await ctx.run(Promise.resolve({ error })); return; }
    if (kind === "if") {
      await supabase.from("ss_process_answers").insert(["Yes", "No"].map((label, i) => ({
        company_id: ctx.companyId, process_id: ctx.processId, step_id: data.id, label, sort_order: i,
      })));
      setEditing(data.id);
    }
    setDraft("");
    ctx.reload();
  };
  const move = async (i: number, by: number) => {
    const a = list[i], b = list[i + by];
    if (!a || !b) return;
    await supabase.from("ss_process_steps").update({ sort_order: b.sort_order }).eq("id", a.id);
    ctx.run(supabase.from("ss_process_steps").update({ sort_order: a.sort_order === b.sort_order ? b.sort_order + 1 : a.sort_order }).eq("id", b.id));
  };
  const patch = (st: Step, change: Partial<Step>) => ctx.run(supabase.from("ss_process_steps").update(change).eq("id", st.id));
  const remove = (st: Step) => {
    const msg = st.kind === "if" ? "Remove this If/Then Step and the steps under its answers?" : "Remove this step?";
    if (confirm(msg)) { setEditing(null); ctx.run(supabase.from("ss_process_steps").delete().eq("id", st.id)); }
  };

  return (
    <>
      <ol className={`list steps process-list${answerId ? " branch-steps" : ""}`}>
        {list.map((st, i) => {
          const n = num(i);
          const isIf = st.kind === "if";
          const stepAnswers = ctx.answers.filter((a) => a.step_id === st.id).sort((a, b) => a.sort_order - b.sort_order);
          return (
            <li key={st.id} className={`${editing === st.id ? "step-editing " : ""}${isIf ? "if-step" : ""}`}>
              <span className={`step-num${isIf ? " if-num" : ""}`} title={isIf ? "If/Then Step" : undefined}>{isIf ? `◆ ${n}` : n}</span>
              <div className="step-body">
                {editing === st.id ? (
                  <div className="step-fields">
                    <input className="input" placeholder={isIf ? "Question, e.g. Is the job over $10k?" : "Step"} defaultValue={st.title} autoFocus style={{ fontWeight: 600 }}
                      onBlur={(e) => e.target.value.trim() !== st.title && patch(st, { title: e.target.value.trim() })} />
                    <textarea className="input textarea" rows={2} placeholder={isIf ? "Details (optional)" : "Details: who, how, checklists, links…"} defaultValue={st.details ?? ""}
                      onBlur={(e) => (e.target.value.trim() || null) !== st.details && patch(st, { details: e.target.value.trim() || null })} />
                    {isIf && (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className="small" style={{ fontWeight: 600 }}>Answers</span>
                        {stepAnswers.map((a) => (
                          <div key={a.id} className="row" style={{ gap: 6 }}>
                            <input className="input" defaultValue={a.label} aria-label="Answer" placeholder="Answer, e.g. Yes"
                              onBlur={(e) => e.target.value.trim() !== a.label && ctx.run(supabase.from("ss_process_answers").update({ label: e.target.value.trim() }).eq("id", a.id))} />
                            <label className="row small nowrap" style={{ gap: 4 }}>
                              <input type="checkbox" checked={a.ends} onChange={(e) => ctx.run(supabase.from("ss_process_answers").update({ ends: e.target.checked }).eq("id", a.id))} />End
                            </label>
                            <button className="btn btn-ghost btn-sm" aria-label="Remove answer" disabled={stepAnswers.length <= 1}
                              onClick={() => confirm("Remove this answer and its steps?") && ctx.run(supabase.from("ss_process_answers").delete().eq("id", a.id))}><Trash2 size={16} /></button>
                          </div>
                        ))}
                        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => ctx.run(supabase.from("ss_process_answers").insert({
                          company_id: ctx.companyId, process_id: ctx.processId, step_id: st.id, label: "", sort_order: (stepAnswers.at(-1)?.sort_order ?? 0) + 1 }))}>
                          <Plus size={14} />Add an answer</button>
                        <p className="small muted" style={{ margin: 0 }}>Tick End when that answer finishes the process; otherwise it carries on with the next shared step.</p>
                      </div>
                    )}
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                      <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                      <button className="btn btn-ghost btn-sm btn-danger" aria-label="Remove step" onClick={() => remove(st)}><Trash2 size={16} /></button>
                      <span className="spacer" />
                      <button className="btn btn-sm" onClick={() => setEditing(null)}>Done</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="step-view" onClick={() => setEditing(st.id)} aria-label={`Edit step: ${st.title || "untitled"}`}>
                    <span className="step-text" style={{ fontWeight: 600 }}>
                      {isIf && <span className="if-tag">If/Then</span>}
                      {st.title || <span className="muted">{isIf ? "Question not written yet" : "Untitled step"}</span>}
                    </span>
                    {st.details && <span className="small muted step-details">{st.details}</span>}
                  </button>
                )}
                {isIf && stepAnswers.map((a, ai) => (
                  <div key={a.id} className="branch">
                    <div className="branch-head">If <strong>{a.label || "…"}</strong>:</div>
                    <StepList ctx={ctx} answerId={a.id} prefix={`${n}${LETTERS[ai] ?? ""}`} ends={a.ends} />
                  </div>
                ))}
                {isIf && i < list.length - 1 && stepAnswers.some((a) => !a.ends) && (
                  <div className="small muted branch-join">Then carry on with step {num(i + 1)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {ends && <div className="branch-end">End of the process</div>}
      <form className={`step-add no-print${answerId ? " branch-add" : ""}`} onSubmit={(e) => { e.preventDefault(); add("step"); }}>
        {adding ? (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="Add a step…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New step" autoFocus={!!answerId} />
            <button className="btn btn-sm btn-primary" disabled={!draft.trim()}><Plus size={16} />Add</button>
          </div>
        ) : null}
        <div className="row" style={{ gap: 14 }}>
          {!adding && <button type="button" className="link-btn if-add" style={{ color: "var(--color-brand-hover)" }} onClick={() => setAdding(true)}><Plus size={13} style={{ verticalAlign: -2 }} /> Add a step</button>}
          <button type="button" className="link-btn if-add" onClick={() => add("if")}>◆ Add an If/Then Step</button>
        </div>
      </form>
    </>
  );
}
