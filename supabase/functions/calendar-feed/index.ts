// Calendar feed: a read-only .ics subscription for one person.
//
// GET /functions/v1/calendar-feed?token=<private token from ss_calendar_feeds>
//
// Calendar apps (Google, Outlook, Apple) fetch this without signing in, so the
// private token is the only key: it is 48 random hex characters, each person
// can reset theirs from My profile, and it only ever returns that person's own
// open To-Dos and the meetings they are invited to. Deploy with verify_jwt off.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (d: string) => d.slice(0, 10).replace(/-/g, "");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Wall-clock time in the company's time zone, so weekly meetings keep their local hour across daylight saving.
const local = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
};
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

// Lines longer than 75 octets must be folded (RFC 5545 §3.1).
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Use GET", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{32,128}$/.test(token)) return notFound();

  const { data: feed } = await db.from("ss_calendar_feeds").select("member_id, company_id").eq("token", token).maybeSingle();
  if (!feed) return notFound();
  const { data: member } = await db.from("ss_members").select("id, status").eq("id", feed.member_id).maybeSingle();
  if (!member || member.status !== "active") return notFound();
  const { data: company } = await db.from("ss_companies").select("name, time_zone").eq("id", feed.company_id).single();
  const tz = company?.time_zone ?? "America/Denver";

  const [{ data: todos }, { data: invites }] = await Promise.all([
    db.from("ss_todos").select("id, title, description, due_date")
      .eq("owner_member_id", feed.member_id).eq("status", "open").is("deleted_at", null).is("archived_at", null),
    db.from("ss_meeting_invitees").select("meeting_id").eq("member_id", feed.member_id),
  ]);
  const meetingIds = (invites ?? []).map((i) => i.meeting_id);
  const { data: meetings } = meetingIds.length
    ? await db.from("ss_meetings").select("id, title, cadence, first_meeting_at").in("id", meetingIds).is("deleted_at", null)
    : { data: [] };
  const { data: agenda } = meetingIds.length
    ? await db.from("ss_agenda_items").select("meeting_id, minutes").in("meeting_id", meetingIds)
    : { data: [] };

  const stamp = utc(new Date());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Systems Strategy//Calendar feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`${company?.name ?? "Team"} To-Dos & meetings`)}`, `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];

  for (const t of todos ?? []) {
    // An all-day item on the To-Do's due date.
    const ev = ["BEGIN:VEVENT", `UID:todo-${t.id}@systems-strategy`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(t.due_date)}`, `DTEND;VALUE=DATE:${day(nextDay(t.due_date))}`,
      `SUMMARY:${esc(`Due: ${t.title}`)}`, "TRANSP:TRANSPARENT"];
    const note = t.description ?? "";
    ev.push(`DESCRIPTION:${esc(note)}`, "END:VEVENT");
    lines.push(...ev);
  }

  for (const m of meetings ?? []) {
    if (!m.first_meeting_at) continue;
    const minutes = (agenda ?? []).filter((a) => a.meeting_id === m.id).reduce((n, a) => n + a.minutes, 0) || 90;
    const start = new Date(m.first_meeting_at);
    const rules: Record<string, string> = { weekly: "FREQ=WEEKLY", biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY", quarterly: "FREQ=MONTHLY;INTERVAL=3", yearly: "FREQ=YEARLY" };
    const rule = rules[m.cadence];
    lines.push("BEGIN:VEVENT", `UID:meeting-${m.id}@systems-strategy`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${local(start, tz)}`, `DTEND;TZID=${tz}:${local(new Date(start.getTime() + minutes * 60000), tz)}`, `SUMMARY:${esc(m.title)}`,
      ...(rule ? [`RRULE:${rule}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
});
