import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { Archive, ArrowDown, ArrowUp, BadgeCheck, ChevronsUpDown, Copy, Link2, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { GOAL_STATUS, currentQuarter, fmtDay, useMembers, type Issue, type Goal } from "../lib/data";
import { Empty, Fold, Menu } from "../components/ui";

interface Version {
  id: string; company_id: string; title: string; status: "draft" | "official" | "archived";
  purpose: string | null; niche: string | null; long_term_target: string | null; long_term_target_date: string | null;
  target_market: string | null; how_we_work: string | null; guarantee: string | null;
  three_year_date: string | null; three_year_revenue: string | null; three_year_profit: string | null;
  one_year_date: string | null; one_year_revenue: string | null; one_year_profit: string | null;
  quarter_date: string | null; quarter_revenue: string | null; quarter_profit: string | null;
  published_at: string | null; created_at: string; updated_at: string;
}
type Section = "value" | "differentiator" | "three_year_measurable" | "three_year_goal" | "one_year_measurable" | "one_year_goal" | "quarter_measurable" | "quarter_goal" | "long_term_issue";
interface Item {
  id: string; version_id: string; section: Section; sort_order: number; title: string; notes: string | null; value: string | null;
  owner_member_id: string | null; linked_goal_id: string | null; linked_issue_id: string | null;
}
type VersionField = Exclude<keyof Version, "id" | "company_id" | "status" | "published_at" | "created_at" | "updated_at">;

const COPY_FIELDS: VersionField[] = ["title", "purpose", "niche", "long_term_target", "long_term_target_date", "target_market",
  "how_we_work", "guarantee", "three_year_date", "three_year_revenue", "three_year_profit", "one_year_date", "one_year_revenue",
  "one_year_profit", "quarter_date", "quarter_revenue", "quarter_profit"];

/** A text that saves itself when you leave it. */
function Editable({ value, onSave, placeholder, multiline, type, ro }: { value: string | null; onSave: (v: string | null) => void; placeholder?: string; multiline?: boolean; type?: string; ro?: boolean }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const done = () => { const next = v.trim() || null; if (next !== (value ?? null)) onSave(next); };
  if (ro) return value ? <span className="plan-text">{type === "date" ? fmtDay(value, true) : value}</span> : <span className="plan-text muted">Not filled in</span>;
  return multiline
    ? <textarea className="plan-input" rows={Math.max(2, v.split("\n").length)} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={done} />
    : <input className="plan-input" type={type ?? "text"} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={done}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

/** One section of the plan: read as text, the pencil turns on editing for just that section. */
function PlanFold({ title, hint, count, open, onToggle, editing, onEdit, children }: {
  title: string; hint?: string; count?: number; open: boolean; onToggle: () => void; editing: boolean; onEdit: () => void; children: ReactNode;
}) {
  return (
    <Fold title={title} count={count} open={open} onToggle={onToggle}
      action={<button type="button" className={`btn btn-sm ${editing ? "btn-primary" : "btn-ghost"} no-print`} onClick={onEdit}>
        {editing ? "Done" : <><Pencil size={14} />Edit</>}</button>}>
      {hint && <p className="small muted" style={{ margin: "0 0 8px" }}>{hint}</p>}
      <div className="plan-body">{children}</div>
    </Fold>
  );
}

const SECTIONS = ["values", "purpose", "target", "marketing", "three", "one", "quarter", "issues"];

export function VisionPlan() {
  const { me, company, isOwner } = useMe();
  const { byId } = useMembers();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  // Printing shows every section, as text.
  useEffect(() => {
    const before = () => flushSync(() => { setOpen(new Set(SECTIONS)); setEditing(new Set()); });
    window.addEventListener("beforeprint", before);
    return () => window.removeEventListener("beforeprint", before);
  }, []);

  const load = useCallback(async (pick?: string) => {
    const { data } = await supabase.from("ss_plan_versions").select("*").neq("status", "archived").order("created_at", { ascending: false });
    const list = (data ?? []) as Version[];
    setVersions(list);
    const wanted = pick ?? current;
    const id = (wanted && list.some((x) => x.id === wanted) ? wanted : null) ?? list.find((x) => x.status === "official")?.id ?? list[0]?.id ?? null;
    setCurrent(id);
    if (id) {
      const { data: its } = await supabase.from("ss_plan_items").select("*").eq("version_id", id).order("sort_order");
      setItems((its ?? []) as Item[]);
    } else setItems([]);
  }, [current]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    supabase.from("ss_goals").select("*").is("deleted_at", null).order("title").then(({ data }) => setGoals((data ?? []) as Goal[]));
    supabase.from("ss_issues").select("*").is("deleted_at", null).eq("status", "open").order("title").then(({ data }) => setIssues((data ?? []) as Issue[]));
  }, []);

  const v = versions?.find((x) => x.id === current) ?? null;
  const run = async (p: PromiseLike<{ error: unknown }>, reloadTo?: string) => {
    const { error } = await p;
    if (error) setError(friendlyError(error)); else { setError(""); load(reloadTo); }
  };
  const setField = (k: VersionField) => (value: string | null) => v && run(supabase.from("ss_plan_versions").update({ [k]: value }).eq("id", v.id));

  const create = async (from: Version | null) => {
    const base = from ? Object.fromEntries(COPY_FIELDS.map((k) => [k, from[k]])) : { title: "Vision and Plan" };
    const { data, error } = await supabase.from("ss_plan_versions").insert({ ...base, company_id: company.id, status: "draft", created_by: me.id }).select("id").single();
    if (error) { setError(friendlyError(error)); return; }
    if (from) {
      const { data: its } = await supabase.from("ss_plan_items").select("*").eq("version_id", from.id);
      const copies = ((its ?? []) as Item[]).map(({ id: _id, version_id: _v, ...rest }) => ({ ...rest, company_id: company.id, version_id: data.id }));
      if (copies.length) await supabase.from("ss_plan_items").insert(copies);
    }
    load(data.id);
  };
  const publish = async () => {
    if (!v || !confirm("Make this the official Vision and Plan? The current official one is kept as an archived version.")) return;
    const official = versions?.find((x) => x.status === "official");
    if (official) {
      const { error } = await supabase.from("ss_plan_versions").update({ status: "archived" }).eq("id", official.id);
      if (error) { setError(friendlyError(error)); return; }
    }
    run(supabase.from("ss_plan_versions").update({ status: "official", published_at: new Date().toISOString() }).eq("id", v.id), v.id);
  };
  const discard = () => v && confirm("Archive this draft?") && run(supabase.from("ss_plan_versions").update({ status: "archived" }).eq("id", v.id), "");

  if (versions === null) return <p className="muted">Loading…</p>;
  if (!v) {
    return (
      <div className="stack">
        <h1>Vision and Plan</h1>
        <Empty>No Vision and Plan yet. Start one and fill it in together; make it official when the leadership team agrees.</Empty>
        <button className="btn btn-primary" onClick={() => create(null)}><Plus size={16} />Start the Vision and Plan</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const list = (s: Section) => items.filter((i) => i.section === s);
  const lists = { list, items, versionId: v.id, companyId: company.id, reload: () => load(v.id), onError: setError };
  const q = currentQuarter();

  const fold = (key: string) => ({
    open: open.has(key), editing: editing.has(key),
    onToggle: () => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; }),
    onEdit: () => { setEditing((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; }); setOpen((o) => new Set(o).add(key)); },
  });
  const ro = (key: string) => !editing.has(key);
  const allOpen = open.size === SECTIONS.length;

  return (
    <div className="stack plan goal-page">
      <div className="page-head goals-head">
        <h1>{v.title}</h1>
        <span className="spacer" />
        <Menu items={[
          { label: allOpen ? "Close all sections" : "Open all sections", icon: <ChevronsUpDown size={16} />, onSelect: () => setOpen(allOpen ? new Set() : new Set(SECTIONS)) },
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Make a draft copy", icon: <Copy size={16} />, onSelect: () => create(v), hidden: v.status !== "official" },
          { label: "Archive draft", icon: <Archive size={16} />, onSelect: discard, hidden: v.status === "official", danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className={`badge badge-lg ${v.status === "official" ? "badge-green" : "badge-warn"}`} style={{ cursor: "default" }}>{v.status === "official" ? "Official" : "Draft"}</span>
          <span className="small muted">{v.status === "official" && v.published_at ? `Official since ${fmtDay(v.published_at, true)} · ` : ""}Updated {fmtDay(v.updated_at, true)}</span>
          <span className="spacer" />
          {versions.length > 1 && (
            <select className="select select-sm no-print" style={{ width: "auto" }} value={v.id} onChange={(e) => load(e.target.value)} aria-label="Version">
              {versions.map((x) => <option key={x.id} value={x.id}>{x.status === "official" ? "Official" : "Draft"} · {fmtDay(x.updated_at, true)}</option>)}
            </select>
          )}
        </div>
        {v.long_term_target && <p className="goal-finish"><span className="muted">Long-Term Target</span> {v.long_term_target}{v.long_term_target_date && <span className="muted nowrap"> · by {fmtDay(v.long_term_target_date, true)}</span>}</p>}
        <div className="plan-summary">
          {([["3-Year", "three_year"], ["1-Year", "one_year"], [`Q${q.quarter}`, "quarter"]] as const).map(([label, p]) => (
            <div key={p}><span className="muted small">{label}{v[`${p}_date`] ? ` · ${fmtDay(v[`${p}_date`], true)}` : ""}</span>
              <span>{v[`${p}_revenue`] || "—"} <span className="muted small">revenue</span></span>
              <span>{v[`${p}_profit`] || "—"} <span className="muted small">profit</span></span></div>
          ))}
        </div>
        {v.status !== "official" && (
          <div className="row no-print" style={{ gap: 8 }}>
            <span className="small muted" style={{ flex: 1 }}>A draft. Make it official when the leadership team agrees.</span>
            <button className="btn btn-sm btn-primary" onClick={publish}><BadgeCheck size={16} />Make official</button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <h2 className="steps-head">Vision</h2>
      <div className="card folds">
        <PlanFold title="Values" hint="3 to 7 rules you live by" count={list("value").length} {...fold("values")}>
          <ItemList section="value" {...lists} ro={ro("values")} placeholder="A Value" withNotes />
        </PlanFold>
        <PlanFold title="Purpose and Niche" hint="Why you exist, and what you're best at" {...fold("purpose")}>
          <label className="plan-field"><span>Purpose / cause / passion</span><Editable ro={ro("purpose")} value={v.purpose} onSave={setField("purpose")} multiline /></label>
          <label className="plan-field"><span>Niche</span><Editable ro={ro("purpose")} value={v.niche} onSave={setField("niche")} multiline /></label>
        </PlanFold>
        <PlanFold title="Long-Term Target" hint="One big, long-range goal" {...fold("target")}>
          <label className="plan-field"><span>Target</span><Editable ro={ro("target")} value={v.long_term_target} onSave={setField("long_term_target")} multiline /></label>
          <label className="plan-field"><span>By</span><Editable ro={ro("target")} type="date" value={v.long_term_target_date} onSave={setField("long_term_target_date")} /></label>
        </PlanFold>
        <PlanFold title="Marketing Strategy" {...fold("marketing")}>
          <label className="plan-field"><span>Target market ("the list")</span><Editable ro={ro("marketing")} value={v.target_market} onSave={setField("target_market")} multiline /></label>
          <div className="plan-field"><span>What Sets Us Apart (3)</span><ItemList section="differentiator" {...lists} ro={ro("marketing")} placeholder="What makes you different" /></div>
          <label className="plan-field"><span>How We Work</span><Editable ro={ro("marketing")} value={v.how_we_work} onSave={setField("how_we_work")} multiline /></label>
          <label className="plan-field"><span>Guarantee</span><Editable ro={ro("marketing")} value={v.guarantee} onSave={setField("guarantee")} multiline /></label>
        </PlanFold>
        <PlanFold title="3-Year Vision" {...fold("three")}>
          <Money v={v} prefix="three_year" setField={setField} ro={ro("three")} />
          <div className="plan-field"><span>Measurables</span><ItemList section="three_year_measurable" {...lists} ro={ro("three")} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>What does it look like?</span><ItemList section="three_year_goal" {...lists} ro={ro("three")} placeholder="Describe it" /></div>
        </PlanFold>
      </div>

      <h2 className="steps-head">Plan</h2>
      <div className="card folds">
        <PlanFold title="1-Year Plan" {...fold("one")}>
          <Money v={v} prefix="one_year" setField={setField} ro={ro("one")} />
          <div className="plan-field"><span>Measurables</span><ItemList section="one_year_measurable" {...lists} ro={ro("one")} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>Goals for the year (3 to 7)</span><ItemList section="one_year_goal" {...lists} ro={ro("one")} placeholder="Goal" withOwner /></div>
        </PlanFold>
        <PlanFold title="Quarterly Goals" hint={`This quarter: Q${q.quarter} ${q.year}`} count={list("quarter_goal").length} {...fold("quarter")}>
          <Money v={v} prefix="quarter" setField={setField} ro={ro("quarter")} />
          <div className="plan-field"><span>Measurables</span><ItemList section="quarter_measurable" {...lists} ro={ro("quarter")} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>Goals</span>
            <LinkedList section="quarter_goal" {...lists} ro={ro("quarter")} options={goals.filter((r) => r.quarter === q.quarter && r.quarter_year === q.year && r.goal_type === "company")}
              all={goals} kind="goal" render={(r) => <><Link to={`/goals/${r.id}`}>{r.title}</Link> <span className="small muted">· {byId(r.owner_member_id)?.first_name} · {GOAL_STATUS[(r as Goal).status].label}</span></>} />
          </div>
        </PlanFold>
        <PlanFold title="Issues List" hint="Long-term issues, not this week's" count={list("long_term_issue").length} {...fold("issues")}>
          <LinkedList section="long_term_issue" {...lists} ro={ro("issues")} options={issues} all={issues} kind="issue" allowText
            render={(i) => <><Link to={`/issues?open=${i.id}`}>{i.title}</Link> <span className="small muted">· {byId(i.owner_member_id)?.first_name ?? "Unassigned"}</span></>} />
        </PlanFold>
      </div>
      {v.status === "official" && <p className="small muted no-print">Edits here change the official Vision and Plan directly. For bigger rewrites, use ⋮ → Make a draft copy, and make it official when everyone agrees.</p>}
      {!isOwner && <p className="small muted no-print">Only owners can delete Vision and Plan versions permanently; drafts can be archived by anyone.</p>}
    </div>
  );
}

function Money({ v, prefix, setField, ro }: { v: Version; prefix: "three_year" | "one_year" | "quarter"; setField: (k: VersionField) => (value: string | null) => void; ro?: boolean }) {
  return (
    <div className="plan-money">
      <label className="plan-field"><span>Date</span><Editable ro={ro} type="date" value={v[`${prefix}_date`]} onSave={setField(`${prefix}_date`)} /></label>
      <label className="plan-field"><span>Revenue</span><Editable ro={ro} value={v[`${prefix}_revenue`]} onSave={setField(`${prefix}_revenue`)} placeholder="$" /></label>
      <label className="plan-field"><span>Profit</span><Editable ro={ro} value={v[`${prefix}_profit`]} onSave={setField(`${prefix}_profit`)} placeholder="$" /></label>
    </div>
  );
}

interface ListProps {
  section: Section; list: (s: Section) => Item[]; items: Item[]; versionId: string; companyId: string; reload: () => void; onError: (m: string) => void;
}

function useItemOps({ section, list, versionId, companyId, reload, onError }: ListProps) {
  const rows = list(section);
  const run = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) onError(friendlyError(error)); reload(); };
  return {
    rows,
    add: (fields: Partial<Item>) => run(supabase.from("ss_plan_items").insert({ company_id: companyId, version_id: versionId, section, title: "",
      sort_order: (rows.at(-1)?.sort_order ?? 0) + 1, ...fields })),
    patch: (it: Item, fields: Partial<Item>) => run(supabase.from("ss_plan_items").update(fields).eq("id", it.id)),
    remove: (it: Item) => run(supabase.from("ss_plan_items").delete().eq("id", it.id)),
    move: async (i: number, by: number) => {
      const a = rows[i], b = rows[i + by];
      if (!a || !b) return;
      await supabase.from("ss_plan_items").update({ sort_order: b.sort_order }).eq("id", a.id);
      run(supabase.from("ss_plan_items").update({ sort_order: a.sort_order === b.sort_order ? b.sort_order + 1 : a.sort_order }).eq("id", b.id));
    },
  };
}

function ItemList(props: ListProps & { placeholder: string; withNotes?: boolean; withValue?: boolean; withOwner?: boolean; ro?: boolean }) {
  const { rows, add, patch, remove, move } = useItemOps(props);
  const { active, byId } = useMembers();
  if (props.ro) {
    if (!rows.length) return <span className="plan-text muted">Not filled in</span>;
    return (
      <ol className="plan-read">
        {rows.map((it) => (
          <li key={it.id}>
            <span>{it.title || <span className="muted">Untitled</span>}</span>
            {props.withValue && it.value && <span className="muted"> · {it.value}</span>}
            {props.withOwner && it.owner_member_id && <span className="muted"> · {byId(it.owner_member_id)?.first_name}</span>}
            {props.withNotes && it.notes && <div className="small muted">{it.notes}</div>}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="plan-list">
      {rows.map((it, i) => (
        <div key={it.id} className="plan-item">
          <span className="plan-num">{i + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Editable value={it.title} onSave={(t) => patch(it, { title: t ?? "" })} placeholder={props.placeholder} />
            {props.withNotes && <Editable value={it.notes} onSave={(t) => patch(it, { notes: t })} placeholder="What it means (optional)" />}
          </div>
          {props.withValue && <div style={{ width: 110 }}><Editable value={it.value} onSave={(t) => patch(it, { value: t })} placeholder="Target" /></div>}
          {props.withOwner && (
            <select className="plan-input" style={{ width: 110 }} value={it.owner_member_id ?? ""} onChange={(e) => patch(it, { owner_member_id: e.target.value || null })} aria-label="Owner">
              <option value="">Owner</option>{active.map((m) => <option key={m.id} value={m.id}>{m.first_name}</option>)}
            </select>
          )}
          <span className="plan-tools no-print">
            <button className="link-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
            <button className="link-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
            <button className="link-btn" aria-label="Remove" onClick={() => remove(it)}><Trash2 size={14} /></button>
          </span>
        </div>
      ))}
      <button className="link-btn no-print plan-add" onClick={() => add({})}><Plus size={14} />Add</button>
    </div>
  );
}

/** Items that point at real Goals or Issues (or, for Issues, plain text). */
function LinkedList<T extends { id: string; title: string; owner_member_id: string | null }>(props: ListProps & {
  options: T[]; all: T[]; kind: "goal" | "issue"; allowText?: boolean; render: (x: T) => ReactNode; ro?: boolean;
}) {
  const { rows, add, remove, patch } = useItemOps(props);
  const key = props.kind === "goal" ? "linked_goal_id" : "linked_issue_id";
  const [pick, setPick] = useState("");
  if (props.ro) {
    if (!rows.length) return <span className="plan-text muted">None yet</span>;
    return (
      <ol className="plan-read">
        {rows.map((it) => { const target = props.all.find((x) => x.id === it[key]); return <li key={it.id}>{target ? props.render(target) : <span className={it[key] ? "muted" : ""}>{it.title || "(removed)"}</span>}</li>; })}
      </ol>
    );
  }
  const linked = new Set(rows.map((r) => r[key]).filter(Boolean));
  const unlinked = props.options.filter((o) => !linked.has(o.id));
  return (
    <div className="plan-list">
      {rows.map((it, i) => {
        const target = props.all.find((x) => x.id === it[key]);
        return (
          <div key={it.id} className="plan-item">
            <span className="plan-num">{i + 1}.</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {target ? props.render(target) : it[key]
                ? <span className="muted">{it.title || "(removed)"}</span>
                : <Editable value={it.title} onSave={(t) => patch(it, { title: t ?? "" })} placeholder="Long-term issue" />}
            </div>
            <button className="link-btn no-print" aria-label="Remove" onClick={() => remove(it)}><Trash2 size={14} /></button>
          </div>
        );
      })}
      <div className="row wrap no-print" style={{ gap: 6 }}>
        {unlinked.length > 0 && <>
          <select className="plan-input" style={{ width: "auto", maxWidth: 260 }} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{props.kind === "goal" ? "Choose a company Goal…" : "Link an open Issue…"}</option>
            {unlinked.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <button className="btn btn-sm" disabled={!pick} onClick={() => { const o = props.options.find((x) => x.id === pick); if (o) add({ title: o.title, [key]: o.id }); setPick(""); }}><Link2 size={14} />Link</button>
        </>}
        {props.kind === "goal" && unlinked.length > 1 && (
          <button className="btn btn-sm btn-ghost" onClick={async () => { for (const o of unlinked) await add({ title: o.title, [key]: o.id }); }}>Link all {unlinked.length}</button>
        )}
        {props.allowText && <button className="link-btn plan-add" onClick={() => add({})}><Plus size={14} />Add as text</button>}
      </div>
    </div>
  );
}
