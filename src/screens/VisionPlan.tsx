import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, BadgeCheck, Copy, Link2, Plus, Printer, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { GOAL_STATUS, currentQuarter, fmtDay, useMembers, type Issue, type Goal } from "../lib/data";
import { Empty } from "../components/ui";

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
function Editable({ value, onSave, placeholder, multiline, type }: { value: string | null; onSave: (v: string | null) => void; placeholder?: string; multiline?: boolean; type?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const done = () => { const next = v.trim() || null; if (next !== (value ?? null)) onSave(next); };
  return multiline
    ? <textarea className="plan-input" rows={Math.max(2, v.split("\n").length)} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={done} />
    : <input className="plan-input" type={type ?? "text"} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={done}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="plan-block">
      <div className="plan-label"><h3>{title}</h3>{hint && <span className="small muted">{hint}</span>}</div>
      <div className="plan-body">{children}</div>
    </div>
  );
}

export function VisionPlan() {
  const { me, company, isOwner } = useMe();
  const { byId } = useMembers();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState("");

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
    const base = from ? Object.fromEntries(COPY_FIELDS.map((k) => [k, from[k]])) : { title: "Vision & Plan" };
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
    if (!v || !confirm("Make this the official Vision & Plan? The current official one is kept as an archived version.")) return;
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
        <h1>Vision & Plan</h1>
        <Empty>No Vision & Plan yet. Start one and fill it in together; make it official when the leadership team agrees.</Empty>
        <button className="btn btn-primary" onClick={() => create(null)}><Plus size={16} />Start the Vision & Plan</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const list = (s: Section) => items.filter((i) => i.section === s);
  const lists = { list, items, versionId: v.id, companyId: company.id, reload: () => load(v.id), onError: setError };
  const q = currentQuarter();

  return (
    <div className="stack plan">
      <div className="page-head">
        <h1>{v.title}</h1>
        <span className={`badge ${v.status === "official" ? "badge-green" : "badge-warn"}`}>{v.status === "official" ? "Official" : "Draft"}</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost no-print" onClick={() => print()} aria-label="Print" title="Print"><Printer size={18} /></button>
      </div>
      <div className="row wrap no-print">
        {versions.length > 1 && (
          <select className="select" style={{ width: "auto" }} value={v.id} onChange={(e) => load(e.target.value)}>
            {versions.map((x) => <option key={x.id} value={x.id}>{x.status === "official" ? "Official" : "Draft"} · {fmtDay(x.updated_at, true)}</option>)}
          </select>
        )}
        <span className="spacer" />
        {v.status === "official"
          ? <button className="btn btn-sm" onClick={() => create(v)}><Copy size={16} />Make a draft copy</button>
          : <>
              <button className="btn btn-sm btn-ghost" onClick={discard}>Archive draft</button>
              <button className="btn btn-sm btn-primary" onClick={publish}><BadgeCheck size={16} />Make official</button>
            </>}
      </div>
      {v.status === "official" && <p className="small muted no-print">You're editing the official Vision & Plan directly. For bigger rewrites, make a draft copy and make it official when everyone agrees.</p>}
      {error && <p className="error">{error}</p>}

      <h2 className="plan-page">Vision</h2>
      <div className="card plan-card">
        <Block title="Values" hint="3 to 7 rules you live by"><ItemList section="value" {...lists} placeholder="A Value" withNotes /></Block>
        <Block title="Purpose & Niche" hint="Why you exist, and what you're best at">
          <label className="plan-field"><span>Purpose / cause / passion</span><Editable value={v.purpose} onSave={setField("purpose")} multiline /></label>
          <label className="plan-field"><span>Niche</span><Editable value={v.niche} onSave={setField("niche")} multiline /></label>
        </Block>
        <Block title="Long-Term Target" hint="One big, long-range goal">
          <Editable value={v.long_term_target} onSave={setField("long_term_target")} multiline />
          <label className="plan-field"><span>By</span><Editable type="date" value={v.long_term_target_date} onSave={setField("long_term_target_date")} /></label>
        </Block>
        <Block title="Marketing Strategy">
          <label className="plan-field"><span>Target market ("the list")</span><Editable value={v.target_market} onSave={setField("target_market")} multiline /></label>
          <div className="plan-field"><span>What Sets Us Apart (3)</span><ItemList section="differentiator" {...lists} placeholder="What makes you different" /></div>
          <label className="plan-field"><span>How We Work</span><Editable value={v.how_we_work} onSave={setField("how_we_work")} multiline /></label>
          <label className="plan-field"><span>Guarantee</span><Editable value={v.guarantee} onSave={setField("guarantee")} multiline /></label>
        </Block>
        <Block title="3-Year Vision">
          <Money v={v} prefix="three_year" setField={setField} />
          <div className="plan-field"><span>Measurables</span><ItemList section="three_year_measurable" {...lists} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>What does it look like?</span><ItemList section="three_year_goal" {...lists} placeholder="Describe it" /></div>
        </Block>
      </div>

      <h2 className="plan-page">Plan</h2>
      <div className="card plan-card">
        <Block title="1-Year Plan">
          <Money v={v} prefix="one_year" setField={setField} />
          <div className="plan-field"><span>Measurables</span><ItemList section="one_year_measurable" {...lists} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>Goals for the year (3 to 7)</span><ItemList section="one_year_goal" {...lists} placeholder="Goal" withOwner /></div>
        </Block>
        <Block title="Quarterly Goals" hint={`This quarter: Q${q.quarter} ${q.year}`}>
          <Money v={v} prefix="quarter" setField={setField} />
          <div className="plan-field"><span>Measurables</span><ItemList section="quarter_measurable" {...lists} placeholder="Measurable" withValue /></div>
          <div className="plan-field"><span>Goals</span>
            <LinkedList section="quarter_goal" {...lists} options={goals.filter((r) => r.quarter === q.quarter && r.quarter_year === q.year && r.goal_type === "company")}
              all={goals} kind="goal" render={(r) => <><Link to={`/goals/${r.id}`}>{r.title}</Link> <span className="small muted">· {byId(r.owner_member_id)?.first_name} · {GOAL_STATUS[(r as Goal).status].label}</span></>} />
          </div>
        </Block>
        <Block title="Issues List" hint="Long-term issues, not this week's">
          <LinkedList section="long_term_issue" {...lists} options={issues} all={issues} kind="issue" allowText
            render={(i) => <><Link to={`/issues?open=${i.id}`}>{i.title}</Link> <span className="small muted">· {byId(i.owner_member_id)?.first_name ?? "Unassigned"}</span></>} />
        </Block>
      </div>
      {!isOwner && <p className="small muted no-print">Only owners can delete Vision & Plan versions permanently; drafts can be archived by anyone.</p>}
    </div>
  );
}

function Money({ v, prefix, setField }: { v: Version; prefix: "three_year" | "one_year" | "quarter"; setField: (k: VersionField) => (value: string | null) => void }) {
  return (
    <div className="plan-money">
      <label className="plan-field"><span>Date</span><Editable type="date" value={v[`${prefix}_date`]} onSave={setField(`${prefix}_date`)} /></label>
      <label className="plan-field"><span>Revenue</span><Editable value={v[`${prefix}_revenue`]} onSave={setField(`${prefix}_revenue`)} placeholder="$" /></label>
      <label className="plan-field"><span>Profit</span><Editable value={v[`${prefix}_profit`]} onSave={setField(`${prefix}_profit`)} placeholder="$" /></label>
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

function ItemList(props: ListProps & { placeholder: string; withNotes?: boolean; withValue?: boolean; withOwner?: boolean }) {
  const { rows, add, patch, remove, move } = useItemOps(props);
  const { active } = useMembers();
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
  options: T[]; all: T[]; kind: "goal" | "issue"; allowText?: boolean; render: (x: T) => ReactNode;
}) {
  const { rows, add, remove, patch } = useItemOps(props);
  const key = props.kind === "goal" ? "linked_goal_id" : "linked_issue_id";
  const linked = new Set(rows.map((r) => r[key]).filter(Boolean));
  const unlinked = props.options.filter((o) => !linked.has(o.id));
  const [pick, setPick] = useState("");
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
