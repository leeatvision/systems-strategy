import { Link } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import { moreLinks } from "../components/Shell";
import { useSession } from "../lib/session";

export function More() {
  const { signOut } = useSession();
  return (
    <div className="stack">
      <h1>More</h1>
      <ul className="card list">
        {moreLinks.map(({ to, label, icon: Icon }) => (
          <li key={to}><Link to={to} className="row" style={{ color: "inherit", flex: 1 }}>
            <Icon size={20} color="var(--color-fg-muted)" /><span style={{ flex: 1 }}>{label}</span><ChevronRight size={18} color="var(--color-fg-muted)" />
          </Link></li>
        ))}
        <li><button className="row btn-ghost" style={{ border: 0, background: "none", padding: 0, flex: 1, cursor: "pointer" }} onClick={signOut}>
          <LogOut size={20} color="var(--color-fg-muted)" /><span>Sign out</span>
        </button></li>
      </ul>
    </div>
  );
}
