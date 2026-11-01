import { useState, type FormEvent } from "react";
import { PinPad } from "../components/PinPad";
import { pinAuth } from "../lib/supabase";
import { APP_NAME } from "../lib/config";

const logo = `${import.meta.env.BASE_URL}icons/logo-mark.png`;

/** First-time set-up, shown only while no company exists. Only the owner emails stored in the database are accepted. */
export function Setup({ onSignInInstead }: { onSignInInstead: () => void }) {
  const [form, setForm] = useState({ companyName: "", firstName: "", lastName: "", email: "" });
  const [step, setStep] = useState<"details" | "pin" | "confirm">("details");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const next = (e: FormEvent) => { e.preventDefault(); setError(""); setStep("pin"); };

  const onPin = (v: string) => { setPin(v); if (v.length === 6) setStep("confirm"); };
  const onConfirm = async (v: string) => {
    setConfirm(v);
    if (v.length < 6) return;
    if (v !== pin) { setError("The PINs didn't match. Choose your PIN again."); setPin(""); setConfirm(""); setStep("pin"); return; }
    setBusy(true); setError("");
    try {
      await pinAuth({ action: "setup", pin, ...form });
    } catch (e) {
      setError((e as Error).message); setPin(""); setConfirm(""); setStep("pin");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth-box stack">
        <img className="auth-logo" src={logo} alt="" />
        <div style={{ textAlign: "center" }}>
          <h1>Set up <span className="wordmark">{APP_NAME}</span></h1>
          <p className="muted">One time only, by a company owner.</p>
        </div>
        {step === "details" ? (
          <form className="stack" onSubmit={next}>
            <label className="field"><span>Company name</span>
              <input className="input" required value={form.companyName} onChange={set("companyName")} /></label>
            <div className="grid-2">
              <label className="field"><span>First name</span>
                <input className="input" required value={form.firstName} onChange={set("firstName")} autoComplete="given-name" /></label>
              <label className="field"><span>Last name</span>
                <input className="input" value={form.lastName} onChange={set("lastName")} autoComplete="family-name" /></label>
            </div>
            <label className="field"><span>Your email</span>
              <input className="input" type="email" required value={form.email} onChange={set("email")} autoComplete="username" /></label>
            <button className="btn btn-primary btn-block">Next: choose your PIN</button>
          </form>
        ) : (
          <div className="stack">
            <p style={{ textAlign: "center" }}>
              {step === "pin" ? "Choose a 6-digit PIN" : "Enter it again to confirm"}
            </p>
            <PinPad value={step === "pin" ? pin : confirm} onChange={step === "pin" ? onPin : onConfirm} disabled={busy} />
            <p className="small muted" style={{ textAlign: "center" }}>Not all the same digit, and not a run like 123456.</p>
            {busy && <p className="muted" style={{ textAlign: "center" }}>Setting up…</p>}
            <button className="btn btn-ghost" onClick={() => { setStep("details"); setPin(""); setConfirm(""); }} disabled={busy}>Back</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-ghost btn-sm" onClick={onSignInInstead}>Already set up? Sign in</button>
      </div>
    </div>
  );
}
