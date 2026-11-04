import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, type Member } from "./supabase";

// ─── Row types ──────────────────────────────────────────────────────────────

export type GoalStatus = "on_track" | "off_track" | "done" | "not_done" | "canceled";
export type GoalType = "company" | "department" | "personal";

export interface Goal {
  id: string;
  company_id: string;
  meeting_id: string | null;
  owner_member_id: string;
  title: string;
  description: string | null;
  goal_type: GoalType;
  is_live: boolean;
  status: GoalStatus;
  quarter: number | null;
  quarter_year: number | null;
  due_date: string | null;
  reviewed_by_member_id: string | null;
  reviewed_by_text: string | null;
  smart_specific: string | null;
  smart_measurable: string | null;
  smart_actionable: string | null;
  smart_reviewable: string | null;
  smart_time_framed: string | null;
  finish_line: string | null;
  finish_line_due: string | null;
  finish_line_completed_on: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalStep {
  id: string;
  goal_id: string;
  sort_order: number;
  due_on: string | null;
  activity: string;
  completed_on: string | null;
}

export interface GoalResource {
  id: string;
  goal_id: string;
  sort_order: number;
  description: string;
}

export interface Todo {
  id: string;
  company_id: string;
  meeting_id: string | null;
  owner_member_id: string;
  title: string;
  description: string | null;
  due_date: string;
  status: "open" | "done";
  completed_at: string | null;
  is_personal: boolean;
  priority: "low" | "normal" | "high";
  scheduled_on: string | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  repeat_rule: RepeatRule | null;
  repeat?: import("./repeat").Repeat | null;
  sort_order: number;
  source_type: string | null;
  source_id: string | null;
  created_in_session_id?: string | null;
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Issue {
  id: string;
  company_id: string;
  meeting_id: string | null;
  owner_member_id: string | null;
  title: string;
  description: string | null;
  status: "open" | "solved";
  priority: number | null;
  sort_order: number;
  solved_at: string | null;
  source_type: string | null;
  source_id: string | null;
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Headline {
  id: string;
  company_id: string;
  meeting_id: string | null;
  owner_member_id: string | null;
  title: string;
  description: string | null;
  kind: "customer" | "employee" | "general";
  status: "to_review" | "reviewed";
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  title: string;
  meeting_type: string;
  cadence: string;
  first_meeting_at: string | null;
  is_leadership: boolean;
  deleted_at: string | null;
}

export type RepeatRule = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly";
export const REPEAT: Record<RepeatRule, string> = {
  daily: "Every day", weekdays: "Every weekday", weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month",
};

export interface ChecklistItem { id: string; todo_id: string; sort_order: number; title: string; is_done: boolean }

// ─── Labels ─────────────────────────────────────────────────────────────────

export const GOAL_STATUS: Record<GoalStatus, { label: string; badge: string }> = {
  on_track: { label: "On track", badge: "badge-green" },
  off_track: { label: "Off track", badge: "badge-danger" },
  done: { label: "Done", badge: "badge-done" },
  not_done: { label: "Not done", badge: "" },
  canceled: { label: "Canceled", badge: "" },
};
export const GOAL_STATUSES = Object.keys(GOAL_STATUS) as GoalStatus[];

export const GOAL_TYPE: Record<GoalType, string> = { company: "Company", department: "Department", personal: "Personal" };

// ─── People ─────────────────────────────────────────────────────────────────

let membersCache: Promise<Member[]> | null = null;

function fetchMembers(): Promise<Member[]> {
  membersCache ??= Promise.resolve(
    supabase.from("ss_members").select("*").order("first_name")
  ).then(({ data }) => (data ?? []) as Member[]);
  return membersCache;
}

/** Everyone in the company, including removed people (so old items still show their owner). */
export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { fetchMembers().then(setMembers); }, []);
  const byId = useCallback((id: string | null | undefined) => members.find((m) => m.id === id), [members]);
  return { members, active: members.filter((m) => m.status === "active"), byId };
}

/** Call after adding or editing people so pickers pick up the change. */
export function forgetMembers() { membersCache = null; }

// ─── Meetings ───────────────────────────────────────────────────────────────

let meetingsCache: Promise<Meeting[]> | null = null;

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    meetingsCache ??= Promise.resolve(
      supabase.from("ss_meetings").select("id, title, meeting_type, cadence, first_meeting_at, is_leadership, deleted_at")
        .is("deleted_at", null).order("created_at")
    ).then(({ data }) => (data ?? []) as Meeting[]);
    meetingsCache.then(setMeetings);
  }, []);
  // New items go to the first Weekly Meeting unless the person picks another meeting.
  const defaultMeeting = meetings.find((m) => m.meeting_type === "weekly") ?? meetings[0];
  return { meetings, defaultMeetingId: defaultMeeting?.id ?? null };
}

/** The next time a recurring meeting happens, from its first date and cadence. */
export function nextMeeting(m: Meeting, now = new Date()): Date | null {
  if (!m.first_meeting_at) return null;
  const first = new Date(m.first_meeting_at);
  const stepDays = m.cadence === "weekly" ? 7 : m.cadence === "biweekly" ? 14 : 0;
  if (first >= now) return first;
  if (!stepDays) return null;
  const step = stepDays * 86400000;
  const n = Math.ceil((now.getTime() - first.getTime()) / step);
  return new Date(first.getTime() + n * step);
}

// ─── Dates (local calendar days as YYYY-MM-DD) ──────────────────────────────

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function today(): string { return isoDay(new Date()); }
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
/** Weeks run Sunday to Saturday everywhere in the app. */
export function startOfWeek(day = today()): string {
  return addDays(day, -new Date(`${day}T12:00:00`).getDay());
}
/** Saturday that ends this Sunday-to-Saturday week. */
export function endOfWeek(day = today()): string {
  return addDays(startOfWeek(day), 6);
}
export function fmtDay(day: string | null | undefined, withYear = false): string {
  if (!day) return "";
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}
export function fmtDateTime(ts: string | Date): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface Quarter { quarter: number; year: number }
export function currentQuarter(d = new Date()): Quarter {
  return { quarter: Math.floor(d.getMonth() / 3) + 1, year: d.getFullYear() };
}
export function shiftQuarter(q: Quarter, by: number): Quarter {
  const i = q.year * 4 + (q.quarter - 1) + by;
  return { quarter: (i % 4) + 1, year: Math.floor(i / 4) };
}
export function quarterEnd(q: Quarter): string {
  return isoDay(new Date(q.year, q.quarter * 3, 0));
}
export const qLabel = (q: Quarter) => `Q${q.quarter} ${q.year}`;

// ─── Plain dates in quick add ("Call supplier fri", "Order parts tomorrow") ──

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

/** Pulls a trailing plain-English date off a title. Returns the cleaned title and the date, if any. */
export function parsePlainDate(input: string, from = today()): { title: string; due: string | null; said: string | null } {
  const text = input.trimEnd();
  const base = new Date(`${from}T12:00:00`);
  const tries: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\s+(?:by\s+|on\s+|due\s+)?today$/i, () => from],
    [/\s+(?:by\s+|on\s+|due\s+)?(?:tomorrow|tmrw|tmr)$/i, () => addDays(from, 1)],
    [/\s+(?:by\s+|due\s+)?next\s+week$/i, () => addDays(from, ((8 - base.getDay()) % 7) || 7)],
    [/\s+(?:by\s+|due\s+)?end\s+of\s+(?:the\s+)?week$/i, () => addDays(from, (5 - base.getDay() + 7) % 7)],
    [/\s+in\s+(\d{1,2})\s+(day|days|week|weeks)$/i, (m) => addDays(from, Number(m[1]) * (m[2].startsWith("week") ? 7 : 1))],
    [/\s+(?:by\s+|on\s+|due\s+)?(next\s+)?([a-z]+)$/i, (m) => {
      const wd = WEEKDAYS[m[2].toLowerCase()];
      if (wd === undefined) return null;
      // "fri" = the coming Friday (today if it is Friday); "next fri" = Friday of next week.
      if (!m[1]) return addDays(from, (wd - base.getDay() + 7) % 7);
      const nextMonday = addDays(from, ((8 - base.getDay()) % 7) || 7);
      return addDays(nextMonday, (wd + 6) % 7);
    }],
    [/\s+(?:by\s+|on\s+|due\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/, (m) => {
      const mo = Number(m[1]), d = Number(m[2]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
      let day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!m[3] && day < from) { y++; day = `${y}${day.slice(4)}`; }
      // Only real dates: 2/30 or 4/31 stay part of the title.
      return isoDay(new Date(y, mo - 1, d)) === day ? day : null;
    }],
  ];
  for (const [re, toDay] of tries) {
    const m = text.match(re);
    if (!m) continue;
    const due = toDay(m);
    if (!due) continue;
    const title = text.slice(0, m.index).trim();
    if (!title) continue;
    return { title, due, said: m[0].trim() };
  }
  return { title: text.trim(), due: null, said: null };
}

// ─── Opening an item from a link (?open=<id>) ───────────────────────────────

/** Opens the item named in ?open= once the list has loaded, fetching it if it isn't in the list. */
export function useOpenParam<T extends { id: string }>(list: T[] | null, table: string, open: (item: T) => void) {
  const [params, setParams] = useSearchParams();
  const id = params.get("open");
  useEffect(() => {
    if (!id || !list) return;
    const go = (item: T | null) => { if (item) open(item); setParams({}, { replace: true }); };
    const found = list.find((x) => x.id === id);
    if (found) go(found);
    else supabase.from(table).select("*").eq("id", id).maybeSingle().then(({ data }) => go(data as T | null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, list]);
}
