import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Download, Plus, Settings, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { today, useMembers, useOpenParam } from "../lib/data";
import { downloadCsv } from "../lib/csv";
import {
  COMPARISON_LABEL, PERIOD_LABEL, UNIT_LABEL, fmtValue, goalText, onTrack, parseNumber, periodLabel, recentPeriods,
  type Comparison, type MValue, type Measurable, type Period, type Scorecard as Card, type Unit,
} from "../lib/scorecard";
import { Avatar, Empty, OwnerSelect, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";

const SECTION_ORDER: Period[] = ["week", "month", "quarter", "year"];
const COUNT: Record<Period, number> = { week: 13, month: 6, quarter: 4, year: 3 };

function useWide() {
  const q = "(min-width: 760px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Scorecard() {
  const { company } = useMe();
  const { byId } = useMembers();
  const wide = useWide();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [measurables, setMeasurables] = useState<Measurable[]>([]);
  const [values, setValues] = useState<MValue[]>([]);
  const [editing, setEditing] = useState<Measurable | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: cards } = await supabase.from("ss_scorecards").select("*").order("created_at").limit(1);
    const sc = ((cards ?? []) as Card[])[0] ?? null;
    setCard(sc);
    if (!sc) return;
    const { data: ms } = await supabase.from("ss_measurables").select("*").eq("scorecard_id", sc.id)
      .is("deleted_at", null).is("archived_at", null).order("sort_order").order("title");
    const list = (ms ?? []) as Measurable[];
    setMeasurables(list);
    if (!list.length) { setValues([]); return; }
    const earliest = recentPeriods("year", COUNT.year)[0] < recentPeriods("week", Math.max(sc.periods_to_show, 13))[0]
      ? recentPeriods("year", COUNT.year)[0] : recentPeriods("week", Math.max(sc.periods_to_show, 13))[0];
    const { data: vs } = await supabase.from("ss_measurable_values").select("id, measurable_id, period_start, value, goal_value, goal_value_upper, comparison, note")
      .in("measurable_id", list.map((m) => m.id)).gte("period_start", earliest);
    setValues((vs ?? []) as MValue[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useOpenParam(measurables.length ? measurables : null, "ss_measurables", setEditing);

  const valueFor = (m: Measurable, p: string) => values.find((v) => v.measurable_id === m.id && v.period_start === p);

  /** Save one cell: blank removes the number, otherwise insert or update it. */
  const save = async (m: Measurable, period: string, text: string) => {
    const n = parseNumber(text);
    const existing = valueFor(m, period);
    if (Number.isNaN(n)) { setError(`"${text}" isn't a number.`); return; }
    setError("");
    if (n === null) {
      if (existing) {
        const { error } = await supabase.from("ss_measurable_values").delete().eq("id", existing.id);
        if (error) { setError(friendlyError(error)); return; }
      }
    } else if (existing) {
      if (existing.value === n) return;
      const { error } = await supabase.from("ss_measurable_values").update({ value: n }).eq("id", existing.id);
      if (error) { setError(friendlyError(error)); return; }
    } else {
      const { error } = await supabase.from("ss_measurable_values")
        .insert({ company_id: company.id, measurable_id: m.id, period_start: period, value: n });
      if (error) { setError(friendlyError(error)); return; }
    }
    load();
  };

  if (card === undefined) return <p className="muted">Loading…</p>;
  if (card === null) return <Empty>There's no Scorecard yet. It's created with the first meeting during set-up.</Empty>;

  const sections = SECTION_ORDER.map((p) => {
    const list = measurables.filter((m) => (m.period_override ?? card.period) === p);
    let periods = recentPeriods(p, p === card.period ? card.periods_to_show : COUNT[p]);
    if (card.newest_first) periods = [...periods].reverse();
    return { period: p, list, periods };
  }).filter((s) => s.list.length);

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [];
    for (const s of sections) for (const m of s.list) for (const p of s.periods) {
      const v = valueFor(m, p);
      if (v?.value === null || v === undefined) continue;
      const o = byId(m.owner_member_id);
      rows.push([m.title, o ? fullName(o) : "", PERIOD_LABEL[s.period], p, v.value, goalText(m),
        onTrack(v.value, v.goal_value, v.goal_value_upper, v.comparison) === false ? "off" : "on"]);
    }
    downloadCsv(`scorecard-${today()}`, ["Measurable", "Owner", "Period", "Period start", "Value", "Goal", "On track"], rows);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{card.title}</h1>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={exportCsv} aria-label="Export to CSV" title="Export to CSV"><Download size={18} /></button>
        <button className="btn btn-sm btn-ghost" onClick={() => setSettings(true)} aria-label="Scorecard settings" title="Settings"><Settings size={18} /></button>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={16} />Add</button>
      </div>
      {error && <p className="error">{error}</p>}
      {measurables.length === 0 && <Empty>No measurables yet. Add the handful of numbers that tell you the business is on track.</Empty>}

      {sections.map((s) => (
        <Section key={s.period} title={PERIOD_LABEL[s.period]} count={s.list.length}>
          {wide
            ? <Grid card={card} period={s.period} periods={s.periods} list={s.list} loaded={values.length} valueFor={valueFor} byId={byId} onSave={save} onEdit={setEditing} />
            : <div className="stack" style={{ gap: 8 }}>{s.list.map((m) => (
                <PhoneCard key={m.id} m={m} period={s.period} valueFor={valueFor} owner={byId(m.owner_member_id)} onSave={save} onEdit={() => setEditing(m)} />
              ))}</div>}
        </Section>
      ))}
      {wide && measurables.length > 0 && <p className="small muted">Click a cell to type a number; press Enter or Tab to save. Clear it to remove the number.</p>}

      {editing && <MeasurableSheet m={editing === "new" ? null : editing} card={card} all={measurables}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {settings && <SettingsSheet card={card} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); load(); }} />}
    </div>
  );
}

// ─── Desktop grid ───────────────────────────────────────────────────────────

function Cell({ m, period, v, onSave }: { m: Measurable; period: string; v: MValue | undefined; onSave: (m: Measurable, p: string, t: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const ok = onTrack(v?.value ?? null, v?.goal_value ?? null, v?.goal_value_upper ?? null, v?.comparison ?? null);
  const commit = () => { if (edit !== null) onSave(m, period, edit); setEdit(null); };
  return (
    <td className={`sc-cell${ok === true ? " sc-on" : ok === false ? " sc-off" : ""}`} onClick={() => edit === null && setEdit(v?.value?.toString() ?? "")}>
      {edit !== null ? (
        <input className="sc-input" autoFocus inputMode="decimal" value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); }} aria-label={`${m.title}, ${period}`} />
      ) : fmtValue(v?.value, m.unit, m.decimals)}
    </td>
  );
}

function Grid({ card, period, periods, list, loaded, valueFor, byId, onSave, onEdit }: {
  card: Card; period: Period; periods: string[]; list: Measurable[]; loaded: number;
  valueFor: (m: Measurable, p: string) => MValue | undefined; byId: ReturnType<typeof useMembers>["byId"];
  onSave: (m: Measurable, p: string, t: string) => void; onEdit: (m: Measurable) => void;
}) {
  // Open scrolled to the newest periods.
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (wrap.current && !card.newest_first) wrap.current.scrollLeft = wrap.current.scrollWidth;
  }, [card.newest_first, periods.length, loaded]);
  return (
    <div className="card sc-wrap" ref={wrap}>
      <table className="sc">
        <thead>
          <tr>
            <th className="sc-title">Measurable · goal</th>
            {periods.map((p) => <th key={p} className="sc-head">{periodLabel(period, p)}</th>)}
            {card.show_total && <th className="sc-head">Total</th>}
            {card.show_average && <th className="sc-head">Avg</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const nums = periods.map((p) => valueFor(m, p)?.value).filter((x): x is number => x !== null && x !== undefined);
            const total = nums.reduce((a, b) => a + b, 0);
            return (
              <tr key={m.id}>
                <td className="sc-title">
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar m={byId(m.owner_member_id)} size={26} />
                    <div style={{ minWidth: 0 }}>
                      <button className="link-btn sc-name" onClick={() => onEdit(m)}>{m.title}</button>
                      <div className="small muted">{goalText(m)}</div>
                    </div>
                  </div>
                </td>
                {periods.map((p) => <Cell key={p} m={m} period={p} v={valueFor(m, p)} onSave={onSave} />)}
                {card.show_total && <td className="sc-cell sc-agg">{nums.length ? fmtValue(total, m.unit, m.decimals) : ""}</td>}
                {card.show_average && <td className="sc-cell sc-agg">{nums.length ? fmtValue(total / nums.length, m.unit, Math.max(m.decimals, 1)) : ""}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Phone card: one measurable, its trend, this period and last ────────────

function PhoneCard({ m, period, valueFor, owner, onSave, onEdit }: {
  m: Measurable; period: Period; valueFor: (m: Measurable, p: string) => MValue | undefined;
  owner: ReturnType<ReturnType<typeof useMembers>["byId"]>; onSave: (m: Measurable, p: string, t: string) => void; onEdit: () => void;
}) {
  const periods = recentPeriods(period, 8);
  const vals = periods.map((p) => valueFor(m, p));
  const nums = vals.map((v) => v?.value).filter((x): x is number => x !== null && x !== undefined);
  const max = Math.max(...nums.map(Math.abs), Math.abs(m.goal_value ?? 0), 1);
  const [cur, prev] = [periods[7], periods[6]];
  const entry = (p: string, label: string) => {
    const v = valueFor(m, p);
    const ok = onTrack(v?.value ?? null, v?.goal_value ?? null, v?.goal_value_upper ?? null, v?.comparison ?? null);
    return (
      <label className="field" style={{ flex: 1 }}><span className="small">{label} <span className="muted">· {periodLabel(period, p)}</span></span>
        <input key={`${p}-${v?.value ?? ""}`} className={`input${ok === true ? " sc-on" : ok === false ? " sc-off" : ""}`} inputMode="decimal"
          defaultValue={v?.value?.toString() ?? ""} onBlur={(e) => onSave(m, p, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </label>
    );
  };
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Avatar m={owner} />
        <button className="link-btn sc-name" style={{ flex: 1, textAlign: "left" }} onClick={onEdit}>{m.title}</button>
        <span className="small muted" style={{ whiteSpace: "nowrap" }}>{goalText(m)}</span>
      </div>
      <div className="spark" aria-label="Last 8 periods">
        {vals.map((v, i) => {
          const ok = onTrack(v?.value ?? null, v?.goal_value ?? null, v?.goal_value_upper ?? null, v?.comparison ?? null);
          const h = v?.value === null || v?.value === undefined ? 0 : Math.max(6, (Math.abs(v.value) / max) * 40);
          return <span key={i} className={`spark-bar${ok === true ? " sc-on-bar" : ok === false ? " sc-off-bar" : ""}`} style={{ height: h }}
            title={`${periodLabel(period, periods[i])}: ${fmtValue(v?.value, m.unit, m.decimals) || "no number"}`} />;
        })}
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        {entry(prev, period === "week" ? "Last week" : "Last")}
        {entry(cur, period === "week" ? "This week" : "This")}
      </div>
    </div>
  );
}

// ─── Editing ────────────────────────────────────────────────────────────────

function MeasurableSheet({ m, card, all, onClose, onSaved }: { m: Measurable | null; card: Card; all: Measurable[]; onClose: () => void; onSaved: () => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const [form, setForm] = useState({
    title: m?.title ?? "", description: m?.description ?? "", owner_member_id: m?.owner_member_id ?? me.id,
    unit: m?.unit ?? ("number" as Unit), comparison: m?.comparison ?? ("gte" as Comparison),
    goal_value: m?.goal_value?.toString() ?? "", goal_value_upper: m?.goal_value_upper?.toString() ?? "",
    decimals: m?.decimals ?? 0, period_override: m?.period_override ?? ("" as Period | ""), is_additive: m?.is_additive ?? true,
  });
  const [error, setError] = useState("");

  const run = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const goal = parseNumber(form.goal_value), upper = parseNumber(form.goal_value_upper);
    if (Number.isNaN(goal) || Number.isNaN(upper)) { setError("Goals must be numbers."); return; }
    const row = {
      title: form.title.trim(), description: form.description.trim() || null, owner_member_id: form.owner_member_id,
      unit: form.unit, comparison: form.comparison, goal_value: goal, goal_value_upper: form.comparison === "between" ? upper : null,
      decimals: form.decimals, period_override: form.period_override && form.period_override !== card.period ? form.period_override : null,
      is_additive: form.is_additive,
    };
    run(m ? supabase.from("ss_measurables").update(row).eq("id", m.id)
      : supabase.from("ss_measurables").insert({ ...row, company_id: company.id, scorecard_id: card.id,
          sort_order: all.reduce((n, x) => Math.max(n, x.sort_order), 0) + 1 }));
  };
  const move = async (by: number) => {
    if (!m) return;
    const i = all.findIndex((x) => x.id === m.id), other = all[i + by];
    if (!other) return;
    // Renumber the whole list so equal sort numbers can't stop a move.
    const order = [...all]; [order[i], order[i + by]] = [order[i + by], order[i]];
    await Promise.all(order.map((x, n) => x.sort_order === n ? null : supabase.from("ss_measurables").update({ sort_order: n }).eq("id", x.id)));
    onSaved();
  };

  return (
    <Sheet title={m ? "Measurable" : "New measurable"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Name</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field"><span>Owner</span><OwnerSelect members={active} allowNone value={form.owner_member_id} onChange={(v) => setForm({ ...form, owner_member_id: v ?? "" })} /></label>
          <label className="field"><span>Measured</span>
            <select className="select" value={form.period_override || card.period} onChange={(e) => setForm({ ...form, period_override: e.target.value as Period })}>
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="field"><span>Unit</span>
            <select className="select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>
              {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </label>
          <label className="field"><span>Decimal places</span>
            <select className="select" value={form.decimals} onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field"><span>Goal is</span>
            <select className="select" value={form.comparison} onChange={(e) => setForm({ ...form, comparison: e.target.value as Comparison })}>
              {(Object.keys(COMPARISON_LABEL) as Comparison[]).map((c) => <option key={c} value={c}>{COMPARISON_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="field"><span>{form.comparison === "between" ? "From" : "Goal"}</span>
            <input className="input" inputMode="decimal" value={form.goal_value} onChange={(e) => setForm({ ...form, goal_value: e.target.value })} />
          </label>
          {form.comparison === "between" && <label className="field"><span>To</span>
            <input className="input" inputMode="decimal" value={form.goal_value_upper} onChange={(e) => setForm({ ...form, goal_value_upper: e.target.value })} />
          </label>}
        </div>
        <label className="field"><span>What it measures</span>
          <textarea className="input textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_additive} onChange={(e) => setForm({ ...form, is_additive: e.target.checked })} />
          Numbers add up over time (show a total)
        </label>
        <p className="small muted">Changing the goal doesn't recolour past numbers: each number keeps the goal it was entered against.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">{m ? "Save" : "Add measurable"}</button>
        {m && <div className="row wrap">
          <button type="button" className="btn btn-sm" onClick={() => move(-1)} disabled={all[0]?.id === m.id}><ArrowUp size={16} />Up</button>
          <button type="button" className="btn btn-sm" onClick={() => move(1)} disabled={all.at(-1)?.id === m.id}><ArrowDown size={16} />Down</button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-danger"
            onClick={() => confirm("Move this measurable to the recycle bin? Its numbers are kept.") && run(supabase.from("ss_measurables").update({ deleted_at: new Date().toISOString() }).eq("id", m.id))}>
            <Trash2 size={16} />Recycle bin
          </button>
        </div>}
      </form>
    </Sheet>
  );
}

function SettingsSheet({ card, onClose, onSaved }: { card: Card; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: card.title, periods_to_show: card.periods_to_show, newest_first: card.newest_first, show_total: card.show_total, show_average: card.show_average });
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("ss_scorecards").update(form).eq("id", card.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const check = (k: "newest_first" | "show_total" | "show_average", label: string) => (
    <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />{label}
    </label>
  );
  return (
    <Sheet title="Scorecard settings" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Name</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field"><span>{PERIOD_LABEL[card.period]} columns to show</span>
          <input className="input" type="number" min={1} max={52} value={form.periods_to_show} onChange={(e) => setForm({ ...form, periods_to_show: Math.min(52, Math.max(1, Number(e.target.value) || 13)) })} />
        </label>
        {check("newest_first", "Newest on the left")}
        {check("show_total", "Show a total column")}
        {check("show_average", "Show an average column")}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">Save</button>
      </form>
    </Sheet>
  );
}
