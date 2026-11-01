import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useMembers } from "../lib/data";
import { itemLink } from "../lib/notifications";
import { Empty, Section } from "../components/ui";

const KINDS = [
  { table: "ss_goals", type: "goal", label: "Goals", state: (r: Hit) => r.status?.replace("_", " ") },
  { table: "ss_todos", type: "todo", label: "To-Dos", state: (r: Hit) => r.status },
  { table: "ss_issues", type: "issue", label: "Issues", state: (r: Hit) => r.status },
  { table: "ss_headlines", type: "headline", label: "Headlines", state: (r: Hit) => r.status?.replace("_", " ") },
  { table: "ss_processes", type: "process", label: "Processes", state: (r: Hit) => (r.status === "live" ? "in use" : r.status) },
] as const;

interface Hit { id: string; title: string; description: string | null; owner_member_id: string | null; status: string | null }

export function Search() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<Record<string, Hit[]> | null>(null);
  const { byId } = useMembers();
  const navigate = useNavigate();

  useEffect(() => {
    // PostgREST filter syntax uses , ( ) and quotes, so keep only words.
    const term = q.replace(/[^\p{L}\p{N}\s/&'-]/gu, " ").trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      const found = await Promise.all(KINDS.map(({ table }) =>
        supabase.from(table).select("id, title, description, owner_member_id, status").is("deleted_at", null)
          .or(`title.ilike."*${term}*",description.ilike."*${term}*"`).order("created_at", { ascending: false }).limit(25)
          .then(({ data }) => (data ?? []) as Hit[])));
      setResults(Object.fromEntries(KINDS.map((k, i) => [k.type, found[i]])));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const total = results ? Object.values(results).reduce((n, l) => n + l.length, 0) : 0;
  return (
    <div className="stack">
      <h1>Search</h1>
      <label className="row card card-pad" style={{ gap: 8 }}>
        <SearchIcon size={18} color="var(--color-fg-muted)" />
        <input className="input" style={{ border: 0, outline: 0, padding: 0, minHeight: 32 }} autoFocus
          placeholder="Goals, To-Dos, Issues, Headlines, Processes…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {results && total === 0 && <Empty>Nothing matches "{q}".</Empty>}
      {results && KINDS.map(({ type, label, state }) => results[type].length > 0 && (
        <Section key={type} title={label} count={results[type].length}>
          <ul className="card list">
            {results[type].map((r) => (
              <li key={r.id} className="clickable" onClick={() => navigate(itemLink(type, r.id))}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{r.title}</div>
                  <div className="small muted">{byId(r.owner_member_id)?.first_name ?? "Unassigned"} · {state(r)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
