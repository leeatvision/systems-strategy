import { useState } from "react";
import { nextDates, presets, repeatText, sameRule, type Repeat } from "../lib/repeat";
import { fmtDay } from "../lib/data";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Choose how a To-Do repeats: a ready-made choice, or Custom for any mix of interval, days, start point and end. */
export function RepeatPicker({ due, value, onChange }: { due: string; value: Repeat | null; onChange: (r: Repeat | null) => void }) {
  const list = presets(due);
  const match = value ? list.find((p) => sameRule(p.rule, value)) : null;
  const [customMode, setCustomMode] = useState(!!value && !match);
  const choice = !value ? "" : customMode || !match ? "custom" : match.key;
  const d = new Date(`${due}T12:00:00`);
  const dom = d.getDate(), wd = d.getDay(), nth = Math.ceil(dom / 7);
  const set = (change: Partial<Repeat>) => value && onChange({ ...value, ...change });
  const ends = value?.times ? "times" : value?.until ? "until" : "never";

  return (
    <div className="stack" style={{ gap: 8 }}>
      <select className="select" value={choice} aria-label="Repeats" onChange={(e) => {
        const k = e.target.value;
        setCustomMode(k === "custom");
        if (!k) onChange(null);
        else if (k === "custom") onChange(value ?? { every: 1, unit: "week", weekdays: [wd] });
        else onChange({ ...list.find((p) => p.key === k)!.rule, times: value?.times, until: value?.until });
      }}>
        <option value="">Doesn't repeat</option>
        {list.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>

      {value && choice === "custom" && (
        <div className="repeat-custom stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="small">Every</span>
            <input className="input" type="number" min={1} max={99} inputMode="numeric" value={value.every} style={{ width: 72 }} aria-label="How many"
              onChange={(e) => set({ every: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
            <select className="select" style={{ width: "auto" }} value={value.unit} aria-label="Unit" onChange={(e) => {
              const unit = e.target.value as Repeat["unit"];
              onChange({ every: value.every, unit, from: value.from, times: value.times, until: value.until,
                ...(unit === "week" ? { weekdays: [wd] } : unit === "month" ? { monthly: "day", dom } : {}) });
            }}>
              {(["day", "week", "month", "year"] as const).map((u) => <option key={u} value={u}>{value.every > 1 ? `${u}s` : u}</option>)}
            </select>
          </div>
          {value.unit === "week" && value.from !== "done" && (
            <div className="chips" role="group" aria-label="On">
              {DAYS.map((name, i) => {
                const on = value.weekdays?.includes(i) ?? false;
                return <button key={name} type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on}
                  onClick={() => { const next = on ? (value.weekdays ?? []).filter((x) => x !== i) : [...(value.weekdays ?? []), i]; set({ weekdays: next.length ? next : undefined }); }}>{name}</button>;
              })}
            </div>
          )}
          {value.unit === "month" && value.from !== "done" && (
            <div className="chips" role="group" aria-label="Which day">
              <button type="button" className={`chip${value.monthly !== "weekday" ? " chip-on" : ""}`} onClick={() => set({ monthly: "day", dom, nth: undefined, wd: undefined })}>On the {ord(dom)}</button>
              {nth <= 4 && <button type="button" className={`chip${value.monthly === "weekday" && value.nth === nth ? " chip-on" : ""}`}
                onClick={() => set({ monthly: "weekday", nth, wd, dom: undefined })}>On the {ord(nth)} {DAY_LONG[wd]}</button>}
              {dom + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() && <button type="button" className={`chip${value.monthly === "weekday" && value.nth === -1 ? " chip-on" : ""}`}
                onClick={() => set({ monthly: "weekday", nth: -1, wd, dom: undefined })}>On the last {DAY_LONG[wd]}</button>}
            </div>
          )}
          <div className="field"><span className="small">Count the next one from</span>
            <div className="chips">
              <button type="button" className={`chip${value.from !== "done" ? " chip-on" : ""}`} onClick={() => set({ from: undefined })}>The due date</button>
              <button type="button" className={`chip${value.from === "done" ? " chip-on" : ""}`} onClick={() => set({ from: "done", weekdays: undefined, monthly: undefined, nth: undefined, wd: undefined })}>When it's done</button>
            </div>
          </div>
        </div>
      )}

      {value && (
        <div className="field"><span className="small">Ends</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="chips">
              <button type="button" className={`chip${ends === "never" ? " chip-on" : ""}`} onClick={() => set({ times: undefined, until: undefined })}>Never</button>
              <button type="button" className={`chip${ends === "times" ? " chip-on" : ""}`} onClick={() => set({ times: value.times ?? 6, until: undefined })}>After a number of times</button>
              <button type="button" className={`chip${ends === "until" ? " chip-on" : ""}`} onClick={() => set({ until: value.until ?? nextDates({ ...value, times: undefined, until: undefined }, due, 6).at(-1) ?? due, times: undefined })}>On a date</button>
            </div>
            {ends === "times" && <input className="input" type="number" min={1} max={999} value={value.times} style={{ width: 84 }} aria-label="Times"
              onChange={(e) => set({ times: Math.max(1, Number(e.target.value) || 1) })} />}
            {ends === "until" && <input className="input" type="date" value={value.until} style={{ width: 170 }} aria-label="Ends on"
              onChange={(e) => e.target.value && set({ until: e.target.value })} />}
          </div>
        </div>
      )}

      {value && (
        <p className="small muted" style={{ margin: 0 }}>
          <strong style={{ color: "var(--color-fg-secondary)" }}>{repeatText(value)}.</strong>{" "}
          {value.from === "done" ? "The next one is created when this one is ticked done." : (() => {
            const next = nextDates(value, due, 3);
            return next.length ? `Next: ${next.map((x) => fmtDay(x)).join(", ")}${next.length === 3 ? "…" : ""}` : "This is the last one.";
          })()}
        </p>
      )}
    </div>
  );
}
