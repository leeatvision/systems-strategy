export type AgendaType = "good_news" | "check_in" | "scorecard" | "goal_review" | "headlines" | "todo_list" | "discuss_solve" | "conclude" | "custom";

export interface AgendaItem {
  id: string;
  meeting_id: string;
  sort_order: number;
  item_type: AgendaType;
  title: string;
  minutes: number;
  fill_time: boolean;
}

export interface MeetingRow {
  id: string;
  company_id: string;
  team_id: string | null;
  title: string;
  meeting_type: "weekly" | "alignment" | "quarterly" | "annual" | "custom";
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "as_needed";
  first_meeting_at: string | null;
  owner_member_id: string | null;
  is_leadership: boolean;
  deleted_at: string | null;
}

export interface Session {
  id: string;
  company_id: string;
  meeting_id: string;
  status: "running" | "ended";
  current_agenda_index: number;
  scribe_member_id: string | null;
  send_recap: boolean;
  clear_done_items: boolean;
  started_at: string;
  ended_at: string | null;
  summary: Recap | null;
  created_by: string | null;
}

export interface SessionAgenda {
  id: string;
  session_id: string;
  sort_order: number;
  item_type: AgendaType;
  title: string;
  minutes: number;
  started_at: string | null;
  seconds_spent: number;
}

export interface Attendee { id: string; session_id: string; member_id: string; joined_at: string; rating: number | null }

export interface SessionEvent {
  id: string;
  item_type: "goal" | "todo" | "issue" | "headline" | "measurable";
  item_id: string;
  action: "added" | "discussed" | "solved" | "reviewed" | "done" | "dropped_to_issues";
  member_id: string | null;
  created_at: string;
}

/** Frozen at the end of a meeting and shown in its history. */
export interface Recap {
  minutes: number;
  average_rating: number | null;
  ratings: { member_id: string; rating: number | null }[];
  attendees: string[];
  issues_solved: { id: string; title: string }[];
  todos_created: { id: string; title: string; owner_member_id: string; due_date: string }[];
  todos_done: number;
  todos_total: number;
  headlines: number;
}

export const AGENDA_LABEL: Record<AgendaType, string> = {
  good_news: "Good News", check_in: "Check-in", scorecard: "Scorecard", goal_review: "Goal Review", headlines: "Headlines",
  todo_list: "To-Do list", discuss_solve: "Discuss & Solve", conclude: "Conclude", custom: "Custom section",
};

export const MEETING_TYPE: Record<MeetingRow["meeting_type"], string> = {
  weekly: "Weekly Meeting", alignment: "Alignment Meeting", quarterly: "Quarterly", annual: "Annual", custom: "Custom",
};
export const CADENCE: Record<MeetingRow["cadence"], string> = {
  weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month", quarterly: "Every quarter", yearly: "Every year", as_needed: "As needed",
};

/** Standard 90-minute weekly agenda, used for new meetings. */
export const STANDARD_AGENDA: { item_type: AgendaType; title: string; minutes: number; fill_time?: boolean }[] = [
  { item_type: "good_news", title: "Good News", minutes: 5 },
  { item_type: "scorecard", title: "Scorecard", minutes: 5 },
  { item_type: "goal_review", title: "Goal Review", minutes: 5 },
  { item_type: "headlines", title: "Headlines", minutes: 5 },
  { item_type: "todo_list", title: "To-Do list", minutes: 5 },
  { item_type: "discuss_solve", title: "Discuss & Solve", minutes: 60, fill_time: true },
  { item_type: "conclude", title: "Conclude", minutes: 5 },
];

export const mmss = (secs: number) => {
  const s = Math.abs(Math.round(secs));
  return `${secs < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
