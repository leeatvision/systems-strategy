import { useEffect, useState } from "react";
import { fullName, supabase, type Member } from "../lib/supabase";
import { fmtDateTime } from "../lib/data";

interface LogRow {
  id: number;
  table_name: string;
  action: "insert" | "update" | "delete";
  member_id: string | null;
  changed_at: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

const LABELS: Record<string, string> = {
  title: "title", description: "description", owner_member_id: "owner", status: "status", goal_type: "type",
  is_live: "draft/live", quarter: "quarter", quarter_year: "quarter", due_date: "due date", meeting_id: "meeting",
  reviewed_by_member_id: "reviewed by", reviewed_by_text: "reviewed by",
  smart_specific: "Specific", smart_measurable: "Measurable", smart_actionable: "Actionable",
  smart_reviewable: "Reviewable", smart_time_framed: "Time-framed",
  finish_line: "finish line", finish_line_due: "finish line date", finish_line_completed_on: "finish line reached",
  deleted_at: "recycle bin", archived_at: "archive", is_personal: "personal", priority: "priority",
  solved_at: "resolved date", completed_at: "completed date", kind: "kind",
  activity: "activity", due_on: "date", completed_on: "done date", sort_order: "order",
  followed_by_all: "followed by all", reviewed_on: "review date", details: "details",
};
const IGNORE = new Set(["updated_at", "created_at", "entered_at"]);
const MAIN = new Set(["ss_goals", "ss_todos", "ss_issues", "ss_headlines", "ss_processes"]);

function describe(r: LogRow): string {
  const child = !MAIN.has(r.table_name);
  const what = child ? "step" : "item";
  const name = String((r.new_row ?? r.old_row)?.activity ?? (r.new_row ?? r.old_row)?.title ?? "").slice(0, 60);
  if (r.action === "insert") return child ? `added ${what}${name ? ` "${name}"` : ""}` : "created it";
  if (r.action === "delete") return child ? `removed ${what}${name ? ` "${name}"` : ""}` : "deleted it permanently";
  const changed = Object.keys(r.new_row ?? {}).filter((k) => !IGNORE.has(k) &&
    JSON.stringify(r.new_row?.[k]) !== JSON.stringify(r.old_row?.[k]));
  if (changed.includes("deleted_at")) return r.new_row?.deleted_at ? "moved it to the recycle bin" : "restored it";
  if (changed.length === 1 && changed[0] === "status") return `set status to ${String(r.new_row?.status).replace("_", " ")}`;
  const names = [...new Set(changed.map((k) => LABELS[k] ?? k.replace(/_/g, " ")))];
  return `${child ? `edited ${what}${name ? ` "${name}"` : ""}: ` : "changed "}${names.join(", ")}`;
}

/** Change history for one item, and optionally its child rows (e.g. a Goal's steps). */
export function History({ table, rowId, childKey, members }: { table: string; rowId: string; childKey?: string; members: Member[] }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);

  useEffect(() => {
    let filter = `and(table_name.eq.${table},row_id.eq.${rowId})`;
    if (childKey) filter += `,new_row->>${childKey}.eq.${rowId},old_row->>${childKey}.eq.${rowId}`;
    supabase.from("ss_activity_log").select("id, table_name, action, member_id, changed_at, old_row, new_row")
      .or(filter).order("changed_at", { ascending: false }).limit(60)
      .then(({ data }) => setRows((data ?? []) as LogRow[]));
  }, [table, rowId, childKey]);

  if (!rows) return <p className="small muted">Loading…</p>;
  // Drop no-op updates, where only a timestamp moved.
  const shown = rows.filter((r) => r.action !== "update" || Object.keys(r.new_row ?? {}).some((k) =>
    !IGNORE.has(k) && JSON.stringify(r.new_row?.[k]) !== JSON.stringify(r.old_row?.[k])));
  if (!shown.length) return <p className="small muted">No changes yet.</p>;

  return (
    <ul className="history">
      {shown.map((r) => {
        const who = members.find((m) => m.id === r.member_id);
        return (
          <li key={r.id}>
            <span className="small muted">{fmtDateTime(r.changed_at)}</span>
            <span><strong>{who ? fullName(who) : "Import"}</strong> {describe(r)}</span>
          </li>
        );
      })}
    </ul>
  );
}
