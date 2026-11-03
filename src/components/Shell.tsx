import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, Bell, ChartLine, CircleAlert, ClipboardCheck, Compass, Home, ListOrdered, LogOut, Megaphone, Menu, Mountain, Network, Search, SquareCheck, Trash2, User, Users, Video, AlarmClock } from "lucide-react";
import { useUnreadCount } from "../lib/notifications";
import { OfflineBanner } from "./OfflineBanner";
import { useMe, useSession } from "../lib/session";
import { APP_NAME } from "../lib/config";

const logo = `${import.meta.env.BASE_URL}icons/logo-mark.png`;

const main = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/goals", label: "Goals", icon: Mountain },
  { to: "/todos", label: "To-Dos", icon: SquareCheck },
  { to: "/issues", label: "Issues", icon: CircleAlert },
];
const more = [
  { to: "/headlines", label: "Headlines", icon: Megaphone },
  { to: "/meetings", label: "Meetings", icon: Video },
  { to: "/key-numbers", label: "Key Numbers", icon: BarChart3 },
  { to: "/vision-plan", label: "Vision and Plan", icon: Compass },
  { to: "/org-chart", label: "Org Chart", icon: Network },
  { to: "/processes", label: "Processes", icon: ListOrdered },
  { to: "/checkups", label: "Checkups", icon: ClipboardCheck },
  { to: "/insights", label: "Insights", icon: ChartLine },
  { to: "/reminders", label: "Reminders", icon: AlarmClock },
];

export function Shell() {
  const { me, company } = useMe();
  const unread = useUnreadCount(me.id);
  const { signOut } = useSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img src={logo} alt="" /><span className="wordmark">{APP_NAME}</span></div>
        <NavLink to="/search" className="side-link"><Search size={18} />Search</NavLink>
        <NavLink to="/notifications" className="side-link"><Bell size={18} />Notifications{unread > 0 && <span className="pill">{unread}</span>}</NavLink>
        <div className="side-gap" />
        {main.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="side-link"><Icon size={18} />{label}</NavLink>
        ))}
        <div className="side-section label">More</div>
        {more.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="side-link"><Icon size={18} />{label}</NavLink>
        ))}
        <span className="spacer" />
        <NavLink to="/people" className="side-link"><Users size={18} />People</NavLink>
        <NavLink to="/bin" className="side-link"><Trash2 size={18} />Recycle bin</NavLink>
        <NavLink to="/profile" className="side-link"><User size={18} />My profile</NavLink>
        <button className="side-link btn-ghost" style={{ border: 0, background: "none", cursor: "pointer", textAlign: "left" }} onClick={signOut}>
          <LogOut size={18} />Sign out
        </button>
        <div className="small" style={{ padding: "12px 12px 0", color: "#8c9090" }}>{company.name}</div>
      </aside>

      <header className="topbar">
        <img src={logo} alt="" />
        <span className="brand wordmark">{APP_NAME}</span>
        <span className="spacer" />
        <NavLink to="/search" aria-label="Search" className="btn btn-ghost btn-sm"><Search size={20} /></NavLink>
        <NavLink to="/notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="btn btn-ghost btn-sm bell">
          <Bell size={20} />{unread > 0 && <span className="pill">{unread}</span>}
        </NavLink>
        <NavLink to="/profile" aria-label="My profile" className="btn btn-ghost btn-sm"><User size={20} /></NavLink>
      </header>

      <div className="main">
        <OfflineBanner />
        <main className="content"><Outlet /></main>
      </div>

      <nav className="tabbar">
        {main.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="tab"><Icon size={22} />{label}</NavLink>
        ))}
        <NavLink to="/more" className="tab"><Menu size={22} />More</NavLink>
      </nav>
    </div>
  );
}

export const moreLinks = [...more, { to: "/people", label: "People", icon: Users }, { to: "/bin", label: "Recycle bin", icon: Trash2 },
  { to: "/profile", label: "My profile", icon: User }];
