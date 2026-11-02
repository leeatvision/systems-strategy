import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, useMembers } from "../lib/data";
import { Empty } from "../components/ui";

const TABLES = [
  { table: "ss_goals", label: "Goal" },
  { table: "ss_todos", label: "To-Do" },
  { table: "ss_issues", label: "Issue" },
  { table: "ss_headlines", label: "Headline" },
  { table: "ss_measurables", label: "Key Number" },
  { table: "ss_meetings", label: "Meeting" },
  { table: "ss_processes", label: "Process" },
  { table: "ss_checkups", label: "Checkup", owner: "created_by" },
] as { table: string; label: string; owner?: string }[];

interface Binned { table: string; label: string; id: string; title: string; owner_member_id: string | null; deleted_at: string }

export function RecycleBin() {
  const { isOwner } = useMe();
  const { byId } = useMembers();
  const [items, setItems] = useState<Binned[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const results = await Promise.all(TABLES.map(({ table, label, owner }) =>
      supabase.from(table).select(`id, title, owner_member_id:${owner ?? "owner_member_id"}, deleted_at`).not("deleted_at", "is", null)
        .then(({ data }) => ((data ?? []) as unknown as Omit<Binned, "table" | "label">[]).map((r) => ({ ...r, table, label })))));
    // Past meetings have no title of their own: name them by meeting and date.
    const { data: past } = await supabase.from("ss_meeting_sessions").select("id, started_at, created_by, deleted_at, meeting:ss_meetings(title)").not("deleted_at", "is", null);
    const sessions = ((past ?? []) as unknown as { id: string; started_at: string; created_by: string | null; deleted_at: string; meeting: { title: string } | null }[])
      .map((r) => ({ table: "ss_meeting_sessions", label: "Past meeting", id: r.id, title: `${r.meeting?.title ?? "Meeting"} · ${fmtDay(r.started_at, true)}`, owner_member_id: r.created_by, deleted_at: r.deleted_at }));
    setItems([...results.flat(), ...sessions].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const restore = async (b: Binned) => {
    const { error } = await supabase.from(b.table).update({ deleted_at: null }).eq("id", b.id);
    if (error) setError(friendlyError(error)); else load();
  };
  const destroy = async (b: Binned) => {
    if (!confirm(`Permanently delete "${b.title}"? This can't be undone.`)) return;
    const { error } = await supabase.from(b.table).delete().eq("id", b.id);
    if (error) setError(friendlyError(error)); else load();
  };

  return (
    <div className="stack">
      <h1>Recycle bin</h1>
      <p className="small muted">Anything moved here can be restored. {isOwner ? "As an owner you can also delete permanently." : "Only owners can delete permanently."}</p>
      {error && <p className="error">{error}</p>}
      {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? <Empty>The recycle bin is empty.</Empty> : (
        <ul className="card list">
          {items.map((b) => (
            <li key={b.table + b.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="item-title">{b.title}</div>
                <div className="small muted">{b.label} · {byId(b.owner_member_id)?.first_name ?? "Unassigned"} · binned {fmtDay(b.deleted_at)}</div>
              </div>
              <button className="btn btn-sm" onClick={() => restore(b)}><RotateCcw size={16} />Restore</button>
              {isOwner && <button className="btn btn-sm btn-ghost btn-danger" aria-label="Delete permanently" onClick={() => destroy(b)}><Trash2 size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
