import { useState } from "react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { isoDay, qLabel, quarterEnd, shiftQuarter, useMembers, type Quarter, type Goal, type GoalStep } from "../lib/data";
import { Avatar, Chips } from "./ui";
import { Sheet } from "./Sheet";

type Choice = "done" | "not_done" | "carry" | "leave";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "done", label: "Done" }, { value: "not_done", label: "Not done" }, { value: "carry", label: "Carry over" }, { value: "leave", label: "Leave" },
];

/**
 * End-of-quarter wrap-up for the Goals still on or off track: mark each one done or not done, or carry
 * it into next quarter. Carrying over makes a new Goal next quarter with the same plan, its unfinished
 * steps and its resources, and marks this quarter's Goal not done, so each quarter's record stays true.
 */
export function QuarterClose({ q, goals, onClose, onDone }: { q: Quarter; goals: Goal[]; onClose: () => void; onDone: () => void }) {
  const { me, company } = useMe();
  const { byId } = useMembers();
  const next = shiftQuarter(q, 1);
  const nextStart = isoDay(new Date(next.year, (next.quarter - 1) * 3, 1));
  // A Goal still on track at the end is usually done; one off track usually carries on.
  const [choice, setChoice] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(goals.map((r) => [r.id, r.status === "on_track" ? "done" : "carry"])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const count = (c: Choice) => goals.filter((r) => choice[r.id] === c).length;

  /** Starts the Goal again next quarter; returns the new Goal's id. */
  const copyGoal = async (r: Goal): Promise<string> => {
    const note = `Carried over from ${qLabel(q)}.`;
    const { data: copy, error } = await supabase.from("ss_goals").insert({
      company_id: company.id, created_by: me.id, meeting_id: r.meeting_id, owner_member_id: r.owner_member_id, title: r.title,
      description: r.description ? `${r.description}\n\n${note}` : note, goal_type: r.goal_type, is_live: r.is_live, status: "on_track",
      quarter: next.quarter, quarter_year: next.year, due_date: quarterEnd(next),
      reviewed_by_member_id: r.reviewed_by_member_id, reviewed_by_text: r.reviewed_by_text,
      smart_specific: r.smart_specific, smart_measurable: r.smart_measurable, smart_actionable: r.smart_actionable,
      smart_reviewable: r.smart_reviewable, smart_time_framed: r.smart_time_framed, finish_line: r.finish_line,
      finish_line_due: r.finish_line_due && r.finish_line_due >= nextStart ? r.finish_line_due : null,
    }).select("id").single();
    if (error) throw error;
    return copy.id as string;
  };

  /** Copies the unfinished steps and the resources onto the new Goal. */
  const copyParts = async (r: Goal, copyId: string) => {
    const [{ data: steps, error: stepsError }, { data: resources, error: resError }] = await Promise.all([
      supabase.from("ss_goal_steps").select("*").eq("goal_id", r.id).is("completed_on", null).order("sort_order"),
      supabase.from("ss_goal_resources").select("*").eq("goal_id", r.id).order("sort_order"),
    ]);
    if (stepsError) throw stepsError;
    if (resError) throw resError;
    if (steps?.length) {
      const { error: e } = await supabase.from("ss_goal_steps").insert((steps as GoalStep[]).map((s, i) => ({
        company_id: company.id, goal_id: copyId, sort_order: i + 1, activity: s.activity,
        due_on: s.due_on && s.due_on >= nextStart ? s.due_on : null,
      })));
      if (e) throw e;
    }
    if (resources?.length) {
      const { error: e } = await supabase.from("ss_goal_resources").insert((resources as { description: string }[]).map((x, i) => ({
        company_id: company.id, goal_id: copyId, sort_order: i + 1, description: x.description,
      })));
      if (e) throw e;
    }
  };

  const apply = async () => {
    setBusy(true); setError("");
    const partsMissing: string[] = [];
    try {
      for (const r of goals) {
        const c = choice[r.id];
        if (c === "leave") continue;
        // For a carry-over, the original is marked not done straight after the copy exists,
        // so trying again after a problem never makes a second copy.
        const copyId = c === "carry" ? await copyGoal(r) : null;
        const status = c === "done" ? "done" : "not_done";
        const { error } = await supabase.from("ss_goals")
          .update({ status, completed_at: status === "done" ? new Date().toISOString() : null }).eq("id", r.id);
        if (error) throw error;
        if (copyId) await copyParts(r, copyId).catch(() => partsMissing.push(r.title));
      }
      if (partsMissing.length) alert(`Carried over, but the steps or resources of ${partsMissing.join(", ")} didn't copy. Add them on the new Goal in ${qLabel(next)}.`);
      onDone();
    } catch (e) {
      // Goals already handled keep their new status; running it again only offers what's still open.
      setError(`${friendlyError(e)} Some Goals may already be updated; close this and try again for the rest.`);
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Close out ${qLabel(q)}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          For each Goal still on or off track, choose what happened. <strong>Carry over</strong> starts it again in {qLabel(next)} with its
          plan, unfinished steps and resources, and marks this one not done.
        </p>
        <ul className="list close-list">
          {goals.map((r) => (
            <li key={r.id} className="stack" style={{ alignItems: "stretch", gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <Avatar m={byId(r.owner_member_id)} size={24} />
                <span className="item-title" style={{ flex: 1, minWidth: 0 }}>{r.title}</span>
                <span className={`badge ${r.status === "off_track" ? "badge-red" : "badge-green"}`}>{r.status === "off_track" ? "Off track" : "On track"}</span>
              </div>
              <Chips value={choice[r.id]} options={CHOICES} onChange={(v) => setChoice({ ...choice, [r.id]: v })} />
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
        <p className="small muted">
          {[count("done") && `${count("done")} done`, count("not_done") && `${count("not_done")} not done`,
            count("carry") && `${count("carry")} carried into ${qLabel(next)}`, count("leave") && `${count("leave")} left as is`].filter(Boolean).join(" · ")}
        </p>
        <button className="btn btn-primary" disabled={busy || count("leave") === goals.length} onClick={apply}>{busy ? "Saving…" : `Close out ${qLabel(q)}`}</button>
      </div>
    </Sheet>
  );
}
