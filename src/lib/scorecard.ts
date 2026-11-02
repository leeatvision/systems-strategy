import { addDays, isoDay, startOfWeek, today } from "./data";

export type Period = "week" | "month" | "quarter" | "year";
export type Unit = "number" | "dollar" | "percent" | "hours" | "days";
export type Comparison = "gte" | "lte" | "eq" | "between";

export interface Scorecard {
  id: string;
  meeting_id: string | null;
  title: string;
  period: Period;
  periods_to_show: number;
  show_total: boolean;
  show_average: boolean;
  newest_first: boolean;
}

export interface Measurable {
  id: string;
  company_id: string;
  scorecard_id: string;
  owner_member_id: string | null;
  title: string;
  description: string | null;
  unit: Unit;
  comparison: Comparison;
  goal_value: number | null;
  goal_value_upper: number | null;
  decimals: number;
  period_override: Period | null;
  is_additive: boolean;
  sort_order: number;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface MValue {
  id: string;
  measurable_id: string;
  period_start: string;
  value: number | null;
  goal_value: number | null;
  goal_value_upper: number | null;
  comparison: Comparison | null;
  note: string | null;
}

export const UNIT_LABEL: Record<Unit, string> = { number: "Number", dollar: "Dollars", percent: "Percent", hours: "Hours", days: "Days" };
export const COMPARISON_LABEL: Record<Comparison, string> = { gte: "At least (≥)", lte: "At most (≤)", eq: "Exactly (=)", between: "Between" };
export const PERIOD_LABEL: Record<Period, string> = { week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly" };

/** Start of the period containing `day` (weeks start Sunday). */
export function periodStart(period: Period, day = today()): string {
  const d = new Date(`${day}T12:00:00`);
  if (period === "week") return startOfWeek(day);
  if (period === "month") return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
  if (period === "quarter") return isoDay(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1));
  return `${d.getFullYear()}-01-01`;
}

export function shiftPeriod(period: Period, start: string, by: number): string {
  if (period === "week") return addDays(start, 7 * by);
  const d = new Date(`${start}T12:00:00`);
  const months = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  return isoDay(new Date(d.getFullYear(), d.getMonth() + months * by, 1));
}

/** The last `n` periods, oldest first, ending with the current one. */
export function recentPeriods(period: Period, n: number, ending = today()): string[] {
  const last = periodStart(period, ending);
  return Array.from({ length: n }, (_, i) => shiftPeriod(period, last, i - (n - 1)));
}

export function periodLabel(period: Period, start: string): string {
  const d = new Date(`${start}T12:00:00`);
  if (period === "week") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (period === "month") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  if (period === "quarter") return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
  return String(d.getFullYear());
}

export function fmtValue(v: number | null | undefined, unit: Unit, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const n = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (unit === "dollar") return v < 0 ? `-$${n.slice(1)}` : `$${n}`;
  if (unit === "percent") return `${n}%`;
  if (unit === "hours") return `${n} h`;
  if (unit === "days") return `${n} d`;
  return n;
}

export function goalText(m: Pick<Measurable, "comparison" | "goal_value" | "goal_value_upper" | "unit" | "decimals">): string {
  if (m.goal_value === null) return "No goal";
  const f = (v: number | null) => fmtValue(v, m.unit, m.decimals);
  if (m.comparison === "between") return `${f(m.goal_value)} – ${f(m.goal_value_upper ?? m.goal_value)}`;
  return `${{ gte: "≥", lte: "≤", eq: "=" }[m.comparison]} ${f(m.goal_value)}`;
}

/** Green/red for one value against a goal; null when there's nothing to judge. */
export function onTrack(value: number | null, goal: number | null, upper: number | null, comparison: Comparison | null): boolean | null {
  if (value === null || goal === null || !comparison) return null;
  if (comparison === "gte") return value >= goal;
  if (comparison === "lte") return value <= goal;
  if (comparison === "eq") return value === goal;
  return value >= goal && value <= (upper ?? goal);
}

/** "$1,234.50", "12 %", "14.5 h" → number; commas are thousands separators. */
export function parseNumber(text: string): number | null {
  const t = text.replace(/[$,%\sh]/gi, "").replace(/d$/i, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
