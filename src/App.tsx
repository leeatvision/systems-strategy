import { useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { SessionProvider, useSession } from "./lib/session";
import { Shell } from "./components/Shell";
import { SignIn } from "./screens/SignIn";
import { Setup } from "./screens/Setup";
import { NoAccess } from "./screens/NoAccess";
import { Home } from "./screens/Home";
import { Insights } from "./screens/Insights";
import { People } from "./screens/People";
import { Profile } from "./screens/Profile";
import { More } from "./screens/More";
import { Goals } from "./screens/Goals";
import { GoalDetail } from "./screens/GoalDetail";
import { Todos } from "./screens/Todos";
import { Issues } from "./screens/Issues";
import { Headlines } from "./screens/Headlines";
import { RecycleBin } from "./screens/RecycleBin";
import { Notifications } from "./screens/Notifications";
import { Search } from "./screens/Search";
import { Scorecard } from "./screens/Scorecard";
import { MeetingDetail, Meetings } from "./screens/Meetings";
import { MeetingLive } from "./screens/MeetingLive";
import { MeetingHistory } from "./screens/MeetingHistory";
import { VisionPlan } from "./screens/VisionPlan";
import { ChartScreen } from "./screens/OrgChart";
import { Processes, ProcessDetail } from "./screens/Processes";
import { Checkups, CheckupDetail } from "./screens/Checkups";
import { NotificationSettings } from "./screens/NotificationSettings";

function Gate() {
  const { state } = useSession();
  const [preferSignIn, setPreferSignIn] = useState(false);

  if (state.kind === "loading") return <div className="auth"><p className="muted">Loading…</p></div>;
  if (state.kind === "signed-out") {
    return state.setupNeeded && !preferSignIn ? <Setup onSignInInstead={() => setPreferSignIn(true)} /> : <SignIn />;
  }
  if (state.kind === "no-access") return <NoAccess />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="goals" element={<Goals />} />
          <Route path="goals/:id" element={<GoalDetail />} />
          <Route path="todos" element={<Todos />} />
          <Route path="issues" element={<Issues />} />
          <Route path="headlines" element={<Headlines />} />
          <Route path="bin" element={<RecycleBin />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings/notifications" element={<NotificationSettings />} />
          <Route path="search" element={<Search />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="meetings/:id" element={<MeetingDetail />} />
          <Route path="meetings/:id/live" element={<MeetingLive />} />
          <Route path="meetings/:id/history" element={<MeetingHistory />} />
          <Route path="key-numbers" element={<Scorecard />} />
          <Route path="scorecard" element={<Moved to="/key-numbers" />} />
          <Route path="vision-plan" element={<VisionPlan />} />
          <Route path="org-chart" element={<ChartScreen />} />
          <Route path="chart" element={<Moved to="/org-chart" />} />
          <Route path="processes" element={<Processes />} />
          <Route path="processes/:id" element={<ProcessDetail />} />
          <Route path="checkups" element={<Checkups />} />
          <Route path="checkups/:id" element={<CheckupDetail />} />
          <Route path="insights" element={<Insights />} />
          <Route path="people" element={<People />} />
          <Route path="profile" element={<Profile />} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return <SessionProvider><Gate /></SessionProvider>;
}

/** Old addresses (from bookmarks and earlier notifications) carry on to the renamed screens. */
function Moved({ to }: { to: string }) {
  const rest = useParams()["*"];
  const { search } = useLocation();
  return <Navigate to={`${to}${rest ? `/${rest}` : ""}${search}`} replace />;
}
