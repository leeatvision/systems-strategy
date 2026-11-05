import { useEffect, useRef, useState } from "react";
import { PinPad } from "../components/PinPad";
import { pinAuth } from "../lib/supabase";
import { APP_NAME } from "../lib/config";

const logo = `${import.meta.env.BASE_URL}icons/logo-mark.png`;
const LAST_EMAIL = "ss.last-email";

function readLastEmail(): string {
  try { return localStorage.getItem(LAST_EMAIL) ?? ""; } catch { return ""; }
}

export function SignIn() {
  const [email, setEmail] = useState(readLastEmail);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);

  // Six digits (typed, tapped or filled in by a password manager) sign in straight away. It goes through
  // the form's submit so password managers see a normal sign-in and offer to save the PIN.
  useEffect(() => {
    if (pin.length === 6 && !busy) form.current?.requestSubmit();
  }, [pin, busy]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6 || busy) return;
    if (!email.includes("@")) { setError("Enter your email first."); setPin(""); return; }
    setBusy(true); setError("");
    pinAuth({ action: "login", email, pin })
      .then(() => { try { localStorage.setItem(LAST_EMAIL, email.trim().toLowerCase()); } catch { /* private mode */ } })
      .catch((e: Error) => { setError(e.message); setPin(""); })
      .finally(() => setBusy(false));
  };

  return (
    <div className="auth">
      <form ref={form} className="auth-box stack" onSubmit={submit} method="post" action="#" autoComplete="on">
        <img className="auth-logo" src={logo} alt="" />
        <div style={{ textAlign: "center" }}>
          <h1 className="wordmark">{APP_NAME}</h1>
          <p className="muted">Sign in with your email and PIN</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" id="email" inputMode="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="field" htmlFor="pin"><span>PIN</span></label>
        <PinPad value={pin} onChange={setPin} disabled={busy} field={{ autoComplete: "current-password", id: "pin" }} />
        {busy && <p className="muted" style={{ textAlign: "center" }}>Signing in…</p>}
        {error && <p className="error">{error}</p>}
        <p className="small muted" style={{ textAlign: "center" }}>Forgot your PIN? Ask an owner to reset it.</p>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true">Sign in</button>
      </form>
    </div>
  );
}
