import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { discardFailed, failedChanges, offlineEvents, offlineStatus, syncNow, type OfflineStatus, type Queued } from "../lib/offline";
import { Sheet } from "./Sheet";

const describe = (q: Queued) => {
  const table = new URL(q.url).pathname.split("/rest/v1/")[1]?.replace("ss_", "").replace(/_/g, " ") ?? "item";
  const verb = q.method === "POST" ? "Add" : q.method === "DELETE" ? "Remove" : "Change";
  let title = "";
  try { const b = q.body ? JSON.parse(q.body) : null; title = (Array.isArray(b) ? b[0] : b)?.title ?? ""; } catch { /* not JSON */ }
  return `${verb} ${table}${title ? `: “${title}”` : ""}`;
};

/** A thin strip under the header: offline, changes waiting, syncing, or changes the server refused. */
export function OfflineBanner() {
  const [s, setS] = useState<OfflineStatus | null>(null);
  const [failed, setFailed] = useState<Queued[] | null>(null);

  useEffect(() => {
    const update = () => { void offlineStatus().then(setS); };
    update();
    offlineEvents.addEventListener("change", update);
    return () => offlineEvents.removeEventListener("change", update);
  }, []);
  // Screens reload their data after a sync so ids and server values come through.
  useEffect(() => {
    const reload = () => window.dispatchEvent(new Event("ss:synced"));
    offlineEvents.addEventListener("synced", reload);
    return () => offlineEvents.removeEventListener("synced", reload);
  }, []);

  if (!s || (s.online && !s.waiting && !s.failed && !s.syncing)) return null;
  return (
    <>
      <div className={`offline-banner${s.failed ? " has-failed" : ""}`} role="status">
        {!s.online ? <CloudOff size={16} /> : s.syncing ? <RefreshCw size={16} className="spin" /> : s.failed ? <TriangleAlert size={16} /> : <RefreshCw size={16} />}
        <span style={{ flex: 1 }}>
          {!s.online ? `Offline${s.waiting ? ` · ${s.waiting} change${s.waiting === 1 ? "" : "s"} saved on this device` : " · showing what was last loaded"}`
            : s.syncing ? "Sending your offline changes…"
            : s.waiting ? `${s.waiting} change${s.waiting === 1 ? "" : "s"} waiting to send`
            : `${s.failed} offline change${s.failed === 1 ? "" : "s"} couldn't be saved`}
        </span>
        {s.online && s.waiting > 0 && !s.syncing && <button className="link-btn" onClick={() => syncNow()}>Send now</button>}
        {s.failed > 0 && <button className="link-btn" onClick={() => failedChanges().then(setFailed)}>Details</button>}
      </div>
      {failed && (
        <Sheet title="Changes that couldn't be saved" onClose={() => setFailed(null)}>
          <div className="stack">
            <p className="small muted">These were made offline, but the server refused them when they were sent, usually because someone else changed or removed the same thing first.</p>
            <ul className="card list">{failed.map((f) => (
              <li key={f.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span className="item-title">{describe(f)}</span>
                <span className="small muted">{new Date(f.at).toLocaleString()} · {f.error}</span>
              </li>
            ))}</ul>
            <button className="btn" onClick={async () => { await discardFailed(); setFailed(null); }}>Dismiss</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
