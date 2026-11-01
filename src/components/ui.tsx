import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { fullName, initials, type Member } from "../lib/supabase";

export function Avatar({ m, size = 28 }: { m: Member | undefined; size?: number }) {
  return (
    <span className="avatar" title={m ? fullName(m) : "Unassigned"}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {m ? initials(m) : "–"}
    </span>
  );
}

/** Round tick box for done/not done. */
export function Tick({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`tick${done ? " tick-done" : ""}`} aria-label={label} aria-pressed={done}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      {done && <Check size={14} strokeWidth={3} />}
    </button>
  );
}

/** A row of toggle chips; one value selected. */
export function Chips<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip${o.value === value ? " chip-on" : ""}`}
          aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function OwnerSelect({ members, value, onChange, allowNone, id }: {
  members: Member[]; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean; id?: string;
}) {
  return (
    <select id={id} className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">No one</option>}
      {members.map((m) => <option key={m.id} value={m.id}>{fullName(m)}</option>)}
    </select>
  );
}

/** Pick one or more people (adding a To-Do for several people makes one each). */
export function OwnerChips({ members, value, onChange }: { members: Member[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="chips">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button key={m.id} type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== m.id) : [...value, m.id])}>
            {m.first_name}
          </button>
        );
      })}
    </div>
  );
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="row">
        <h3 className="label" style={{ fontSize: 12 }}>{title}{count !== undefined && <span className="count">{count}</span>}</h3>
        <span className="spacer" />{action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="card card-pad muted small">{children}</p>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="progress" title={`${done} of ${total} steps done`}>
      <span className="progress-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="small muted">{done}/{total}</span>
    </span>
  );
}
