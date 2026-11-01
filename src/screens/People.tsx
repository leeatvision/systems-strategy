import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { friendlyError, fullName, initials, supabase, type Member, type Role } from "../lib/supabase";
import { useMe } from "../lib/session";
import { APP_NAME } from "../lib/config";
import { forgetMembers } from "../lib/data";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", leader: "Leader", member: "Member" };
const PIN_RULE = /^[0-9]{6}$/;

export function People() {
  const { me, company, isOwner } = useMe();
  const [people, setPeople] = useState<Member[]>([]);
  const [withPin, setWithPin] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    const [{ data: members }, { data: pins }, { data: lockedIds }] = await Promise.all([
      supabase.from("ss_members").select("*").eq("company_id", company.id).order("first_name"),
      supabase.rpc("ss_members_with_pin", { p_company: company.id }),
      // Owners only; returns nothing for everyone else.
      supabase.rpc("ss_locked_members", { p_company: company.id }),
    ]);
    setPeople((members ?? []) as Member[]);
    setWithPin(new Set((pins ?? []) as string[]));
    setLocked(new Set((lockedIds ?? []) as string[]));
  }, [company.id]);

  useEffect(() => { load(); }, [load]);

  const visible = people.filter((p) => showRemoved || p.status === "active");
  const removedCount = people.filter((p) => p.status === "removed").length;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>People</h1>
        <span className="spacer" />
        {isOwner && <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><UserPlus size={16} />Add person</button>}
      </div>
      <ul className="card list">
        {visible.map((p) => (
          <li key={p.id} style={{ opacity: p.status === "removed" ? 0.55 : 1 }}>
            <span className="avatar">{initials(p)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--color-fg)" }}>{fullName(p)}{p.id === me.id && <span className="muted"> (you)</span>}</div>
              <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.job_title || p.email}</div>
            </div>
            {p.status === "removed" ? <span className="badge">Removed</span> : (
              <>
                {!withPin.has(p.id) && <span className="badge badge-warn">No PIN yet</span>}
                {locked.has(p.id) && <span className="badge badge-warn">Locked</span>}
                <span className={`badge${p.role === "owner" ? " badge-green" : ""}`}>{ROLE_LABEL[p.role]}</span>
              </>
            )}
            {isOwner && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}
          </li>
        ))}
      </ul>
      {removedCount > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowRemoved(!showRemoved)}>
          {showRemoved ? "Hide" : "Show"} removed people ({removedCount})
        </button>
      )}
      {!isOwner && <p className="small muted">Only owners can add people or reset PINs.</p>}
      {editing && (
        <PersonSheet person={editing === "new" ? null : editing} companyId={company.id} isSelf={editing !== "new" && editing.id === me.id}
          hasPin={editing !== "new" && withPin.has(editing.id)} isLocked={editing !== "new" && locked.has(editing.id)}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); forgetMembers(); load(); }} />
      )}
    </div>
  );
}

function PersonSheet({ person, companyId, isSelf, hasPin, isLocked, onClose, onSaved }: {
  person: Member | null; companyId: string; isSelf: boolean; hasPin: boolean; isLocked: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    first_name: person?.first_name ?? "", last_name: person?.last_name ?? "", email: person?.email ?? "",
    job_title: person?.job_title ?? "", role: (person?.role ?? "leader") as Role,
  });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if ((!person || pin) && !PIN_RULE.test(pin)) { setError("PIN must be 6 digits."); return; }
    setBusy(true); setError("");
    try {
      let id = person?.id;
      const row = { ...form, email: form.email.trim().toLowerCase(), job_title: form.job_title || null };
      if (person) {
        const { error } = await supabase.from("ss_members").update(row).eq("id", person.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ss_members").insert({ ...row, company_id: companyId }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (pin) {
        const { error } = await supabase.rpc("ss_set_member_pin", { p_member: id, p_pin: pin });
        if (error) throw error;
      }
      onSaved();
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  const setStatus = async (status: "active" | "removed") => {
    setBusy(true); setError("");
    const { error } = await supabase.from("ss_members").update({ status }).eq("id", person!.id);
    setBusy(false);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  return (
    <Sheet title={person ? `Edit ${fullName(person)}` : "Add person"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid-2">
          <label className="field"><span>First name</span><input className="input" required value={form.first_name} onChange={set("first_name")} /></label>
          <label className="field"><span>Last name</span><input className="input" value={form.last_name} onChange={set("last_name")} /></label>
        </div>
        <label className="field"><span>Email (used to sign in)</span><input className="input" type="email" required value={form.email} onChange={set("email")} /></label>
        <label className="field"><span>Job title</span><input className="input" value={form.job_title} onChange={set("job_title")} /></label>
        <label className="field"><span>Role</span>
          <select className="select" value={form.role} onChange={set("role")} disabled={isSelf}>
            <option value="owner">Owner: can add people, reset PINs and permanently delete</option>
            <option value="leader">Leader: can see and edit everything</option>
            <option value="member">Member</option>
          </select>
        </label>
        <label className="field">
          <span><KeyRound size={14} style={{ verticalAlign: -2 }} /> {person ? (hasPin ? "New PIN (leave blank to keep)" : "PIN (not set yet)") : "PIN"}</span>
          <input className="input" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pin} autoComplete="off"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="6 digits" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.3em" }} />
        </label>
        {isLocked && <p className="notice">Locked out after too many wrong PINs. Setting a new PIN unlocks them straight away.</p>}
        <p className="small muted">Give the PIN to the person yourself, in person or by text. {APP_NAME} never sends it.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{person ? "Save" : "Add person"}</button>
        {person && !isSelf && (person.status === "active"
          ? <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setStatus("removed")}>Remove from {APP_NAME}</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => setStatus("active")}>Restore access</button>)}
        {person?.status === "active" && !isSelf && <p className="small muted">Removing signs them out and blocks access. Their Goals, To-Dos and history stay.</p>}
      </form>
    </Sheet>
  );
}
