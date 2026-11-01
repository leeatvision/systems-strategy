import { useSession } from "../lib/session";

export function NoAccess() {
  const { signOut } = useSession();
  return (
    <div className="auth">
      <div className="auth-box stack" style={{ textAlign: "center" }}>
        <h1>No access</h1>
        <p className="muted">This login isn't part of the company. Ask an owner to add you.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
