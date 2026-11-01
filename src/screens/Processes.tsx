import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Printer, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, fmtDay, today, useMembers } from "../lib/data";
import { Avatar, Empty, OwnerSelect, Section } from "../components/ui";
import { Comments } from "../components/Comments";
import { Attachments } from "../components/Attachments";
import { History } from "../components/History";
import { FilterBar, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { addDays } from "../lib/data";

export interface Process {
  id: string; company_id: string; owner_member_id: string | null; title: string; description: string | null;
  status: "draft" | "live"; followed_by_all: number | null; reviewed_on: string | null; sort_order: number;
  deleted_at: string | null; created_at: string; updated_at: string;
}
interface Step { id: string; process_id: string; sort_order: number; title: string; details: string | null }

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
      <div className="page-head"><h1>Processes</h1></div>
      <p className="small muted">The handful of core ways you do things, written down simply enough that everyone follows them the same way.</p>
      <form className="card card-pad row no-print" onSubmit={add}>
        <input className="input" placeholder="New process, e.g. “Quote to job”" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!title.trim()}><Plus size={16} />Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <FilterBar fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={shown.length} total={(list ?? []).length} />
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty>No processes yet.</Empty> : <>
        {live.length > 0 && <Section title="In use" count={live.length}><ul className="card list">{live.map(row)}</ul></Section>}
        {drafts.length > 0 && <Section title="Drafts" count={drafts.length}><ul className="card list">{drafts.map(row)}</ul></Section>}
      </>}
    </div>
  );
}

export function ProcessDetail() {
  const { id } = useParams();
  const { company } = useMe();
  const { active, members } = useMembers();
  const navigate = useNavigate();
  const [p, setP] = useState<Process | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState("");
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("ss_processes").select("*").eq("id", id).maybeSingle(),
      supabase.from("ss_process_steps").select("*").eq("process_id", id).order("sort_order"),
    ]);
    if (!data) { setError("That process wasn't found."); return; }
    setP(data as Process);
    setSteps((s ?? []) as Step[]);
    setHistoryKey((k) => k + 1);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (q: PromiseLike<{ error: unknown }>) => {
    const { error } = await q;
    if (error) setError(friendlyError(error)); else { setError(""); load(); }
  };
  const patch = (change: Partial<Process>) => p && run(supabase.from("ss_processes").update(change).eq("id", p.id));
  const patchStep = (s: Step, change: Partial<Step>) => run(supabase.from("ss_process_steps").update(change).eq("id", s.id));
  const addStep = () => p && run(supabase.from("ss_process_steps").insert({
    company_id: company.id, process_id: p.id, sort_order: (steps.at(-1)?.sort_order ?? 0) + 1,
  }));
  const move = async (i: number, by: number) => {
    const a = steps[i], b = steps[i + by];
    if (!a || !b) return;
    await supabase.from("ss_process_steps").update({ sort_order: b.sort_order }).eq("id", a.id);
    run(supabase.from("ss_process_steps").update({ sort_order: a.sort_order }).eq("id", b.id));
  };

  if (!p) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row no-print">
        <Link to="/processes" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Processes</Link>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => print()} aria-label="Print" title="Print"><Printer size={18} /></button>
      </div>

      <div className="card card-pad stack">
        <input className="plan-input process-title" defaultValue={p.title} aria-label="Process name"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.title && patch({ title: e.target.value.trim() })} />
        <div className="grid-2">
          <label className="field"><span>Owner</span>
            <OwnerSelect members={active} allowNone value={p.owner_member_id} onChange={(v) => patch({ owner_member_id: v })} />
          </label>
          <label className="field"><span>Status</span>
            <select className="select" value={p.status} onChange={(e) => patch({ status: e.target.value as Process["status"] })}>
              <option value="draft">Draft</option><option value="live">In use</option>
            </select>
          </label>
        </div>
        <label className="field"><span>What it covers</span>
          <textarea className="input textarea" rows={3} defaultValue={p.description ?? ""}
            onBlur={(e) => (e.target.value.trim() || null) !== p.description && patch({ description: e.target.value.trim() || null })} />
        </label>
      </div>

      <div className="card card-pad stack">
        <div className="row"><h2>Steps</h2><span className="spacer" /><span className="small muted">{steps.length}</span></div>
        {steps.length === 0 && <p className="small muted">Write the major steps, in order. Keep each one short; put the how-to in its details.</p>}
        <ol className="process-steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <div className="row" style={{ alignItems: "flex-start", gap: 6 }}>
                <span className="plan-num" style={{ paddingTop: 10 }}>{i + 1}.</span>
                <div style={{ flex: 1, minWidth: 0 }} className="stack">
                  <input className="input" placeholder="Step" defaultValue={s.title} style={{ fontWeight: 600 }}
                    onBlur={(e) => e.target.value !== s.title && patchStep(s, { title: e.target.value })} />
                  <textarea className="input textarea" rows={2} placeholder="Details: who, how, checklists, links…" defaultValue={s.details ?? ""}
                    onBlur={(e) => (e.target.value.trim() || null) !== s.details && patchStep(s, { details: e.target.value.trim() || null })} />
                </div>
                <span className="step-actions no-print" style={{ flexDirection: "column" }}>
                  <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove step" onClick={() => confirm("Remove this step?") && run(supabase.from("ss_process_steps").delete().eq("id", s.id))}><Trash2 size={16} /></button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-sm no-print" onClick={addStep}><Plus size={16} />Add step</button>
      </div>

      <div className="card card-pad stack">
        <h2>Followed by all?</h2>
        <p className="small muted">Every so often, check how consistently everyone actually follows this. Below 90% usually means training, or a process that needs simplifying.</p>
        <div className="row wrap">
          <select className="select" style={{ width: "auto" }} aria-label="Followed by all" value={p.followed_by_all ?? ""}
            onChange={(e) => patch({ followed_by_all: e.target.value === "" ? null : Number(e.target.value), reviewed_on: e.target.value === "" ? null : today() })}>
            <option value="">Not reviewed</option>
            {Array.from({ length: 21 }, (_, i) => 100 - i * 5).map((n) => <option key={n} value={n}>{n}% followed</option>)}
          </select>
          {p.followed_by_all !== null && <span className={`badge ${fbaClass(p.followed_by_all)}`}>{p.followed_by_all}%</span>}
          <span className="small muted">{p.reviewed_on ? `Reviewed ${fmtDay(p.reviewed_on, true)}` : "Not reviewed yet"}</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="card card-pad no-print"><Attachments itemType="process" itemId={p.id} /></div>
      <div className="card card-pad no-print"><Comments itemType="process" itemId={p.id} /></div>
      <div className="row no-print">
        <span className="spacer" />
        <button className="btn btn-sm btn-danger" onClick={async () => {
          if (!confirm("Move this process to the recycle bin?")) return;
          await supabase.from("ss_processes").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
          navigate("/processes");
        }}><Trash2 size={16} />Move to recycle bin</button>
      </div>
      <div className="card card-pad stack no-print">
        <h2>History</h2>
        <History key={historyKey} table="ss_processes" rowId={p.id} childKey="process_id" members={members} />
        <p className="small muted">Created {fmtDateTime(p.created_at)}.</p>
      </div>
    </div>
  );
}
