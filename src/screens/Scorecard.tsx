import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, CalendarClock, ChevronLeft, CircleAlert, Download, Eye, EyeOff, Grid3x3, List, Pencil, Plus, Printer, Replace, Settings, SquarePen, Trash2 } from "lucide-react";
import { printPage } from "../lib/print";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { addDays, fmtDateTime, fmtDay, today, useMembers, useOpenParam } from "../lib/data";
import { downloadCsv } from "../lib/csv";
import {
  COMPARISON_LABEL, PERIOD_LABEL, UNIT_LABEL, fmtValue, goalText, lifeIn, onListAt, onTrack, parseNumber, periodEnd, recentPeriods, retireStamp, retiredOn,
  scheduleOf, shiftPeriod, timeline, upcomingMeeting,
  type Comparison, type MValue, type Timeline, type Measurable, type Period, type Scorecard as Card, type Unit,
} from "../lib/scorecard";
import { Avatar, Empty, Fold, Menu, OwnerSelect, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { History } from "../components/History";
import { MineToggle, useFilters } from "../components/Filters";
import { w } from "../lib/terms";
import { DragHandle, moved, saveSortOrder, useDragSort } from "../components/DragSort";

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

/** Key Numbers, their numbers and how to save one; shared by the list and each number's page. `asOf` looks back to a past day. */
function useKeyNumbers(asOf: string | null = null) {
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
    const day = asOf ?? today();
    setT(timeline(scheduleOf(mt as { first_meeting_at: string | null; cadence: string } | null), day));
    // Retired numbers too: they keep their history and show when looking back.
    const { data: ms } = await supabase.from("ss_measurables").select("*").eq("scorecard_id", sc.id)
      .is("deleted_at", null).order("sort_order").order("title");
    const list = (ms ?? []) as Measurable[];
    setMeasurables(list);
    if (!list.length) { setValues([]); return; }
    const starts = [recentPeriods("week", Math.max(sc.periods_to_show, TREND.week) + 1, day)[0], recentPeriods("month", TREND.month, day)[0],
      recentPeriods("quarter", TREND.quarter, day)[0], recentPeriods("year", TREND.year, day)[0]];
    const earliest = starts.sort()[0];
    const { data: vs } = await supabase.from("ss_measurable_values").select("id, measurable_id, period_start, value, goal_value, goal_value_upper, comparison, note")
      .in("measurable_id", list.map((m) => m.id)).gte("period_start", earliest);
    setValues((vs ?? []) as MValue[]);
  }, [asOf]);
  useEffect(() => { load(); }, [load]);

  const valueFor = useCallback((m: Measurable, p: string) => values.find((v) => v.measurable_id === m.id && v.period_start === p), [values]);

  /** Save one number: blank removes it, otherwise insert or update it. */
  const save = async (m: Measurable, period: string, text: string) => {
    const n = parseNumber(text);
    const existing = valueFor(m, period);
    if (Number.isNaN(n)) { setError(`"${text}" isn't a number.`); return; }
    const r = retiredOn(m);
    if (r && r <= period) { setError(`${m.title} was retired on ${fmtDay(r, true)}; bring it back to add numbers after that.`); return; }
    setError("");
    if (n !== null && period < m.active_from) {
      const { error } = await supabase.from("ss_measurables").update({ active_from: period }).eq("id", m.id);
      if (error) { setError(friendlyError(error)); return; }
    }
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
  /** Put the numbers in a new order (all of them), show it at once, then save it. */
  const reorder = async (ordered: Measurable[]) => {
    setMeasurables(ordered);
    const error = await saveSortOrder("ss_measurables", ordered);
    if (error) setError(friendlyError(error));
    load();
  };
  return { card, measurables, values, valueFor, save, load, error, setError, t, reorder };
}

export function Scorecard() {
  const { me } = useMe();
  const { byId } = useMembers();
  const navigate = useNavigate();
  const wide = useWide();
  // Looking back: the list as it was on a past day, with columns ending there.
  const [asOf, setAsOf] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { card, measurables, values, valueFor, save, load, error, t, reorder } = useKeyNumbers(asOf);
  // Dragging within one group (Weekly, Monthly…) slots that group's new order back into the whole list.
  const reorderIn = (group: Measurable[], from: number, to: number) => {
    const next = moved(group, from, to);
    const ids = new Set(group.map((m) => m.id));
    let k = 0;
    reorder(measurables.map((m) => (ids.has(m.id) ? next[k++] : m)));
  };
  const filters = useFilters("keynumbers", { owner: "all" });
  const [editing, setEditing] = useState<"new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [entering, setEntering] = useState(false);
  // Which printout is being made: the filled-in table, or a blank sheet to fill in by hand.
  const [printMode, setPrintMode] = useState<"filled" | "blank" | null>(null);
  useEffect(() => {
    const done = () => setPrintMode(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  const [view, setViewState] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("ss.keyNumbersView") as "list" | "grid") || (wide ? "grid" : "list"); } catch { return "list"; }
  });
  const setView = (v: "list" | "grid") => { setViewState(v); try { localStorage.setItem("ss.keyNumbersView", v); } catch { /* private mode */ } };
  useOpenParam(measurables.length ? measurables : null, "ss_measurables", (m) => navigate(`/key-numbers/${m.id}`));

  if (card === undefined) return <p className="muted">Loading…</p>;
  if (card === null) return <Empty>There are no {w("Key Number")}s yet. They're set up with the first meeting.</Empty>;

  const day = asOf ?? today();
  // On the list on that day; retired ones too when asked for (those that had started by then).
  const shown = measurables.filter((m) => onListAt(m, day) || (showRetired && !!retiredOn(m) && m.active_from <= day));
  const retiredCount = measurables.filter((m) => retiredOn(m) && !onListAt(m, day) && m.active_from <= day).length;
  const mine = shown.filter((m) => filters.values.owner !== "me" || m.owner_member_id === me.id);
  const current = mine.filter((m) => onListAt(m, today()));
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
  const missing = asOf ? [] : current.filter((m) => {
    const per = periodOf(m, card);
    if (per === "week" && t.sched) return soon && !valueFor(m, nextWeek.cur);
    return !valueFor(m, t.pair(per).prev);
  });
  const missingText = missing.every((m) => periodOf(m, card) === "week") && t.sched ? `for the ${t.label("week", nextWeek.cur)} meeting`
    : missing.every((m) => periodOf(m, card) === "week") ? "for last week" : "";

  const row = (m: Measurable, drag?: ReturnType<typeof useDragSort>, i = 0) => {
    const last = latest(m, card, t, valueFor);
    const ok = statusOf(last?.v);
    const per = periodOf(m, card);
    const spark = t.periods(per, 8).map((p) => valueFor(m, p));
    const max = Math.max(...spark.map((v) => Math.abs(v?.value ?? 0)), Math.abs(m.goal_value ?? 0), 1);
    return (
      <li key={m.id} {...drag?.itemProps(i)} className={`clickable ${drag?.itemProps(i).className ?? ""}`} onClick={() => navigate(`/key-numbers/${m.id}`)}>
        {drag && <DragHandle {...drag.handleProps(i, m.title)} className="edit-only" />}
        <Avatar m={byId(m.owner_member_id)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title">{m.title}{retiredOn(m) && <span className="badge kn-retired">Retired {fmtDay(retiredOn(m)!, true)}</span>}</div>
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
        <h1>{w(card.title)}</h1>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm desktop-only" onClick={() => setEditing("new")}><Plus size={16} />New {w("Key Number")}</button>
      </div>
      <p className="small muted page-sub no-print">{w("Key Number")}s that act as leading indicators for us to determine whether we are on track to accomplish goals and solve problems. These are dynamic and can cover different timeframes or be added or removed over time.</p>
      <h2 className="print-only">{w(card.title)}</h2>
      <div className="toolbar no-print">
        <span className="seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} aria-label="List" title="List" onClick={() => setView("list")}><List size={18} /></button>
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} aria-label="Grid" title="Grid" onClick={() => setView("grid")}><Grid3x3 size={18} /></button>
        </span>
        <span className="spacer" />
        <MineToggle value={filters.values.owner} onChange={(v) => filters.set("owner", v)} />
        <Menu items={[
          { label: "Enter Numbers", icon: <SquarePen size={16} />, onSelect: () => setEntering(true), hidden: !current.length || !!asOf },
          { label: "Look back to a date", icon: <CalendarClock size={16} />, onSelect: () => setAsOf(addDays(today(), -28)), hidden: !!asOf },
          { label: showRetired ? "Hide retired" : `Show retired${retiredCount ? ` (${retiredCount})` : ""}`, icon: showRetired ? <EyeOff size={16} /> : <Eye size={16} />, onSelect: () => setShowRetired(!showRetired) },
          { label: "Settings", icon: <Settings size={16} />, onSelect: () => setSettings(true) },
          { label: "Print table", icon: <Printer size={16} />, onSelect: () => { flushSync(() => setPrintMode("filled")); printPage(w(card.title)); } },
          { label: "Print blank sheet", icon: <Printer size={16} />, onSelect: () => { flushSync(() => setPrintMode("blank")); printPage(`${w(card.title)} blank sheet`); } },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: () => setExporting(true) },
        ]} />
      </div>
      {asOf && (
        <div className="close-banner kn-asof">
          <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <CalendarClock size={16} />Showing the list as it was on
            <input className="input input-sm no-print" type="date" value={asOf} max={today()} aria-label="Look back to"
              onChange={(e) => setAsOf(e.target.value && e.target.value < today() ? e.target.value : null)} />
            <span className="print-only">{fmtDay(asOf, true)}</span>
          </span>
          <button type="button" className="link-btn no-print" onClick={() => setAsOf(null)}>Back to today</button>
        </div>
      )}
      {missing.length > 0 && (
        <div className="close-banner no-print">
          <span>{missing.length} number{missing.length === 1 ? "" : "s"} still to enter{missingText ? ` ${missingText}` : ""}</span>
          <button type="button" className="link-btn" onClick={() => setEntering(true)}>Enter</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {measurables.length === 0 && <Empty>No {w("Key Number")}s yet. Add the handful of numbers that tell you the business is on track.</Empty>}
      {measurables.length > 0 && shown.length === 0 && <Empty>No {w("Key Number")}s were on the list on {fmtDay(day, true)}.</Empty>}
      {shown.length > 0 && mine.length === 0 && <Empty>None of the {w("Key Number")}s are yours.</Empty>}

      {printMode && <PrintSheet mode={printMode} card={card} t={t} sections={sections} valueFor={valueFor} byId={byId} />}
      <div className={`stack${printMode ? " no-print" : ""}`}>
      {sections.map((s) => (
        <Section key={s.period} title={PERIOD_LABEL[s.period]} count={s.list.length}>
          {view === "grid"
            ? <Grid card={card} t={t} period={s.period} periods={s.periods} list={s.list} loaded={values.length} valueFor={valueFor} byId={byId} onSave={save} onOpen={(m) => navigate(`/key-numbers/${m.id}`)}
                onReorder={asOf ? undefined : (from, to) => reorderIn(s.list, from, to)} />
            : <RowList list={s.list} row={row} onReorder={asOf ? undefined : (from, to) => reorderIn(s.list, from, to)} />}
        </Section>
      ))}
      </div>
      {view === "grid" && mine.length > 0 && <p className="small muted no-print">Tap a cell to type a number; press Enter or Tab to save. Clear it to remove the number.</p>}
      <div className="fab-space" aria-hidden />
      <button type="button" className="fab no-print" onClick={() => setEditing("new")} aria-label={`New ${w("Key Number")}`}><Plus size={20} />New {w("Key Number")}</button>

      {editing && <MeasurableSheet m={null} card={card} all={measurables} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); navigate(`/key-numbers/${id}`); }} />}
      {settings && <SettingsSheet card={card} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); load(); }} />}
      {entering && <EnterSheet card={card} t={t} list={current} valueFor={valueFor} onSave={save} onClose={() => setEntering(false)} />}
      {exporting && <ExportSheet card={card} measurables={measurables} byId={byId} onClose={() => setExporting(false)} />}
    </div>
  );
}

const BLANK_COLS: Record<Period, number> = { week: 8, month: 6, quarter: 4, year: 3 };
/** Short amounts for the printed table's narrow columns ($170.2k, $1.2M); other units as usual. */
const fmtShort = (v: number | null | undefined, m: Measurable) => {
  if (v === null || v === undefined || m.unit !== "dollar" || Math.abs(v) < 10000) return fmtValue(v, m.unit, m.decimals);
  const abs = Math.abs(v), sign = v < 0 ? "-" : "";
  return abs >= 1e6 ? `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
};

/**
 * What prints: the numbers as a table (recent columns filled in, coloured on and off track), or a blank
 * sheet with the same rows and empty boxes for the coming meetings (or months, quarters, years).
 */
function PrintSheet({ mode, card, t, sections, valueFor, byId }: {
  mode: "filled" | "blank"; card: Card; t: Timeline; sections: { period: Period; list: Measurable[]; periods: string[] }[];
  valueFor: (m: Measurable, p: string) => MValue | undefined; byId: ReturnType<typeof useMembers>["byId"];
}) {
  const upcoming = (per: Period) => {
    const first = t.pair(per).cur;
    const step = per === "week" ? (t.sched?.step ?? 7) : 0;
    return Array.from({ length: BLANK_COLS[per] }, (_, i) => (per === "week" ? addDays(first, step * i) : shiftPeriod(per, first, i)));
  };
  return (
    <div className="print-block kn-print">
      <p className="print-filters" style={{ display: "block" }}>{mode === "blank"
        ? "Blank sheet: write each number in the box for its meeting (or month). Goals shown for reference."
        : `Recent numbers; green is on track, red is off track.`}</p>
      {sections.map((s) => {
        const cols = mode === "blank" ? upcoming(s.period) : [...s.periods].sort().slice(-BLANK_COLS[s.period]);
        return (
          <section key={s.period} className="kn-print-section">
            <h3 className="label section-label">{PERIOD_LABEL[s.period]}{s.period === "week" && t.sched ? " · by meeting date" : ""}</h3>
            <table className={`kn-table${mode === "blank" ? " kn-blank" : ""}`}>
              <thead><tr>
                <th className="kn-name">{w("Key Number")}</th><th className="kn-owner">Owner</th><th className="kn-goal">Goal</th>
                {cols.map((c) => <th key={c}>{t.label(s.period, c)}</th>)}
              </tr></thead>
              <tbody>
                {s.list.filter((m) => mode === "filled" || !retiredOn(m)).map((m) => (
                  <tr key={m.id}>
                    <td className="kn-name">{m.title}{retiredOn(m) ? ` (retired ${fmtDay(retiredOn(m)!, true)})` : ""}</td>
                    <td className="kn-owner">{byId(m.owner_member_id)?.first_name ?? ""}</td>
                    <td className="kn-goal">{goalText(m)}</td>
                    {cols.map((c) => {
                      if (mode === "blank") return <td key={c} className="kn-cell" />;
                      if (lifeIn(m, s.period, c) === "retired") return <td key={c} className="kn-cell">—</td>;
                      const v = valueFor(m, c);
                      const ok = statusOf(v);
                      return <td key={c} className={`kn-cell${ok === true ? " kn-on" : ok === false ? " kn-off" : ""}`}>{fmtShort(v?.value, m)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {mode === "blank" && <div className="kn-notes"><span>Notes</span></div>}
      <p className="small" style={{ display: "none" }}>{card.title}</p>
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

/** Export any date range as a spreadsheet, including numbers since retired, each judged against the goal it had then. */
function ExportSheet({ card, measurables, byId, onClose }: {
  card: Card; measurables: Measurable[]; byId: ReturnType<typeof useMembers>["byId"]; onClose: () => void;
}) {
  const [from, setFrom] = useState(addDays(today(), -91));
  const [to, setTo] = useState(today());
  const [withRetired, setWithRetired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleOf = (id: string | null) => measurables.find((x) => x.id === id)?.title ?? "another number";
  const run = async () => {
    if (from > to) { setError("The start date is after the end date."); return; }
    setBusy(true); setError("");
    // Numbers on the list at some point in the range.
    const list = measurables.filter((m) => (withRetired || !retiredOn(m)) && m.active_from <= to && (!retiredOn(m) || retiredOn(m)! > from));
    const { data, error } = list.length
      ? await supabase.from("ss_measurable_values").select("measurable_id, period_start, value, goal_value, goal_value_upper, comparison, note")
        .in("measurable_id", list.map((m) => m.id)).lte("period_start", to).gte("period_start", addDays(from, -366)).order("period_start")
      : { data: [], error: null };
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    const rows: (string | number | null)[][] = [];
    for (const v of (data ?? []) as MValue[]) {
      const m = list.find((x) => x.id === v.measurable_id)!;
      const per = periodOf(m, card);
      if (v.value === null || periodEnd(per, v.period_start) < from) continue;
      const o = byId(m.owner_member_id);
      // In words, so spreadsheets don't read "= 0" as a formula.
      const f = (x: number | null) => fmtValue(x, m.unit, m.decimals);
      const cmp = v.comparison ?? m.comparison;
      const goalThen = v.goal_value === null ? "No goal" : cmp === "between" ? `${f(v.goal_value)} to ${f(v.goal_value_upper ?? v.goal_value)}`
        : `${{ gte: "At least", lte: "At most", eq: "Exactly" }[cmp]} ${f(v.goal_value)}`;
      const ok = statusOf(v);
      const r = retiredOn(m);
      rows.push([m.title, o ? fullName(o) : "", PERIOD_LABEL[per], v.period_start, v.value, goalThen, ok === null ? "" : ok ? "on" : "off",
        v.note ?? "", r ? (m.replaced_by_id ? `Replaced by ${titleOf(m.replaced_by_id)} on ${r}` : `Retired ${r}`) : "On the list"]);
    }
    if (!rows.length) { setError("No numbers were entered in that range."); return; }
    downloadCsv(`key-numbers-${from}-to-${to}`, ["Number", "Owner", "Period", "Period start", "Value", "Goal then", "On track", "Note", "Status"], rows);
    onClose();
  };
  return (
    <Sheet title="Export CSV" onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>From</span><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={withRetired} onChange={(e) => setWithRetired(e.target.checked)} />Include retired {w("Key Number")}s
        </label>
        <p className="small muted">Every number entered in the range, with the goal it had at the time and whether it was on track.</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={run}><Download size={16} />{busy ? "Getting numbers…" : "Download"}</button>
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
  const [retiring, setRetiring] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [open, setOpen] = useState<NumberFold | null>(null);
  const [msg, setMsg] = useState("");
  if (card === undefined) return <p className="muted">Loading…</p>;
  const m = measurables.find((x) => x.id === id);
  if (!card || !m) return measurables.length || card === null ? <p className="error">That {w("Key Number")} wasn't found.</p> : <p className="muted">Loading…</p>;

  const per = periodOf(m, card);
  const periods = t.periods(per, TREND[per]);
  const retired = retiredOn(m);
  const before = measurables.find((x) => x.replaced_by_id === m.id);
  const after = measurables.find((x) => x.id === m.replaced_by_id);
  // The trend carries on from the number this one replaced (and so on back), for periods before it started.
  const chain = (p: string) => {
    let cur: Measurable = m;
    while (periodEnd(per, p) < cur.active_from) {
      const prev = measurables.find((x) => x.replaced_by_id === cur.id);
      if (!prev || periodOf(prev, card) !== per) break;
      cur = prev;
    }
    return { v: valueFor(cur, p), from: cur.id === m.id ? null : cur };
  };
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
    if (!confirm(`Move this ${w("Key Number")} to the recycle bin? Its history is kept.`)) return;
    const { error } = await supabase.from("ss_measurables").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (error) setError(friendlyError(error)); else navigate("/key-numbers");
  };
  const bringBack = async () => {
    const { error } = await supabase.from("ss_measurables").update({ archived_at: null }).eq("id", m.id);
    if (error) setError(friendlyError(error)); else { setMsg(`Back on the list.`); load(); }
  };
  const toIssues = async () => {
    const { error } = await supabase.from("ss_issues").insert({ company_id: company.id, owner_member_id: m.owner_member_id, title: m.title,
      source_type: "measurable", source_id: m.id, created_by: me.id });
    if (error) setError(friendlyError(error)); else setMsg("Added to Issues.");
  };
  const entry = (p: string, label: string) => {
    const v = valueFor(m, p);
    const s = statusOf(v);
    if (lifeIn(m, per, p) === "retired") return (
      <div className="field" style={{ flex: 1, minWidth: 0 }}><span className="small">{label} <span className="muted">· {t.label(per, p)}</span></span>
        <span className="input kn-locked">Retired</span></div>
    );
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
        <Link to="/key-numbers" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />{w("Key Numbers")}</Link>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost edit-only" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>
        <Menu items={[
          { label: "Drop into Issues", icon: <CircleAlert size={16} />, onSelect: toIssues },
          { label: "Move up the list", icon: <ArrowUp size={16} />, onSelect: () => move(-1), hidden: measurables[0]?.id === m.id },
          { label: "Move down the list", icon: <ArrowDown size={16} />, onSelect: () => move(1), hidden: measurables.at(-1)?.id === m.id },
          { label: "Retire", icon: <Archive size={16} />, onSelect: () => setRetiring(true), hidden: !!retired },
          { label: "Bring back", icon: <ArchiveRestore size={16} />, onSelect: bringBack, hidden: !retired || !!m.replaced_by_id },
          { label: "Replace with a new one", icon: <Replace size={16} />, onSelect: () => setReplacing(true), hidden: !!m.replaced_by_id },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: toBin, danger: true },
        ]} />
      </div>

      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{m.title}</h1>
          {retired ? <span className="badge badge-lg kn-retired" style={{ cursor: "default" }}>Retired {fmtDay(retired, true)}</span>
            : <span className={`badge badge-lg ${ok === true ? "badge-green" : ok === false ? "badge-danger" : ""}`} style={{ cursor: "default" }}>
              {ok === true ? "On track" : ok === false ? "Off track" : "No number yet"}</span>}
        </div>
        <div className="goal-meta">
          <span>{owner ? fullName(owner) : "No owner"}</span>
          <span>{PERIOD_LABEL[per]}</span>
          <span>Goal {goalText(m)}</span>
          <span>On the list from {fmtDay(m.active_from, true)}{retired ? ` to ${fmtDay(addDays(retired, -1), true)}` : ""}</span>
        </div>
        {(before || after) && <p className="small kn-links">
          {before && <span>Replaces <Link to={`/key-numbers/${before.id}`}>{before.title}</Link></span>}
          {after && <span>Replaced by <Link to={`/key-numbers/${after.id}`}>{after.title}</Link> on {fmtDay(retired ?? after.active_from, true)}</span>}
        </p>}
        {last && <p className="goal-finish"><span className="muted">Latest</span> <strong>{fmtValue(last.v.value, m.unit, m.decimals)}</strong> <span className="muted">· {t.label(per, last.p)}</span></p>}
        {m.description && <p className="goal-desc">{m.description}</p>}
      </div>
      {(error || msg) && <p className={error ? "error" : "notice"}>{error || msg}</p>}

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="steps-head">Trend<span className="count">last {periods.length} {word}s</span></h2>
        <div className="card card-pad"><Trend m={m} t={t} per={per} periods={periods} valueFor={(_, p) => chain(p).v} earlier={(p) => chain(p).from} /></div>
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
              if (lifeIn(m, per, p) === "retired") return <li key={p}><span style={{ flex: 1 }}>{t.label(per, p)}</span><span className="small muted">Retired</span></li>;
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
      {replacing && <MeasurableSheet m={null} replacing={m} card={card} all={measurables} onClose={() => setReplacing(false)}
        onSaved={(newId) => { setReplacing(false); navigate(`/key-numbers/${newId}`); }} />}
      {retiring && <RetireSheet m={m} onClose={() => setRetiring(false)} onSaved={() => { setRetiring(false); setMsg("Retired. Its numbers stay in the history and exports."); load(); }} />}
    </div>
  );
}

/** Retire: off the list from a day on; every number entered before then stays. */
function RetireSheet({ m, onClose, onSaved }: { m: Measurable; onClose: () => void; onSaved: () => void }) {
  const [day, setDay] = useState(today() < m.active_from ? m.active_from : today());
  const [error, setError] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (day < m.active_from) { setError(`It can't retire before it was added (${fmtDay(m.active_from, true)}).`); return; }
    const { error } = await supabase.from("ss_measurables").update({ archived_at: retireStamp(day) }).eq("id", m.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };
  return (
    <Sheet title={`Retire ${m.title}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Off the list from</span>
          <input className="input" type="date" value={day} min={m.active_from} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <p className="small muted">It leaves the list for periods starting on or after this day. Every number entered before then stays, in its history, in exports, in Insights and when looking back. You can bring it back later.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary"><Archive size={16} />Retire</button>
      </form>
    </Sheet>
  );
}

/** Bars for each period, green on track and red off, with the goal as a dashed line. */
function Trend({ m, t, per, periods, valueFor, earlier }: {
  m: Measurable; t: Timeline; per: Period; periods: string[]; valueFor: (m: Measurable, p: string) => MValue | undefined;
  earlier?: (p: string) => Measurable | null;
}) {
  const prevNames = [...new Set(periods.map((p) => earlier?.(p)).filter((x): x is Measurable => !!x && periods.some((q) => earlier?.(q) === x && valueFor(m, q))).map((x) => x.title))];
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
            <span key={periods[i]} className={`trend-col${earlier?.(periods[i]) ? " trend-earlier" : ""}`}
              title={`${earlier?.(periods[i]) ? `${earlier(periods[i])!.title}, ` : ""}${t.label(per, periods[i])}: ${has ? fmtValue(v!.value, m.unit, m.decimals) : "no number"}${s === true ? " (on track)" : s === false ? " (off track)" : ""}`}>
              {i === lastIdx && <span className="trend-val">{fmtValue(v!.value, m.unit, m.decimals)}</span>}
              <span className={`trend-bar${s === true ? " sc-on-bar" : s === false ? " sc-off-bar" : ""}${has ? "" : " trend-empty"}`}
                style={{ height: has ? `${Math.max(2, (Math.abs(v!.value!) / max) * 100)}%` : 2 }} />
            </span>
          );
        })}
      </div>
      <div className="trend-axis"><span>{t.label(per, periods[0])}</span><span>{t.label(per, periods.at(-1)!)}</span></div>
      <figcaption className="trend-key small muted"><span className="key-dot sc-on-bar" />On track <span className="key-dot sc-off-bar" />Off track <span className="key-line" />Goal{prevNames.length > 0 && <> <span className="key-dot trend-earlier-dot" />Before it replaced {prevNames.join(", ")}</>}</figcaption>
    </figure>
  );
}

// ─── Desktop grid ───────────────────────────────────────────────────────────

function Cell({ m, period, v, life, onSave }: { m: Measurable; period: string; v: MValue | undefined; life: ReturnType<typeof lifeIn>; onSave: (m: Measurable, p: string, t: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (life === "retired") return <td className="sc-cell sc-na" title={`Retired ${fmtDay(retiredOn(m)!, true)}`}>—</td>;
  const ok = onTrack(v?.value ?? null, v?.goal_value ?? null, v?.goal_value_upper ?? null, v?.comparison ?? null);
  const commit = () => { if (edit !== null) onSave(m, period, edit); setEdit(null); };
  return (
    <td className={`sc-cell${ok === true ? " sc-on" : ok === false ? " sc-off" : ""}${life === "before" && !v ? " sc-before" : ""}`}
      title={life === "before" && !v ? `Before it was added (${fmtDay(m.active_from, true)}); fill in to add history` : undefined}
      onClick={() => edit === null && setEdit(v?.value?.toString() ?? "")}>
      {edit !== null ? (
        <input className="sc-input" autoFocus inputMode="decimal" value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); }} aria-label={`${m.title}, ${period}`} />
      ) : fmtValue(v?.value, m.unit, m.decimals)}
    </td>
  );
}

function Grid({ card, t, period, periods, list, loaded, valueFor, byId, onSave, onOpen, onReorder }: {
  card: Card; t: Timeline; period: Period; periods: string[]; list: Measurable[]; loaded: number;
  valueFor: (m: Measurable, p: string) => MValue | undefined; byId: ReturnType<typeof useMembers>["byId"];
  onSave: (m: Measurable, p: string, t: string) => void; onOpen: (m: Measurable) => void; onReorder?: (from: number, to: number) => void;
}) {
  const drag = useDragSort(list.length, (from, to) => onReorder?.(from, to));
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
            <th className="sc-title">{w("Key Number")} · goal</th>
            {periods.map((p) => <th key={p} className="sc-head">{t.label(period, p)}</th>)}
            {card.show_total && <th className="sc-head">Total</th>}
            {card.show_average && <th className="sc-head">Avg</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((m, i) => {
            const nums = periods.filter((p) => lifeIn(m, period, p) !== "retired").map((p) => valueFor(m, p)?.value).filter((x): x is number => x !== null && x !== undefined);
            const total = nums.reduce((a, b) => a + b, 0);
            return (
              <tr key={m.id} {...drag.itemProps(i)}>
                <td className="sc-title">
                  <div className="row" style={{ gap: 8 }}>
                    {onReorder && list.length > 1 && <DragHandle {...drag.handleProps(i, m.title)} className="edit-only" />}
                    <Avatar m={byId(m.owner_member_id)} size={26} />
                    <div style={{ minWidth: 0 }}>
                      <button className="link-btn sc-name" onClick={() => onOpen(m)}>{m.title}</button>
                      <div className="small muted">{goalText(m)}{retiredOn(m) && <span className="badge kn-retired">Retired {fmtDay(retiredOn(m)!, true)}</span>}</div>
                    </div>
                  </div>
                </td>
                {periods.map((p) => <Cell key={p} m={m} period={p} v={valueFor(m, p)} life={lifeIn(m, period, p)} onSave={onSave} />)}
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

function MeasurableSheet({ m, replacing, card, all, onClose, onSaved }: {
  m: Measurable | null; replacing?: Measurable; card: Card; all: Measurable[]; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { me, company } = useMe();
  const { active } = useMembers();
  // Replacing starts from a copy of the old number, to change what it measures.
  const src = m ?? replacing ?? null;
  const [form, setForm] = useState({
    active_from: m?.active_from ?? (replacing && replacing.active_from > today() ? replacing.active_from : today()),
    title: src?.title ?? "", description: src?.description ?? "", owner_member_id: src?.owner_member_id ?? me.id,
    unit: src?.unit ?? ("number" as Unit), comparison: src?.comparison ?? ("gte" as Comparison),
    goal_value: src?.goal_value?.toString() ?? "", goal_value_upper: src?.goal_value_upper?.toString() ?? "",
    decimals: src?.decimals ?? 0, period_override: src?.period_override ?? ("" as Period | ""), is_additive: src?.is_additive ?? true,
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
      is_additive: form.is_additive, active_from: form.active_from,
    };
    if (m) {
      const r = retiredOn(m);
      if (r && form.active_from >= r) { setError(`It has to start before it was retired (${fmtDay(r, true)}).`); return; }
      run(supabase.from("ss_measurables").update(row).eq("id", m.id));
      return;
    }
    if (replacing && form.active_from < replacing.active_from) { setError(`The new one can't start before the old one did (${fmtDay(replacing.active_from, true)}).`); return; }
    (async () => {
      // The new number takes the old one's place in the list.
      const { data, error } = await supabase.from("ss_measurables").insert({ ...row, company_id: company.id, scorecard_id: card.id,
        sort_order: replacing ? replacing.sort_order : all.reduce((n, x) => Math.max(n, x.sort_order), 0) + 1 }).select("id").single();
      if (error || !data) { setError(friendlyError(error)); return; }
      if (replacing) {
        const { error: e2 } = await supabase.from("ss_measurables").update({ archived_at: retireStamp(form.active_from), replaced_by_id: data.id }).eq("id", replacing.id);
        if (e2) { setError(friendlyError(e2)); return; }
      }
      onSaved(data.id);
    })();
  };
  return (
    <Sheet title={replacing ? `Replace ${replacing.title}` : `${m ? "Edit" : "New"} ${w("Key Number")}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {replacing && <p className="small muted">Use this when what's measured changes. The new {w("Key Number")} starts on the day below; {replacing.title} retires that day and keeps its history, and the trend shows them one after the other.</p>}
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
          <label className="field"><span>{replacing ? "Starts" : "On the list from"}</span>
            <input className="input" type="date" required value={form.active_from} min={replacing?.active_from} onChange={(e) => e.target.value && setForm({ ...form, active_from: e.target.value })} />
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
        <button className="btn btn-primary">{m ? "Save" : replacing ? "Replace" : `Add ${w("Key Number")}`}</button>
      </form>
    </Sheet>
  );
}

function SettingsSheet({ card, onClose, onSaved }: { card: Card; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: w(card.title), periods_to_show: card.periods_to_show, newest_first: card.newest_first, show_total: card.show_total, show_average: card.show_average });
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
    <Sheet title={w("Key Numbers Settings")} onClose={onClose}>
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

/** One group of numbers as a list, draggable into a new order. */
function RowList({ list, row, onReorder }: {
  list: Measurable[]; row: (m: Measurable, drag?: ReturnType<typeof useDragSort>, i?: number) => ReactElement; onReorder?: (from: number, to: number) => void;
}) {
  const drag = useDragSort(list.length, (from, to) => onReorder?.(from, to));
  return <ul className="card list">{list.map((m, i) => row(m, onReorder && list.length > 1 ? drag : undefined, i))}</ul>;
}
