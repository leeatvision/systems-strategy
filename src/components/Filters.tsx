import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { Member } from "../lib/supabase";
import { addDays, endOfWeek, quarterEnd, currentQuarter, today } from "../lib/data";

export interface FilterField { key: string; label: string; options: { value: string; label: string }[] }

/** Filter values for one page, remembered on this device. */
export function useFilters<T extends Record<string, string>>(page: string, defaults: T) {
  const storeKey = `ss.filters.${page}`;
  const [values, setValues] = useState<T>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storeKey) ?? "{}") }; } catch { return defaults; }
  });
  const save = (next: T) => { setValues(next); try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* private mode */ } };
  const set = (key: keyof T, value: string) => save({ ...values, [key]: value });
  const reset = () => save(defaults);
  const active = (Object.keys(defaults) as (keyof T)[]).filter((k) => k !== "sort" && values[k] !== defaults[k]).length;
  return { values, set, reset, active };
}

/** Owner choices: everyone, me, then each person. */
export function ownerOptions(members: Member[], meId: string, everyoneLabel = "Everyone") {
  return [
    { value: "all", label: everyoneLabel },
    { value: "me", label: "Me" },
    ...members.filter((m) => m.status === "active" && m.id !== meId).map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}`.trim() })),
    { value: "none", label: "Unassigned" },
  ];
}
export function ownerMatches(filter: string, ownerId: string | null, meId: string) {
  return filter === "all" || (filter === "me" ? ownerId === meId : filter === "none" ? !ownerId : ownerId === filter);
}

export const DATE_OPTIONS = [
  { value: "any", label: "Any date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "next7", label: "Next 7 days" },
  { value: "next30", label: "Next 30 days" },
  { value: "quarter", label: "This quarter" },
  { value: "later", label: "After this quarter" },
  { value: "none", label: "No date" },
];
/** Whether a date (YYYY-MM-DD or timestamp) fits a date filter. "Overdue" needs the item to still be open. */
export function dateMatches(filter: string, date: string | null | undefined, open = true): boolean {
  if (filter === "any") return true;
  if (filter === "none") return !date;
  if (!date) return false;
  const d = date.slice(0, 10), now = today();
  switch (filter) {
    case "overdue": return open && d < now;
    case "today": return d === now;
    case "week": return d >= now && d <= endOfWeek();
    case "next7": return d >= now && d <= addDays(now, 7);
    case "next30": return d >= now && d <= addDays(now, 30);
    case "quarter": return d >= now && d <= quarterEnd(currentQuarter());
    case "later": return d > quarterEnd(currentQuarter());
    default: return true;
  }
}

type BarProps = {
  fields: FilterField[]; values: Record<string, string>; defaults: Record<string, string>; onChange: (key: string, value: string) => void; onReset: () => void;
  active: number; shown?: number; total?: number;
};

function FilterGrid({ fields, values, defaults, onChange }: Pick<BarProps, "fields" | "values" | "defaults" | "onChange">) {
  return (
    <div className="filter-grid">
      {fields.map((f) => (
        <label key={f.key} className="filter-field">
          <span>{f.label}</span>
          <select className={`select filter-select${values[f.key] !== defaults[f.key] && f.key !== "sort" ? " is-set" : ""}`}
            value={values[f.key]} onChange={(e) => onChange(f.key, e.target.value)}>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

/** A compact Filters button showing how many filters are on; pair it with FilterPanel. */
export function FilterButton({ open, active, onToggle }: { open: boolean; active: number; onToggle: () => void }) {
  return (
    <button type="button" className={`btn btn-ghost btn-sm iconbtn filter-btn${open || active ? " is-on" : ""}`} onClick={onToggle}
      aria-expanded={open} aria-label={active ? `Filters, ${active} on` : "Filters"} title="Filters">
      <SlidersHorizontal size={18} />{active > 0 && <span className="dot-count">{active}</span>}
    </button>
  );
}

/** The filter dropdowns, with the result count and a reset. */
export function FilterPanel({ fields, values, defaults, onChange, onReset, active, shown, total }: BarProps) {
  return (
    <div className="filters no-print">
      <FilterGrid fields={fields} values={values} defaults={defaults} onChange={onChange} />
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        {active > 0 && <button type="button" className="link-btn row" style={{ gap: 2 }} onClick={onReset}><X size={14} />Clear filters</button>}
        <span className="spacer" />
        {shown !== undefined && total !== undefined && <span className="small muted">{shown === total ? `${total} shown` : `Showing ${shown} of ${total}`}</span>}
      </div>
    </div>
  );
}

/** A wrapping row of compact dropdowns, with the result count and a reset. */
export function FilterBar(props: BarProps) {
  const { active, onReset, shown, total } = props;
  const [open, setOpen] = useState(active > 0);
  return (
    <div className="filters no-print">
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`chip${open || active ? " chip-on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <SlidersHorizontal size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Filters{active ? ` · ${active}` : ""}
        </button>
        {active > 0 && <button type="button" className="link-btn row" style={{ gap: 2 }} onClick={onReset}><X size={14} />Clear</button>}
        <span className="spacer" />
        {shown !== undefined && total !== undefined && <span className="small muted">{shown === total ? `${total} shown` : `Showing ${shown} of ${total}`}</span>}
      </div>
      {open && <FilterGrid {...props} />}
    </div>
  );
}
