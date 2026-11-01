import { Check, ChevronDown, MoreVertical } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
        <h3 className="label section-label">{title}{count !== undefined && <span className="count">{count}</span>}</h3>
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

/** A date box that never spills out of its space, with a Clear button whenever it holds a date. */
export function DateInput({ value, onChange, label, small, id }: {
  value: string | null | undefined; onChange: (v: string | null) => void; label: string; small?: boolean; id?: string;
}) {
  return (
    <span className={`date-input${small ? " date-input-sm" : ""}`}>
      <input id={id} className={`input${small ? " input-sm" : ""}`} type="date" aria-label={label} value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)} />
      {value && <button type="button" className="btn btn-ghost btn-sm date-clear" aria-label={`Clear ${label.toLowerCase()}`}
        onClick={() => onChange(null)}>Clear</button>}
    </span>
  );
}

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean }

/** A small drop-down menu, opened from a button (⋮ by default). Closes on a pick, Escape or a tap outside. */
export function Menu({ items, label = "More actions", button, className = "" }: {
  items: MenuItem[]; label?: string; button?: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  return (
    <span className={`menu-wrap ${className}`} ref={box}>
      <button type="button" className={button ? "menu-trigger" : "btn btn-ghost btn-sm iconbtn"} aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {button ?? <MoreVertical size={18} />}
      </button>
      {open && (
        <span className="menu" role="menu">
          {shown.map((i) => (
            <button key={i.label} type="button" role="menuitem" className={`menu-item${i.danger ? " menu-danger" : ""}`}
              onClick={() => { setOpen(false); i.onSelect(); }}>{i.icon}{i.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

/** One fold of an accordion: a header row with a count, opening in place. */
export function Fold({ title, count, open, onToggle, action, children }: {
  title: string; count?: number; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={`fold${open ? " fold-open" : ""}`}>
      <div className="fold-head">
        <button type="button" className="fold-toggle" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>{count !== undefined && <span className="fold-count">{count}</span>}
        </button>
        {open && action}
        <button type="button" className="fold-chevron" aria-label={open ? `Close ${title}` : `Open ${title}`} onClick={onToggle}>
          <ChevronDown size={18} />
        </button>
      </div>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}
