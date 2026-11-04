import { addDays, type RepeatRule, type Todo } from "./data";

/**
 * How a To-Do repeats. When it's ticked done, the database makes the next one (see ss_repeat_todo);
 * nextDates() below mirrors that so the editor can show what's coming.
 */
export interface Repeat {
  every: number;
  unit: "day" | "week" | "month" | "year";
  weekdays?: number[];          // weeks: Sun = 0 … Sat = 6
  monthly?: "day" | "weekday";  // months: the same date, or e.g. the 2nd Tuesday
  dom?: number;                 // day of the month
  nth?: number;                 // 1-4, or -1 for the last
  wd?: number;                  // weekday for "the 2nd Tuesday"
  from?: "due" | "done";        // count from the due date, or from the day it's ticked done
  times?: number;               // stop after this many
  until?: string;               // stop after this date
  n?: number;                   // which one this is
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = (n: number) => (n === -1 ? "last" : ["", "1st", "2nd", "3rd", "4th"][n] ?? `${n}th`);
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const d0 = (s: string) => new Date(`${s}T12:00:00`);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const LEGACY: Record<RepeatRule, Repeat> = {
  daily: { every: 1, unit: "day" }, weekdays: { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] },
  weekly: { every: 1, unit: "week" }, biweekly: { every: 2, unit: "week" }, monthly: { every: 1, unit: "month" },
};
/** The To-Do's rule, including ones saved the older way. */
export const repeatOf = (t: Pick<Todo, "repeat_rule"> & { repeat?: Repeat | null }): Repeat | null =>
  t.repeat ?? (t.repeat_rule ? LEGACY[t.repeat_rule] : null);

/** "Every 2 weeks on Mon, Thu · 6 times", for lists and the editor. */
export function repeatText(r: Repeat | null): string {
  if (!r) return "";
  const every = r.every > 1 ? `Every ${r.every} ${r.unit}s` : `Every ${r.unit}`;
  let s = every;
  if (r.unit === "day" && r.every === 1) s = "Every day";
  if (r.unit === "week" && r.weekdays?.length) {
    const wd = [...r.weekdays].sort();
    s = wd.join() === "1,2,3,4,5" && r.every === 1 ? "Every weekday" : `${every} on ${wd.map((d) => DAY[d]).join(", ")}`;
  }
  if (r.unit === "month") s = r.monthly === "weekday" && r.wd !== undefined
    ? `${every} on the ${NTH(r.nth ?? 1)} ${DAY_LONG[r.wd]}` : r.dom ? `${every} on the ${ord(r.dom)}` : every;
  if (r.from === "done") s = `${r.every} ${r.unit}${r.every > 1 ? "s" : ""} after it's done`;
  if (r.times) s += ` · ${r.times} times`;
  if (r.until) s += ` · until ${d0(r.until).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return s;
}

function nextOne(r: Repeat, due: string, done: string): string {
  const every = Math.max(1, r.every || 1);
  const base = r.from === "done" ? done : due;
  const b = d0(base);
  if (r.unit === "day") return addDays(base, every);
  if (r.unit === "week") {
    const days = [...(r.weekdays ?? [])].sort((x, y) => x - y);
    if (!days.length) return addDays(base, 7 * every);
    const ws = addDays(base, -b.getDay());
    for (let i = 1; i <= 6; i++) {
      const d = addDays(base, i);
      if (d >= addDays(ws, 7)) break;
      if (days.includes(d0(d).getDay())) return d;
    }
    return addDays(ws, 7 * every + days[0]);
  }
  if (r.unit === "month") {
    const m = new Date(b.getFullYear(), b.getMonth() + every, 1, 12);
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0, 12);
    if (r.monthly === "weekday") {
      const wd = r.wd ?? d0(due).getDay();
      if ((r.nth ?? 1) === -1) return iso(new Date(last.getFullYear(), last.getMonth(), last.getDate() - ((last.getDay() - wd + 7) % 7), 12));
      return iso(new Date(m.getFullYear(), m.getMonth(), 1 + ((wd - m.getDay() + 7) % 7) + 7 * ((r.nth ?? 1) - 1), 12));
    }
    const dom = r.dom ?? d0(due).getDate();
    return iso(new Date(m.getFullYear(), m.getMonth(), Math.min(dom, last.getDate()), 12));
  }
  const y = new Date(b.getFullYear() + every, b.getMonth(), 1, 12);
  return iso(new Date(y.getFullYear(), y.getMonth(), Math.min(b.getDate(), new Date(y.getFullYear(), y.getMonth() + 1, 0).getDate()), 12));
}

/** The next few due dates after `due`, as if each were ticked done on its due date. */
export function nextDates(r: Repeat, due: string, count = 3): string[] {
  const out: string[] = [];
  let cur = due, n = r.n ?? 1;
  for (let i = 0; i < count; i++) {
    if (r.times && n >= r.times) break;
    const next = nextOne(r, cur, cur);
    if (r.until && next > r.until) break;
    out.push(next); cur = next; n++;
  }
  return out;
}

/** Ready-made choices for a To-Do due on `due`. */
export function presets(due: string): { key: string; label: string; rule: Repeat }[] {
  const d = d0(due), wd = d.getDay(), dom = d.getDate(), nth = Math.ceil(dom / 7);
  const lastWeek = d.getMonth() !== new Date(d.getFullYear(), d.getMonth(), dom + 7).getMonth();
  const list: { key: string; label: string; rule: Repeat }[] = [
    { key: "day", label: "Every day", rule: { every: 1, unit: "day" } },
    { key: "weekdays", label: "Every weekday (Mon–Fri)", rule: { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] } },
    { key: "week", label: `Every week on ${DAY_LONG[wd]}`, rule: { every: 1, unit: "week", weekdays: [wd] } },
    { key: "2week", label: `Every 2 weeks on ${DAY_LONG[wd]}`, rule: { every: 2, unit: "week", weekdays: [wd] } },
    { key: "month", label: `Every month on the ${ord(dom)}`, rule: { every: 1, unit: "month", monthly: "day", dom } },
    { key: "monthwd", label: `Every month on the ${NTH(nth <= 4 ? nth : -1)} ${DAY_LONG[wd]}`, rule: { every: 1, unit: "month", monthly: "weekday", nth: nth <= 4 ? nth : -1, wd } },
    { key: "quarter", label: `Every 3 months on the ${ord(dom)}`, rule: { every: 3, unit: "month", monthly: "day", dom } },
    { key: "year", label: `Every year on ${d.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`, rule: { every: 1, unit: "year" } },
  ];
  if (lastWeek) list.splice(6, 0, { key: "monthlast", label: `Every month on the last ${DAY_LONG[wd]}`, rule: { every: 1, unit: "month", monthly: "weekday", nth: -1, wd } });
  return list;
}

export const sameRule = (a: Repeat | null, b: Repeat | null) => {
  const clean = (r: Repeat | null) => r && JSON.stringify({ ...r, n: undefined, weekdays: r.weekdays ? [...r.weekdays].sort() : undefined });
  return clean(a) === clean(b);
};
