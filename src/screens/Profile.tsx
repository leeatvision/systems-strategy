import { useState, type FormEvent } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe, useSession } from "../lib/session";
import { CalendarLink } from "../components/CalendarLink";
import { Link } from "react-router-dom";
import { Bell, ChevronRight } from "lucide-react";

export function Profile() {
  const { me } = useMe();
  const { refresh, signOut } = useSession();
  const [form, setForm] = useState({ first_name: me.first_name, last_name: me.last_name, job_title: me.job_title ?? "" });
  const [pin, setPin] = useState({ a: "", b: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("ss_members").update({ ...form, job_title: form.job_title || null }).eq("id", me.id);
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: "Profile saved." });
    if (!error) refresh();
  };

  const savePin = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.a !== pin.b) { setMsg({ ok: false, text: "The two PINs don't match." }); return; }
    const { error } = await supabase.rpc("ss_set_member_pin", { p_member: me.id, p_pin: pin.a });
    setMsg(error ? { ok: false, text: friendlyError(error) } : { ok: true, text: "PIN changed. Use it next time you sign in." });
    if (!error) setPin({ a: "", b: "" });
  };

  const digits = (k: "a" | "b") => (e: React.ChangeEvent<HTMLInputElement>) => setPin({ ...pin, [k]: e.target.value.replace(/\D/g, "") });

  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <h1>My profile</h1>
      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
      <form className="card card-pad stack" onSubmit={saveProfile}>
        <div className="grid-2">
          <label className="field"><span>First name</span><input className="input" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
          <label className="field"><span>Last name</span><input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
        </div>
        <label className="field"><span>Job title</span><input className="input" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></label>
        <p className="small muted">Signed in as {me.email}</p>
        <button className="btn btn-primary">Save profile</button>
      </form>
      <form className="card card-pad stack" onSubmit={savePin}>
        <h2>Change my PIN</h2>
        <div className="grid-2">
          <label className="field"><span>New PIN</span><input className="input" inputMode="numeric" maxLength={6} required value={pin.a} onChange={digits("a")} autoComplete="off" /></label>
          <label className="field"><span>Again</span><input className="input" inputMode="numeric" maxLength={6} required value={pin.b} onChange={digits("b")} autoComplete="off" /></label>
        </div>
        <button className="btn">Change PIN</button>
      </form>
      <Link to="/settings/notifications" className="card card-pad row" style={{ color: "inherit" }}>
        <Bell size={20} color="var(--color-brand)" /><span style={{ flex: 1 }}><strong style={{ color: "var(--color-fg)" }}>Notification settings</strong>
          <span className="small muted" style={{ display: "block" }}>Push to this phone, daily reminder, what to be told about</span></span><ChevronRight size={18} />
      </Link>
      <CalendarLink />
      <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
    </div>
  );
}
