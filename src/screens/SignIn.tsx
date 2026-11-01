import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (pin.length !== 6 || busy) return;
    if (!email.includes("@")) { setError("Enter your email first."); setPin(""); return; }
    setBusy(true); setError("");
    pinAuth({ action: "login", email, pin })
      .then(() => { try { localStorage.setItem(LAST_EMAIL, email.trim().toLowerCase()); } catch { /* private mode */ } })
      .catch((e: Error) => { setError(e.message); setPin(""); })
      .finally(() => setBusy(false));
  }, [pin, email, busy]);

  return (
    <div className="auth">
      <div className="auth-box stack">
        <img className="auth-logo" src={logo} alt="" />
        <div style={{ textAlign: "center" }}>
          <h1 className="wordmark">{APP_NAME}</h1>
          <p className="muted">Sign in with your email and PIN</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" inputMode="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <div className="field"><span>PIN</span></div>
        <PinPad value={pin} onChange={setPin} disabled={busy} />
        {busy && <p className="muted" style={{ textAlign: "center" }}>Signing in…</p>}
        {error && <p className="error">{error}</p>}
        <p className="small muted" style={{ textAlign: "center" }}>Forgot your PIN? Ask an owner to reset it.</p>
      </div>
    </div>
  );
}
