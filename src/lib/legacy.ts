import brand from "../brand/brand.json";

// Carries saved data on this device over from names the app used before (listed in the brand's
// optional "legacy" section): remembered settings, and changes made offline that haven't been sent.
// Runs once per device; without a legacy section it does nothing.

interface Legacy {
  storagePrefix?: string;
  storageKeys?: Record<string, string>;
  offlineDatabase?: string;
  tablePrefix?: [string, string];
  tables?: Record<string, string>;
  columns?: Record<string, string>;
  codes?: Record<string, Record<string, string>>;
}
interface QueuedChange { url: string; method: string; body: string | null; prefer: string | null; accept: string | null; at: number; error?: string }

const legacy = (brand as unknown as { legacy?: Legacy }).legacy;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** New table name for an old one. */
function table(name: string): string {
  if (legacy?.tables?.[name]) return legacy.tables[name];
  const [from, to] = legacy?.tablePrefix ?? ["", ""];
  return from && name.startsWith(from) ? to + name.slice(from.length) : name;
}

/** An old request address with new table, column and stored-code names. */
function renameUrl(url: string): string {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/(rest\/v1(?:\/rpc)?)\/([a-z_]+)/, (_, base: string, name: string) => `/${base}/${table(name)}`);
  let q = u.search;
  for (const [from, to] of Object.entries(legacy?.columns ?? {})) q = q.replace(new RegExp(`\\b${escape(from)}\\b`, "g"), to);
  for (const [field, map] of Object.entries(legacy?.codes ?? {})) {
    for (const [from, to] of Object.entries(map)) q = q.replace(new RegExp(`\\b${escape(field)}=(eq|neq)\\.${escape(from)}\\b`, "g"), `${field}=$1.${to}`);
  }
  u.search = q;
  return u.toString();
}

/** An old change body with new column names and stored codes; people's own text is left as typed. */
function renameRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[legacy?.columns?.[key] ?? key] = value;
  for (const [field, map] of Object.entries(legacy?.codes ?? {})) {
    const v = out[field];
    if (typeof v === "string" && map[v]) out[field] = map[v];
  }
  return out;
}
function renameBody(body: string | null): string | null {
  if (!body) return body;
  try {
    const data = JSON.parse(body);
    return JSON.stringify(Array.isArray(data) ? data.map(renameRow) : renameRow(data));
  } catch { return body; }
}

function moveSettings() {
  const prefix = legacy?.storagePrefix;
  if (!prefix) return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      let rest = key.slice(prefix.length);
      for (const [from, to] of Object.entries(legacy?.storageKeys ?? {})) if (rest === from) rest = to;
      const newKey = `ss.${rest}`;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, localStorage.getItem(key) ?? "");
      localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
}

/** Opens the old offline store if it exists (without creating it). */
function openOld(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let created = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { created = true; req.transaction?.abort(); };
    req.onsuccess = () => resolve(created ? null : req.result);
    req.onerror = () => resolve(null);
  });
}
const readAll = (db: IDBDatabase, store: string) => new Promise<QueuedChange[]>((resolve) => {
  if (!db.objectStoreNames.contains(store)) return resolve([]);
  const req = db.transaction(store, "readonly").objectStore(store).getAll();
  req.onsuccess = () => resolve(req.result as QueuedChange[]);
  req.onerror = () => resolve([]);
});

/**
 * Moves unsent offline changes from the old store into the current one (in order, renamed), then
 * deletes the old store. Cached reads aren't moved: they're refetched.
 */
export async function moveOfflineChanges(add: (store: "queue" | "failed", change: QueuedChange) => Promise<unknown>): Promise<void> {
  moveSettings();
  const name = legacy?.offlineDatabase;
  if (!name || typeof indexedDB === "undefined") return;
  const old = await openOld(name);
  if (!old) return;
  for (const store of ["queue", "failed"] as const) {
    for (const change of await readAll(old, store)) {
      const { url, method, body, prefer, accept, at, error } = change;
      await add(store, { url: renameUrl(url), method, body: renameBody(body), prefer, accept, at, ...(error ? { error } : {}) });
    }
  }
  old.close();
  await new Promise((resolve) => { const del = indexedDB.deleteDatabase(name); del.onsuccess = del.onerror = del.onblocked = () => resolve(null); });
}
