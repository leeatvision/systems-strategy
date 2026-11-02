import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, CircleAlert, Download, Grid3x3, List, Pencil, Plus, Printer, Settings, SquarePen, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, today, useMembers, useOpenParam } from "../lib/data";
import { downloadCsv } from "../lib/csv";
import {
  COMPARISON_LABEL, PERIOD_LABEL, UNIT_LABEL, fmtValue, goalText, onTrack, parseNumber, recentPeriods, scheduleOf, timeline, upcomingMeeting,
  type Comparison, type MValue, type Timeline, type Measurable, type Period, type Scorecard as Card, type Unit,
} from "../lib/scorecard";
import { Avatar, Empty, Fold, Menu, OwnerSelect, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { History } from "../components/History";
import { MineToggle, useFilters } from "../components/Filters";

const SECTION_ORDER: Period[] = ["week", "month", "quarter", "year"];
const COUNT: Record<Period, number> = { week: 13, month: 6, quarter: 4, year: 3 };
/** How many periods a number's own page charts. */
const TREND: Record<Period, number> = { week: 13, month: 12, quarter: 8, year: 5 };

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

const periodOf = (m: Measurable, card: Card): Period => m.period_override ?? card.period;
/** The most recent period with a number in it, among the last few. */
function latest(m: Measurable, card: Card, t: Timeline, valueFor: (m: Measurable, p: string) => MValue | undefined) {
  const ps = t.periods(periodOf(m, card), TREND[periodOf(m, card)]).reverse();
  for (const p of ps) { const v = valueFor(m, p); if (v && v.value !== null) return { p, v }; }
  return null;
}
const statusOf = (v: MValue | undefined) => onTrack(v?.value ?? null, v?.goal_value ?? null, v?.goal_value_upper ?? null, v?.comparison ?? null);

/** Key Numbers, their numbers and how to save one; shared by the list and each number's page. */
function useKeyNumbers() {
  const { company } = useMe();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [measurables, setMeasurables] = useState<Measurable[]>([]);
  const [values, setValues] = useState<MValue[]>([]);
  const [t, setT] = useState<Timeline>(() => timeline(null));
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: cards } = await supabase.from("ss_scorecards").select("*").order("created_at").limit(1);
    const sc = ((cards ?? []) as Card[])[0] ?? null;
    setCard(sc);
    if (!sc) return;
    // Weekly numbers are dated by the meeting these Key Numbers belong to.
    const { data: mt } = sc.meeting_id ? await supabase.from("ss_meetings").select("first_meeting_at, cadence").eq("id", sc.meeting_id).maybeSingle() : { data: null };
    setT(timeline(scheduleOf(mt as { first_meeting_at: string | null; cadence: string } | null)));
    const { data: ms } = await supabase.from("ss_measurables").select("*").eq("scorecard_id", sc.id)
      .is("deleted_at", null).is("archived_at", null).order("sort_order").order("title");
    const list = (ms ?? []) as Measurable[];
    setMeasurables(list);
    if (!list.length) { setValues([]); return; }
    const starts = [recentPeriods("week", Math.max(sc.periods_to_show, TREND.week))[0], recentPeriods("month", TREND.month)[0],
      recentPeriods("quarter", TREND.quarter)[0], recentPeriods("year", TREND.year)[0]];
    const earliest = starts.sort()[0];
    const { data: vs } = await supabase.from("ss_measurable_values").select("id, measurable_id, period_start, value, goal_value, goal_value_upper, comparison, note")
      .in("measurable_id", list.map((m) => m.id)).gte("period_start", earliest);
    setValues((vs ?? []) as MValue[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const valueFor = useCallback((m: Measurable, p: string) => values.find((v) => v.measurable_id === m.id && v.period_start === p), [values]);

  /** Save one number: blank removes it, otherwise insert or update it. */
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
  return { card, measurables, values, valueFor, save, load, error, setError, t };
}

export function Scorecard() {
  const { me } = useMe();
  const { byId } = useMembers();
  const navigate = useNavigate();
  const wide = useWide();
  const { card, measurables, values, valueFor, save, load, error, t } = useKeyNumbers();
  const filters = useFilters("keynumbers", { owner: "all" });
  const [editing, setEditing] = useState<"new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [entering, setEntering] = useState(false);
  const [view, setViewState] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("ss.keyNumbersView") as "list" | "grid") || (wide ? "grid" : "list"); } catch { return "list"; }
  });
  const setView = (v: "list" | "grid") => { setViewState(v); try { localStorage.setItem("ss.keyNumbersView", v); } catch { /* private mode */ } };
  useOpenParam(measurables.length ? measurables : null, "ss_measurables", (m) => navigate(`/key-numbers/${m.id}`));

  if (card === undefined) return <p className="muted">Loading…</p>;
  if (card === null) return <Empty>There are no Key Numbers yet. They're set up with the first meeting.</Empty>;

  const mine = measurables.filter((m) => filters.values.owner !== "me" || m.owner_member_id === me.id);
  const sections = SECTION_ORDER.map((p) => {
    const list = mine.filter((m) => periodOf(m, card) === p);
    let periods = t.periods(p, p === card.period ? card.periods_to_show : COUNT[p]);
    if (card.newest_first) periods = [...periods].reverse();
    return { period: p, list, periods };
  }).filter((s) => s.list.length);
  // Numbers still missing for their last full period (last week, last month…).
  // Weekly ones count from two days before their meeting; others once their period has ended.
  const nextWeek = t.pair("week");
  const soon = !t.sched || (new Date(`${upcomingMeeting(t.sched)}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86400000 <= 2;
  const missing = mine.filter((m) => {
    const per = periodOf(m, card);
    if (per === "week" && t.sched) return soon && !valueFor(m, nextWeek.cur);
    return !valueFor(m, t.pair(per).prev);
  });
  const missingText = missing.every((m) => periodOf(m, card) === "week") && t.sched ? `for the ${t.label("week", nextWeek.cur)} meeting`
    : missing.every((m) => periodOf(m, card) === "week") ? "for last week" : "";

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [];
    for (const s of sections) for (const m of s.list) for (const p of s.periods) {
      const v = valueFor(m, p);
      if (v?.value === null || v === undefined) continue;
      const o = byId(m.owner_member_id);
      rows.push([m.title, o ? fullName(o) : "", PERIOD_LABEL[s.period], p, v.value, goalText(m),
        statusOf(v) === false ? "off" : "on"]);
    }
    downloadCsv(`key-numbers-${today()}`, ["Number", "Owner", "Period", "Period start", "Value", "Goal", "On track"], rows);
  };

  const row = (m: Measurable) => {
    const last = latest(m, card, t, valueFor);
    const ok = statusOf(last?.v);
    const per = periodOf(m, card);
    const spark = t.periods(per, 8).map((p) => valueFor(m, p));
    const max = Math.max(...spark.map((v) => Math.abs(v?.value ?? 0)), Math.abs(m.goal_value ?? 0), 1);
    return (
      <li key={m.id} className="clickable" onClick={() => navigate(`/key-numbers/${m.id}`)}>
        <Avatar m={byId(m.owner_member_id)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title">{m.title}</div>
          <div className="row small muted" style={{ gap: 8, flexWrap: "wrap" }}>
            <span>Goal {goalText(m)}</span>
            <span className="mini-spark" aria-hidden>{spark.map((v, i) => (
              <span key={i} className={statusOf(v) === true ? "sc-on-bar" : statusOf(v) === false ? "sc-off-bar" : ""}
                style={{ height: v?.value == null ? 2 : Math.max(3, (Math.abs(v.value) / max) * 16) }} />
            ))}</span>
          </div>
        </div>
        <div className="kn-latest">
          <span className={`badge ${ok === true ? "badge-green" : ok === false ? "badge-danger" : ""}`}>{last ? fmtValue(last.v.value, m.unit, m.decimals) : "No number"}</span>
          {last && <span className="small muted">{t.label(per, last.p)}</span>}
        </div>
      </li>
    );
  };

  return (
    <div className="stack">
      <div className="page-head goals-head">
        <h1>{card.title}</h1>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm desktop-only" onClick={() => setEditing("new")}><Plus size={16} />New Number</button>
      </div>
      <h2 className="print-only">{card.title}</h2>
      <div className="toolbar no-print">
        <span className="seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} aria-label="List" title="List" onClick={() => setView("list")}><List size={18} /></button>
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} aria-label="Grid" title="Grid" onClick={() => setView("grid")}><Grid3x3 size={18} /></button>
        </span>
        <span className="spacer" />
        <MineToggle value={filters.values.owner} onChange={(v) => filters.set("owner", v)} />
        <Menu items={[
          { label: "Enter Numbers", icon: <SquarePen size={16} />, onSelect: () => setEntering(true), hidden: !mine.length },
          { label: "Settings", icon: <Settings size={16} />, onSelect: () => setSettings(true) },
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: exportCsv },
        ]} />
      </div>
      {missing.length > 0 && (
        <div className="close-banner no-print">
          <span>{missing.length} number{missing.length === 1 ? "" : "s"} still to enter{missingText ? ` ${missingText}` : ""}</span>
          <button type="button" className="link-btn" onClick={() => setEntering(true)}>Enter</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {measurables.length === 0 && <Empty>No Key Numbers yet. Add the handful of numbers that tell you the business is on track.</Empty>}
      {measurables.length > 0 && mine.length === 0 && <Empty>None of the Key Numbers are yours.</Empty>}

      {sections.map((s) => (
        <Section key={s.period} title={PERIOD_LABEL[s.period]} count={s.list.length}>
          {view === "grid"
            ? <Grid card={card} t={t} period={s.period} periods={s.periods} list={s.list} loaded={values.length} valueFor={valueFor} byId={byId} onSave={save} onOpen={(m) => navigate(`/key-numbers/${m.id}`)} />
            : <ul className="card list">{s.list.map(row)}</ul>}
        </Section>
      ))}
      {view === "grid" && mine.length > 0 && <p className="small muted">Tap a cell to type a number; press Enter or Tab to save. Clear it to remove the number.</p>}
      <div className="fab-space" aria-hidden />
      <button type="button" className="fab no-print" onClick={() => setEditing("new")} aria-label="New Number"><Plus size={20} />New Number</button>

      {editing && <MeasurableSheet m={null} card={card} all={measurables} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); navigate(`/key-numbers/${id}`); }} />}
      {settings && <SettingsSheet card={card} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); load(); }} />}
      {entering && <EnterSheet card={card} t={t} list={mine} valueFor={valueFor} onSave={save} onClose={() => setEntering(false)} />}
    </div>
  );
}

/** Quick entry: every number's last full period (and the current one) in one sheet. */
function EnterSheet({ card, t, list, valueFor, onSave, onClose }: {
  card: Card; t: Timeline; list: Measurable[]; valueFor: (m: Measurable, p: string) => MValue | undefined;
  onSave: (m: Measurable, p: string, t: string) => Promise<void>; onClose: () => void;
}) {
  const [which, setWhich] = useState<0 | 1>(0);
  return (
    <Sheet title="Enter Numbers" onClose={onClose}>
      <div className="stack">
        <div className="seg seg-text" role="group" aria-label="Which period" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={which === 0 ? "on" : ""} onClick={() => setWhich(0)}>{t.sched ? "Last meeting" : "Last period"}</button>
          <button type="button" className={which === 1 ? "on" : ""} onClick={() => setWhich(1)}>{t.sched ? t.pair("week").curName : "This period"}</button>
        </div>
        <ul className="list enter-list">
          {list.map((m) => {
            const per = periodOf(m, card);
            const pr = t.pair(per);
            const p = which === 0 ? pr.prev : pr.cur;
            const v = valueFor(m, p);
            const ok = statusOf(v);
            return (
              <li key={`${m.id}-${p}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{m.title}</div>
                  <div className="small muted">{per === "week" ? (t.sched ? `Meeting ${t.label(per, p)}` : `Week of ${t.label(per, p)}`) : t.label(per, p)} · goal {goalText(m)}</div>
                </div>
                <input className={`input enter-input${ok === true ? " sc-on" : ok === false ? " sc-off" : ""}`} inputMode="decimal" aria-label={`${m.title}, ${t.label(per, p)}`}
                  defaultValue={v?.value?.toString() ?? ""} onBlur={(e) => onSave(m, p, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}

type NumberFold = "all" | "history";

/** One Key Number: summary, its trend, quick entry, then every number and the change history folded away. */
export function KeyNumberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, company } = useMe();
  const { byId, members } = useMembers();
  const { card, measurables, valueFor, save, load, error, setError, t } = useKeyNumbers();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<NumberFold | null>(null);
  const [msg, setMsg] = useState("");
  if (card === undefined) return <p className="muted">Loading…</p>;
  const m = measurables.find((x) => x.id === id);
  if (!card || !m) return measurables.length || card === null ? <p className="error">That number wasn't found.</p> : <p className="muted">Loading…</p>;

  const per = periodOf(m, card);
  const periods = t.periods(per, TREND[per]);
  const last = latest(m, card, t, valueFor);
  const ok = statusOf(last?.v);
  const owner = byId(m.owner_member_id);
  const pr = t.pair(per);
  const toggle = (f: NumberFold) => setOpen(open === f ? null : f);

  const move = async (by: number) => {
    const i = measurables.findIndex((x) => x.id === m.id);
    if (!measurables[i + by]) return;
    const order = [...measurables]; [order[i], order[i + by]] = [order[i + by], order[i]];
    await Promise.all(order.map((x, n) => x.sort_order === n ? null : supabase.from("ss_measurables").update({ sort_order: n }).eq("id", x.id)));
    load();
  };
  const toBin = async () => {
    if (!confirm("Move this number to the recycle bin? Its history is kept.")) return;
    const { error } = await supabase.from("ss_measurables").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (error) setError(friendlyError(error)); else navigate("/key-numbers");
  };
  const toIssues = async () => {
    const { error } = await supabase.from("ss_issues").insert({ company_id: company.id, owner_member_id: m.owner_member_id, title: m.title,
      source_type: "measurable", source_id: m.id, created_by: me.id });
    if (error) setError(friendlyError(error)); else setMsg("Added to Issues.");
  };
  const entry = (p: string, label: string) => {
    const v = valueFor(m, p);
    const s = statusOf(v);
    return (
      <label className="field" style={{ flex: 1, minWidth: 0 }}><span className="small">{label} <span className="muted">· {t.label(per, p)}</span></span>
        <input key={`${p}-${v?.value ?? ""}`} className={`input${s === true ? " sc-on" : s === false ? " sc-off" : ""}`} inputMode="decimal"
          defaultValue={v?.value?.toString() ?? ""} onBlur={(e) => save(m, p, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </label>
    );
  };
  const word = per === "week" ? (t.sched ? "meeting" : "week") : per;

  return (
    <div className="stack goal-page" style={{ maxWidth: 760 }}>
      <div className="row">
        <Link to="/key-numbers" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Key Numbers</Link>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>
        <Menu items={[
          { label: "Drop into Issues", icon: <CircleAlert size={16} />, onSelect: toIssues },
          { label: "Move up the list", icon: <ArrowUp size={16} />, onSelect: () => move(-1), hidden: measurables[0]?.id === m.id },
          { label: "Move down the list", icon: <ArrowDown size={16} />, onSelect: () => move(1), hidden: measurables.at(-1)?.id === m.id },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{m.title}</h1>
          <span className={`badge badge-lg ${ok === true ? "badge-green" : ok === false ? "badge-danger" : ""}`} style={{ cursor: "default" }}>
            {ok === true ? "On track" : ok === false ? "Off track" : "No number yet"}</span>
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "No owner"}</span>
          <span>{PERIOD_LABEL[per]}</span>
          <span>Goal {goalText(m)}</span>
        </div>
        {last && <p className="goal-finish"><span className="muted">Latest</span> <strong>{fmtValue(last.v.value, m.unit, m.decimals)}</strong> <span className="muted">· {t.label(per, last.p)}</span></p>}
        {m.description && <p className="goal-desc">{m.description}</p>}
      </div>
      {(error || msg) && <p className={error ? "error" : "notice"}>{error || msg}</p>}

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="steps-head">Trend<span className="count">last {periods.length} {word}s</span></h2>
        <div className="card card-pad"><Trend m={m} t={t} per={per} periods={periods} valueFor={valueFor} /></div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="steps-head">Enter</h2>
        <div className="card card-pad row" style={{ alignItems: "flex-end" }}>
          {entry(pr.prev, pr.prevName)}
          {entry(pr.cur, pr.curName)}
        </div>
      </section>

      <div className="card folds">
        <Fold title={`Every ${word}`} count={periods.filter((p) => valueFor(m, p)).length} open={open === "all"} onToggle={() => toggle("all")}>
          <ul className="list enter-list">
            {[...periods].reverse().map((p) => {
              const v = valueFor(m, p);
              const s = statusOf(v);
              return (
                <li key={p}>
                  <span style={{ flex: 1 }}>{t.label(per, p)}{v && v.goal_value !== null && v.goal_value !== m.goal_value ? <span className="small muted"> · goal then {fmtValue(v.goal_value, m.unit, m.decimals)}</span> : null}</span>
                  <input key={`${p}-${v?.value ?? ""}`} className={`input enter-input${s === true ? " sc-on" : s === false ? " sc-off" : ""}`} inputMode="decimal"
                    aria-label={t.label(per, p)} defaultValue={v?.value?.toString() ?? ""} onBlur={(e) => save(m, p, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                </li>
              );
            })}
          </ul>
        </Fold>
        <Fold title="History" open={open === "history"} onToggle={() => toggle("history")}>
          <History table="ss_measurables" rowId={m.id} childKey="measurable_id" members={members} />
          {(m as Measurable & { created_at?: string }).created_at && <p className="small muted">Added {fmtDateTime((m as Measurable & { created_at: string }).created_at)}.</p>}
        </Fold>
      </div>

      {editing && <MeasurableSheet m={m} card={card} all={measurables} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

/** Bars for each period, green on track and red off, with the goal as a dashed line. */
function Trend({ m, t, per, periods, valueFor }: { m: Measurable; t: Timeline; per: Period; periods: string[]; valueFor: (m: Measurable, p: string) => MValue | undefined }) {
  const vals = periods.map((p) => valueFor(m, p));
  const nums = vals.map((v) => v?.value).filter((x): x is number => x !== null && x !== undefined);
  const goals = [m.goal_value, m.comparison === "between" ? m.goal_value_upper : null].filter((x): x is number => x !== null);
  const max = Math.max(...nums.map(Math.abs), ...goals.map(Math.abs), 1) * 1.1;
  const lastIdx = vals.map((v) => v?.value != null).lastIndexOf(true);
  if (!nums.length) return <p className="small muted" style={{ margin: 0 }}>No numbers yet. Enter one below and the trend builds from there.</p>;
  return (
    <figure className="trend" aria-label={`${m.title}, last ${periods.length} periods`}>
      <div className="trend-plot">
        {goals.map((g, i) => <span key={i} className="trend-goal" style={{ bottom: `${(Math.abs(g) / max) * 100}%` }}><span>Goal {fmtValue(g, m.unit, m.decimals)}</span></span>)}
        {vals.map((v, i) => {
          const s = statusOf(v);
          const has = v?.value != null;
          return (
            <span key={periods[i]} className="trend-col" title={`${t.label(per, periods[i])}: ${has ? fmtValue(v!.value, m.unit, m.decimals) : "no number"}${s === true ? " (on track)" : s === false ? " (off track)" : ""}`}>
              {i === lastIdx && <span className="trend-val">{fmtValue(v!.value, m.unit, m.decimals)}</span>}
              <span className={`trend-bar${s === true ? " sc-on-bar" : s === false ? " sc-off-bar" : ""}${has ? "" : " trend-empty"}`}
                style={{ height: has ? `${Math.max(2, (Math.abs(v!.value!) / max) * 100)}%` : 2 }} />
            </span>
          );
        })}
      </div>
      <div className="trend-axis"><span>{t.label(per, periods[0])}</span><span>{t.label(per, periods.at(-1)!)}</span></div>
      <figcaption className="trend-key small muted"><span className="key-dot sc-on-bar" />On track <span className="key-dot sc-off-bar" />Off track <span className="key-line" />Goal</figcaption>
    </figure>
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

function Grid({ card, t, period, periods, list, loaded, valueFor, byId, onSave, onOpen }: {
  card: Card; t: Timeline; period: Period; periods: string[]; list: Measurable[]; loaded: number;
  valueFor: (m: Measurable, p: string) => MValue | undefined; byId: ReturnType<typeof useMembers>["byId"];
  onSave: (m: Measurable, p: string, t: string) => void; onOpen: (m: Measurable) => void;
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
            <th className="sc-title">Number · goal</th>
            {periods.map((p) => <th key={p} className="sc-head">{t.label(period, p)}</th>)}
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
                      <button className="link-btn sc-name" onClick={() => onOpen(m)}>{m.title}</button>
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

// ─── Editing ────────────────────────────────────────────────────────────────

function MeasurableSheet({ m, card, all, onClose, onSaved }: { m: Measurable | null; card: Card; all: Measurable[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, company } = useMe();
  const { active } = useMembers();
  const [form, setForm] = useState({
    title: m?.title ?? "", description: m?.description ?? "", owner_member_id: m?.owner_member_id ?? me.id,
    unit: m?.unit ?? ("number" as Unit), comparison: m?.comparison ?? ("gte" as Comparison),
    goal_value: m?.goal_value?.toString() ?? "", goal_value_upper: m?.goal_value_upper?.toString() ?? "",
    decimals: m?.decimals ?? 0, period_override: m?.period_override ?? ("" as Period | ""), is_additive: m?.is_additive ?? true,
  });
  const [error, setError] = useState("");

  const run = async (p: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await p;
    if (error) setError(friendlyError(error)); else onSaved(m?.id ?? (data as { id: string }).id);
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
          sort_order: all.reduce((n, x) => Math.max(n, x.sort_order), 0) + 1 }).select("id").single());
  };
  return (
    <Sheet title={m ? "Edit Number" : "New Number"} onClose={onClose}>
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
        <button className="btn btn-primary">{m ? "Save" : "Add Number"}</button>
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
    <Sheet title="Key Numbers Settings" onClose={onClose}>
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
