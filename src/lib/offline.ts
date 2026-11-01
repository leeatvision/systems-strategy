// Offline support for the app's database calls.
//
// Every Supabase REST call goes through offlineFetch (see supabase.ts):
// * Reads are kept on the device. With no connection, the last copy is used,
//   with any changes still waiting to be sent laid on top.
// * Changes made with no connection are queued on the device and sent, in
//   order, when the connection comes back. New rows get their id here, so they
//   can be opened and edited before they reach the server, and a retry can't
//   create a duplicate.
// * Changes the server refuses on sync are kept aside for the person to see.
// Signing in, files, functions and the database calls that change PINs or
// devices still need a connection.

import { SUPABASE_KEY, SUPABASE_URL } from "./config";
import { moveOfflineChanges } from "./legacy";

const REST = `${SUPABASE_URL}/rest/v1/`;
const DB_NAME = "ss-offline";
// Tables whose key isn't "id": never give their new rows an id.
const NO_ID = new Set(["ss_notification_prefs", "ss_calendar_feeds"]);
// Database functions that only read, so a kept copy is fine offline.
const READ_RPC = new Set(["ss_checkup_results", "ss_checkup_responders", "ss_members_with_pin", "ss_locked_members", "ss_setup_needed", "ss_push_public_key"]);

// What the server fills in for new rows, so items added offline sort and show correctly
// until the real row arrives.
const COMMON = { deleted_at: null, archived_at: null };
const DEFAULTS: Record<string, Record<string, unknown>> = {
  ss_todos: { ...COMMON, status: "open", priority: "normal", is_personal: false, completed_at: null, scheduled_on: null, scheduled_time: null,
    duration_minutes: null, repeat_rule: null, sort_order: 0, source_type: null, description: null },
  ss_issues: { ...COMMON, status: "open", priority: null, sort_order: 0, solved_at: null, source_type: null, description: null },
  ss_headlines: { ...COMMON, status: "to_review", kind: "general", description: null },
  ss_goals: { ...COMMON, status: "on_track", is_live: true, goal_type: "company", description: null },
  ss_goal_steps: { due_on: null, completed_on: null, activity: "" },
  ss_comments: { deleted_at: null, edited_at: null, mentions: [] },
  ss_todo_checklist: { is_done: false, sort_order: 0 },
  ss_processes: { ...COMMON, status: "draft", followed_by_all: null, reviewed_on: null, description: null },
  ss_process_steps: { details: null, title: "" },
  ss_measurable_values: { note: null },
};
const withDefaults = (table: string, row: Record<string, unknown>): Record<string, unknown> => {
  const now = new Date().toISOString();
  return { created_at: now, updated_at: now, ...DEFAULTS[table], ...row };
};

interface Cached { status: number; body: string; range: string | null; at: number }
export interface Queued { id?: number; url: string; method: string; body: string | null; prefer: string | null; accept: string | null; at: number; error?: string }

// ─── IndexedDB, kept tiny ───────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("cache");
      req.result.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      req.result.createObjectStore("failed", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  // First use on this device: bring over unsent changes saved under the app's earlier names.
  }).then(async (d) => {
    await moveOfflineChanges((store, change) => new Promise((done) => {
      const req = d.transaction(store, "readwrite").objectStore(store).add(change);
      req.onsuccess = req.onerror = () => done(null);
    })).catch(() => {});
    return d;
  });
  return dbPromise;
}
async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = run(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const all = <T>(store: string) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);

// ─── Status for the banner ──────────────────────────────────────────────────

export const offlineEvents = new EventTarget();
let syncing = false;
export interface OfflineStatus { online: boolean; waiting: number; failed: number; syncing: boolean }
export async function offlineStatus(): Promise<OfflineStatus> {
  const [q, f] = await Promise.all([all<Queued>("queue").catch(() => []), all<Queued>("failed").catch(() => [])]);
  return { online: navigator.onLine, waiting: q.length, failed: f.length, syncing };
}
const changed = () => offlineEvents.dispatchEvent(new Event("change"));
/** How many changes are waiting, without reading them (checked on every read and write). */
const waitingCount = () => tx<number>("queue", "readonly", (s) => s.count()).catch(() => 0);

// ─── Helpers ────────────────────────────────────────────────────────────────

const headerOf = (h: HeadersInit | undefined, name: string): string | null => new Headers(h).get(name);
const tableOf = (url: URL) => url.pathname.split("/rest/v1/")[1]?.split("/")[0] ?? "";
const isRpc = (url: URL) => url.pathname.includes("/rest/v1/rpc/");
const cacheKey = (method: string, url: string, accept: string | null, body: string | null) =>
  `${method} ${url} ${accept ?? ""} ${method === "POST" ? body ?? "" : ""}`;

function respond(status: number, body: unknown, range?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (range) headers["Content-Range"] = range;
  return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers });
}
const offlineError = (what: string) =>
  respond(503, { message: `You're offline. ${what}`, code: "OFFLINE", details: null, hint: null });

/** Simple PostgREST filters (eq / is.null / neq) a row must pass to belong in a list. */
function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "or", "on_conflict", "columns"].includes(k)) continue;
    const val = row[k];
    if (v.startsWith("eq.")) { if (val === undefined || String(val) !== v.slice(3)) return false; }
    else if (v === "is.null") { if (val !== null && val !== undefined) return false; }
    else if (v === "not.is.null") { if (val === null || val === undefined) return false; }
    else if (v.startsWith("neq.")) { if (val !== undefined && String(val) === v.slice(4)) return false; }
  }
  return true;
}

/** Lay queued changes for a table over a kept list, so offline edits show up. */
async function overlay(url: URL, data: unknown, single: boolean): Promise<unknown> {
  const table = tableOf(url);
  const queue = (await all<Queued>("queue")).filter((q) => tableOf(new URL(q.url)) === table);
  if (!queue.length) return data;
  let rows = (single ? (data ? [data] : []) : (data as Record<string, unknown>[]) ?? []).map((r) => ({ ...(r as object) })) as Record<string, unknown>[];
  for (const q of queue) {
    const qUrl = new URL(q.url);
    const body = q.body ? JSON.parse(q.body) : null;
    if (q.method === "POST") {
      const conflict = qUrl.searchParams.get("on_conflict")?.split(",");
      for (const raw of (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]) {
        const row = withDefaults(table, raw);
        const same = (r: Record<string, unknown>) => (conflict ? conflict.every((c) => r[c] === row[c]) : row.id !== undefined && r.id === row.id);
        const i = rows.findIndex(same);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else if (!single && matches(row, url.searchParams)) rows.push({ ...row });
      }
    } else if (q.method === "PATCH") {
      rows = rows.map((r) => (matches(r, qUrl.searchParams) ? { ...r, ...body } : r));
    } else if (q.method === "DELETE") {
      rows = rows.filter((r) => !matches(r, qUrl.searchParams));
    }
  }
  // Rows changed offline may no longer fit this list (e.g. moved to the recycle bin).
  rows = rows.filter((r) => matches(r, url.searchParams));
  return single ? rows[0] ?? null : rows;
}

/** New rows get an id now, unless the table has no id or the write is an upsert. */
function withIds(url: URL, body: string | null): string | null {
  if (!body || NO_ID.has(tableOf(url)) || url.searchParams.has("on_conflict")) return body;
  try {
    const add = (r: Record<string, unknown>) => (r && typeof r === "object" && !("id" in r) ? { id: crypto.randomUUID(), ...r } : r);
    const parsed = JSON.parse(body);
    return JSON.stringify(Array.isArray(parsed) ? parsed.map(add) : add(parsed));
  } catch { return body; }
}

// ─── The fetch the Supabase client uses ─────────────────────────────────────

export async function offlineFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!href.startsWith(REST)) return fetch(input, init); // sign-in, files, functions: unchanged
  const url = new URL(href);
  const method = (init.method ?? "GET").toUpperCase();
  const accept = headerOf(init.headers, "Accept");
  const prefer = headerOf(init.headers, "Prefer");
  const single = (accept ?? "").includes("vnd.pgrst.object");
  let body = typeof init.body === "string" ? init.body : null;

  const isRead = method === "GET" || method === "HEAD" || (isRpc(url) && READ_RPC.has(url.pathname.split("/rpc/")[1] ?? ""));
  if (isRead) {
    const key = cacheKey(method, href, accept, body);
    if (navigator.onLine) {
      try {
        const res = await fetch(input, init);
        if (res.ok) {
          const text = method === "HEAD" ? "" : await res.clone().text();
          tx("cache", "readwrite", (s) => s.put({ status: res.status, body: text, range: res.headers.get("Content-Range"), at: Date.now() } as Cached, key)).catch(() => {});
        }
        // Reads also lay waiting changes over fresh data until they've synced.
        if (res.ok && method === "GET" && !isRpc(url) && (await waitingCount())) {
          const data = await res.json();
          return respond(res.status, await overlay(url, data, single), res.headers.get("Content-Range"));
        }
        return res;
      } catch { /* fall through to the kept copy */ }
    }
    const kept = await tx<Cached | undefined>("cache", "readonly", (s) => s.get(key) as IDBRequest<Cached | undefined>).catch(() => undefined);
    if (!kept) return offlineError("This hasn't been opened on this device before.");
    if (method === "HEAD") return respond(kept.status, undefined, kept.range);
    const data = kept.body ? JSON.parse(kept.body) : null;
    return respond(kept.status, isRpc(url) ? data : await overlay(url, data, single), kept.range);
  }

  if (isRpc(url)) {
    // Database functions that change things need the server to decide.
    return navigator.onLine ? fetch(input, init) : offlineError("This needs a connection.");
  }

  // A change to a table.
  if (method === "POST") body = withIds(url, body);
  const sendInit = { ...init, body: body ?? init.body };
  if (navigator.onLine && !(await waitingCount())) {
    try { return await fetch(href, sendInit); } catch { /* lost the connection: queue it */ }
  }
  await tx("queue", "readwrite", (s) => s.add({ url: href, method, body, prefer, accept, at: Date.now() } as Queued));
  changed();
  if (navigator.onLine) void syncNow();
  // Answer the way the server would, so the screen carries on.
  if (method === "DELETE") return respond(204, undefined);
  if ((prefer ?? "").includes("return=representation") && body) {
    const rows = JSON.parse(body);
    return respond(method === "POST" ? 201 : 200, single ? (Array.isArray(rows) ? rows[0] : rows) : (Array.isArray(rows) ? rows : [rows]));
  }
  return respond(method === "POST" ? 201 : 204, undefined);
}

// ─── Sending queued changes ─────────────────────────────────────────────────

let tokenSource: () => Promise<string | null> = async () => null;
export function setTokenSource(fn: () => Promise<string | null>) { tokenSource = fn; }

export async function syncNow(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true; changed();
  try {
    const token = await tokenSource();
    if (!token) return;
    for (const q of await all<Queued>("queue")) {
      let res: Response;
      try {
        res = await fetch(q.url, {
          method: q.method, body: q.body,
          headers: {
            apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
            Prefer: (q.prefer ?? "").replace("return=representation", "return=minimal") || "return=minimal",
          },
        });
      } catch { break; } // still no connection: try again later
      if (res.status === 401) break; // signed out or token expired: try after sign-in
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: string };
        // A new row whose id is already there arrived on an earlier try. Any other refusal,
        // including other conflicts, is kept so the person can see what didn't save.
        const arrived = res.status === 409 && detail.code === "23505" && (detail.details ?? "").startsWith("Key (id)=");
        if (!arrived) await tx("failed", "readwrite", (s) => s.add({ ...q, id: undefined, error: detail.message ?? `Error ${res.status}` }));
      }
      await tx("queue", "readwrite", (s) => s.delete(q.id!));
      changed();
    }
  } finally {
    syncing = false; changed();
    offlineEvents.dispatchEvent(new Event("synced"));
  }
}

export const failedChanges = () => all<Queued>("failed");
export async function discardFailed(): Promise<void> { await tx("failed", "readwrite", (s) => s.clear()); changed(); }

/** On sign-out: nothing of this person's stays on the device. */
export async function clearOffline(): Promise<void> {
  await Promise.all(["cache", "queue", "failed"].map((s) => tx(s, "readwrite", (st) => st.clear()).catch(() => {})));
  changed();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { changed(); void syncNow(); });
  window.addEventListener("offline", changed);
  setInterval(() => { void offlineStatus().then((s) => { if (s.waiting) void syncNow(); }); }, 30000);
}
