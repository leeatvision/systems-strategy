import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, CircleAlert, ListChecks, Lock, LockOpen, Plus, Trash2, X } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, useMeetings, useMembers } from "../lib/data";
import { Chips, Empty, Menu, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Kind = string;
interface CheckupType { id: string; key: string; name: string; built_in: boolean; is_one_off: boolean; sort_order: number; deleted_at: string | null }
interface Checkup {
  id: string; company_id: string; title: string; kind: Kind; anonymous: boolean; status: "open" | "closed";
  closed_at: string | null; deleted_at: string | null; created_at: string;
}
interface Question { id: string; checkup_id: string; sort_order: number; text: string; group_title: string | null }
interface Line { group_title: string | null; text: string }
interface Answer { id: string; question_id: string; score: number | null; comment: string | null }
interface Result { question_id: string; answered: number; average: number | null; spread: number[]; comments: { text: string; member_id: string | null }[] }

const SCALE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const pct = (avg: number | null) => (avg === null ? null : Math.round(((avg - 1) / 4) * 100));
const scoreClass = (p: number | null) => (p === null ? "" : p >= 75 ? "badge-green" : p >= 50 ? "badge-warn" : "badge-danger");

/** Questions as editable text: one per line, with "# Heading" lines for groups. */
function toText(lines: Line[]): string {
  let group: string | null = null;
  const out: string[] = [];
  for (const l of lines) {
    if (l.group_title && l.group_title !== group) { if (out.length) out.push(""); out.push(`# ${l.group_title}`); }
    group = l.group_title;
    out.push(l.text);
  }
  return out.join("\n");
}
function fromText(text: string): Line[] {
  let group: string | null = null;
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) { group = line.replace(/^#+\s*/, "") || null; continue; }
    out.push({ group_title: group, text: line });
  }
  return out;
}
/** A heading above the first question of each group. */
const groupStart = (qs: Line[], i: number) => qs[i].group_title && qs[i].group_title !== qs[i - 1]?.group_title ? qs[i].group_title : null;

/** The company's checkup types (built-in and their own), with a name lookup that also covers removed types. */
function useCheckupTypes() {
  const [types, setTypes] = useState<CheckupType[]>([]);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("ss_checkup_types").select("*").order("sort_order").order("created_at");
    setTypes((data ?? []) as CheckupType[]);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const nameOf = (key: string) => types.find((t) => t.key === key)?.name ?? "Checkup";
  return { types, active: types.filter((t) => !t.deleted_at), nameOf, reload };
}

/** Overall score as a percentage (1 = 0%, 5 = 100%), from per-question averages. */
function overall(results: Result[]): number | null {
  const avgs = results.map((r) => r.average).filter((x): x is number => x !== null);
  return avgs.length ? pct(avgs.reduce((a, b) => a + Number(b), 0) / avgs.length) : null;
}

export function Checkups() {
  const navigate = useNavigate();
  const [list, setList] = useState<Checkup[] | null>(null);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [standard, setStandard] = useState(false);
  const checkupTypes = useCheckupTypes();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ss_checkups").select("*").is("deleted_at", null).order("created_at", { ascending: false });
      const cs = (data ?? []) as Checkup[];
      setList(cs);
      const { data: a } = await supabase.from("ss_checkup_answers").select("checkup_id");
      setMine(new Set(((a ?? []) as { checkup_id: string }[]).map((x) => x.checkup_id)));
      const pairs = await Promise.all(cs.map(async (c) => {
        const { data: r } = await supabase.rpc("ss_checkup_results", { p_checkup: c.id });
        return [c.id, overall((r ?? []) as Result[])] as const;
      }));
      setScores(Object.fromEntries(pairs));
    })();
  }, []);

  const open = (list ?? []).filter((c) => c.status === "open");
  const closed = (list ?? []).filter((c) => c.status === "closed");
  const row = (c: Checkup) => (
    <li key={c.id} className="clickable" onClick={() => navigate(`/checkups/${c.id}`)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{c.title}</div>
        <div className="small muted">{checkupTypes.nameOf(c.kind)} · {fmtDay(c.created_at, true)}{c.anonymous ? " · anonymous" : ""}
          {c.status === "open" && (mine.has(c.id) ? " · you've answered" : " · waiting for your answers")}</div>
      </div>
      {scores[c.id] != null && <span className={`badge ${scoreClass(scores[c.id]!)}`}>{scores[c.id]}%</span>}
    </li>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Checkups</h1>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} />New Checkup</button>
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => setStandard(true)}><ListChecks size={16} />Checkup Types and Standard Questions</button>
      </div>
      <p className="small muted">A quick, honest read on how things are going. Each type asks its Standard Questions every time so results compare; Other is for one-off checkups.</p>
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty>No checkups yet.</Empty> : <>
        {open.length > 0 && <Section title="Open" count={open.length}><ul className="card list">{open.map(row)}</ul></Section>}
        {closed.length > 0 && <Section title="Closed" count={closed.length}><ul className="card list">{closed.map(row)}</ul></Section>}
      </>}
      {standard && <CheckupTypes checkupTypes={checkupTypes} onClose={() => setStandard(false)} />}
      {creating && <NewCheckup types={checkupTypes.active} previous={list ?? []} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/checkups/${id}`)} />}
    </div>
  );
}

function NewCheckup({ types, previous, onClose, onCreated }: { types: CheckupType[]; previous: Checkup[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { me, company } = useMe();
  const [form, setForm] = useState({ title: "", kind: "org" as Kind, anonymous: true, questions: "" });
  const [error, setError] = useState("");
  const last = previous.find((c) => c.kind === form.kind);
  const type = types.find((t) => t.key === form.kind);

  // Each type starts from its Standard Questions; they can still be changed for this checkup. One-off types start empty.
  useEffect(() => {
    let live = true;
    if (type?.is_one_off) { setForm((f) => ({ ...f, questions: "" })); return; }
    supabase.from("ss_checkup_standard_questions").select("group_title, text").eq("kind", form.kind).order("sort_order")
      .then(({ data }) => { if (live) setForm((f) => ({ ...f, questions: toText((data ?? []) as Line[]) })); });
    return () => { live = false; };
  }, [form.kind, type?.is_one_off]);

  const copyLast = async () => {
    if (!last) return;
    const { data } = await supabase.from("ss_checkup_questions").select("group_title, text").eq("checkup_id", last.id).order("sort_order");
    setForm({ ...form, questions: toText((data ?? []) as Line[]) });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const qs = fromText(form.questions);
    if (!qs.length) { setError("Add at least one question."); return; }
    const { data, error } = await supabase.from("ss_checkups")
      .insert({ company_id: company.id, title: form.title.trim(), kind: form.kind, anonymous: form.anonymous, created_by: me.id }).select("id").single();
    if (error) { setError(friendlyError(error)); return; }
    const { error: qErr } = await supabase.from("ss_checkup_questions")
      .insert(qs.map((q, i) => ({ company_id: company.id, checkup_id: data.id, sort_order: i + 1, text: q.text, group_title: q.group_title })));
    if (qErr) { setError(friendlyError(qErr)); return; }
    onCreated(data.id);
  };

  return (
    <Sheet title="New checkup" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Name</span>
          <input className="input" required placeholder={`e.g. ${type?.name ?? "Organisation"} checkup, Q4 2026`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <Chips value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={types.map((t) => ({ value: t.key, label: t.name }))} />
        <label className="field"><span>Questions <span className="muted" style={{ fontWeight: 400 }}>· {type?.is_one_off ? "write the questions for this one-off checkup" : "from this type's Standard Questions; change them for this checkup if you need to"}</span></span>
          <textarea className="input textarea" rows={10} placeholder={"We're clear on where we're going and how we'll get there.\nEveryone knows their top priorities this quarter.\nWe solve problems instead of talking around them."}
            value={form.questions} onChange={(e) => setForm({ ...form, questions: e.target.value })} />
        </label>
        <p className="small muted">One statement per line, written so people can agree or disagree. Start a line with # for a group heading.</p>
        {last && <button type="button" className="btn btn-sm" onClick={copyLast}>Use the questions from “{last.title}” instead</button>}
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.anonymous} onChange={(e) => setForm({ ...form, anonymous: e.target.checked })} />
          Anonymous: results never show who answered what
        </label>
        <p className="small muted">With only a few people, anonymous results can still be guessed. Nobody can read anyone else's answers either way.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">Create and answer</button>
      </form>
    </Sheet>
  );
}

export function CheckupDetail() {
  const { id } = useParams();
  const { me, company } = useMe();
  const { byId } = useMembers();
  const { defaultMeetingId } = useMeetings();
  const navigate = useNavigate();
  const { nameOf } = useCheckupTypes();
  const [c, setC] = useState<Checkup | null>(null);
  const [raised, setRaised] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [previous, setPrevious] = useState<{ title: string; byText: Record<string, number | null>; overall: number | null } | null>(null);
  const [responders, setResponders] = useState<{ responders: number; member_ids: string[] | null } | null>(null);
  const [tab, setTab] = useState<"answer" | "results">("answer");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: ck }, { data: qs }, { data: as }, { data: rs }, { data: rp }] = await Promise.all([
      supabase.from("ss_checkups").select("*").eq("id", id).maybeSingle(),
      supabase.from("ss_checkup_questions").select("*").eq("checkup_id", id).order("sort_order"),
      supabase.from("ss_checkup_answers").select("id, question_id, score, comment").eq("checkup_id", id),
      supabase.rpc("ss_checkup_results", { p_checkup: id }),
      supabase.rpc("ss_checkup_responders", { p_checkup: id }),
    ]);
    if (!ck) { setError("That checkup wasn't found."); return; }
    const checkup = ck as Checkup;
    setC(checkup);
    setQuestions((qs ?? []) as Question[]);
    setAnswers((as ?? []) as Answer[]);
    setResults((rs ?? []) as Result[]);
    setResponders(((rp ?? []) as { responders: number; member_ids: string[] | null }[])[0] ?? null);
    if (checkup.status === "closed") setTab((t) => (t === "answer" ? "results" : t));
    // The previous checkup of the same kind, for the trend.
    const { data: prev } = await supabase.from("ss_checkups").select("id, title").eq("kind", checkup.kind).is("deleted_at", null)
      .lt("created_at", checkup.created_at).order("created_at", { ascending: false }).limit(1);
    const p = ((prev ?? []) as { id: string; title: string }[])[0];
    if (p) {
      const [{ data: pq }, { data: pr }] = await Promise.all([
        supabase.from("ss_checkup_questions").select("id, text").eq("checkup_id", p.id),
        supabase.rpc("ss_checkup_results", { p_checkup: p.id }),
      ]);
      const res = (pr ?? []) as Result[];
      const byText: Record<string, number | null> = {};
      for (const q of (pq ?? []) as { id: string; text: string }[]) byText[q.text.trim().toLowerCase()] = res.find((r) => r.question_id === q.id)?.average ?? null;
      setPrevious({ title: p.title, byText, overall: overall(res) });
    } else setPrevious(null);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const answer = async (q: Question, change: Partial<Answer>) => {
    const existing = answers.find((a) => a.question_id === q.id);
    setAnswers((l) => existing ? l.map((a) => (a.id === existing.id ? { ...a, ...change } : a)) : [...l, { id: `tmp-${q.id}`, question_id: q.id, score: null, comment: null, ...change }]);
    const { error } = existing && !existing.id.startsWith("tmp-")
      ? await supabase.from("ss_checkup_answers").update(change).eq("id", existing.id)
      : await supabase.from("ss_checkup_answers").upsert({ company_id: company.id, checkup_id: c!.id, question_id: q.id, member_id: me.id, ...change }, { onConflict: "question_id,member_id" });
    if (error) setError(friendlyError(error));
    load();
  };
  const toIssue = async (q: Question, avg: number | null) => {
    const { error } = await supabase.from("ss_issues").insert({
      company_id: company.id, meeting_id: defaultMeetingId, owner_member_id: me.id, created_by: me.id,
      title: `Checkup: ${q.text}`, description: `From “${c!.title}”${avg !== null ? `, average ${Number(avg).toFixed(1)} of 5` : ""}.`,
    });
    if (error) setError(friendlyError(error)); else setRaised(new Set([...raised, q.id]));
  };
  const setStatus = async (status: Checkup["status"]) => {
    await supabase.from("ss_checkups").update({ status, closed_at: status === "closed" ? new Date().toISOString() : null }).eq("id", c!.id);
    load();
  };

  if (!c) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const done = questions.filter((q) => answers.some((a) => a.question_id === q.id && a.score)).length;
  const total = overall(results);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row">
        <Link to="/checkups" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Checkups</Link>
        <span className="spacer" />
        <Menu items={[
          c.status === "open"
            ? { label: "Close checkup", icon: <Lock size={16} />, onSelect: () => { if (confirm("Close this checkup? Nobody can change their answers after it's closed.")) setStatus("closed"); } }
            : { label: "Reopen checkup", icon: <LockOpen size={16} />, onSelect: () => setStatus("open") },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, danger: true, onSelect: async () => {
            if (!confirm("Move this checkup to the recycle bin?")) return;
            await supabase.from("ss_checkups").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
            navigate("/checkups");
          } },
        ]} />
      </div>
      <div className="card card-pad goal-summary">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="goal-title">{c.title}</h1>
          <span className={`badge badge-lg ${c.status === "open" ? "badge-green" : "badge-done"}`} style={{ cursor: "default" }}>{c.status === "open" ? "Open" : "Closed"}</span>
        </div>
        <div className="goal-meta">
          <span>{nameOf(c.kind)}</span>
          <span>{c.anonymous ? "Anonymous" : "Names shown"}</span>
          <span>{responders?.responders ?? 0} {responders?.responders === 1 ? "person has" : "people have"} answered
            {!c.anonymous && responders?.member_ids?.length ? ` (${responders.member_ids.map((m) => byId(m)?.first_name).filter(Boolean).join(", ")})` : ""}</span>
        </div>
        {total !== null && <p className="goal-finish"><span className="muted">Overall</span> <strong>{total}%</strong>
          {previous?.overall != null && <span className="muted"> · {total - previous.overall >= 0 ? "+" : ""}{total - previous.overall} vs {previous.title}</span>}</p>}
      </div>
      <Chips value={tab} onChange={setTab} options={[{ value: "answer", label: c.status === "open" ? `My Answers ${done}/${questions.length}` : "My Answers" }, { value: "results", label: "Results" }]} />
      {error && <p className="error">{error}</p>}

      {tab === "answer" ? (
        <div className="stack">
          {c.status === "closed" && <p className="notice">This checkup is closed, so answers can't be changed.</p>}
          <div className="scale-legend" aria-hidden="true"><span><strong>1</strong> = strongly disagree (worst)</span><span><strong>5</strong> = strongly agree (best)</span></div>
          {questions.map((q, i) => {
            const a = answers.find((x) => x.question_id === q.id);
            const heading = groupStart(questions, i);
            return (
              <div key={q.id} className="stack" style={{ gap: 8 }}>
              {heading && <h3 className="checkup-group">{heading}</h3>}
              <div className="card card-pad stack" style={{ gap: 10 }}>
                <div className="row" style={{ alignItems: "flex-start" }}><span className="plan-num" style={{ paddingTop: 0 }}>{i + 1}.</span><strong style={{ color: "var(--color-fg)" }}>{q.text}</strong></div>
                <div className="scale" role="radiogroup" aria-label={q.text}>
                  {SCALE.map((label, s) => (
                    <button key={s} type="button" role="radio" aria-checked={a?.score === s + 1} disabled={c.status === "closed"}
                      className={`scale-btn s${s + 1}${a?.score === s + 1 ? " on" : ""}`} onClick={() => answer(q, { score: s + 1 })} title={label}>
                      <span className="scale-n">{s + 1}</span><span className="scale-l">{label}</span>
                      {(s === 0 || s === 4) && <span className="scale-short">{s === 0 ? "worst" : "best"}</span>}
                    </button>
                  ))}
                </div>
                <textarea className="input textarea" rows={1} placeholder="Comment (optional)" disabled={c.status === "closed"} defaultValue={a?.comment ?? ""}
                  onBlur={(e) => (e.target.value.trim() || null) !== (a?.comment ?? null) && answer(q, { comment: e.target.value.trim() || null })} />
              </div>
              </div>
            );
          })}
          {c.status === "open" && done === questions.length && questions.length > 0 && <p className="notice">All answered, thank you. You can change answers until the checkup is closed.</p>}
        </div>
      ) : (
        <div className="stack">
          <div className="card card-pad row wrap">
            <div><div className="small muted">Overall</div><div className="pct">{total ?? "–"}{total !== null && "%"}</div></div>
            {previous?.overall != null && total !== null && (
              <div><div className="small muted">vs {previous.title}</div>
                <div className={`pct ${total - previous.overall >= 0 ? "up" : "down"}`}>{total - previous.overall >= 0 ? "+" : ""}{total - previous.overall}</div></div>
            )}
            <span className="spacer" />
            <span className="small muted">Scores run from 1 (worst) to 5 (best); 1 = 0%, 5 = 100%</span>
          </div>
          {questions.map((q, i) => {
            const r = results.find((x) => x.question_id === q.id);
            const p = pct(r?.average ?? null);
            const before = previous?.byText[q.text.trim().toLowerCase()];
            const max = Math.max(1, ...(r?.spread ?? [0]));
            const heading = groupStart(questions, i);
            return (
              <div key={q.id} className="stack" style={{ gap: 8 }}>
              {heading && <h3 className="checkup-group">{heading}</h3>}
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <span className="plan-num" style={{ paddingTop: 0 }}>{i + 1}.</span>
                  <strong style={{ flex: 1, color: "var(--color-fg)" }}>{q.text}</strong>
                  {r?.average != null && <span className={`badge ${scoreClass(p)}`}>{Number(r.average).toFixed(1)}</span>}
                  {raised.has(q.id)
                    ? <span className="small muted">In Issues</span>
                    : <button className="btn btn-sm btn-ghost" title="Add to Issues" aria-label="Add to Issues" onClick={() => toIssue(q, r?.average ?? null)}><CircleAlert size={16} /></button>}
                </div>
                <div className="spread">
                  {SCALE.map((label, s) => (
                    <div key={s} className="spread-col" title={`${label}: ${r?.spread[s] ?? 0}`}>
                      <span className="spread-bar" style={{ height: `${((r?.spread[s] ?? 0) / max) * 48}px` }} />
                      <span className="small muted">{s + 1}</span>
                    </div>
                  ))}
                  <span className="small muted" style={{ alignSelf: "flex-end" }}>{r?.answered ?? 0} answered
                    {before != null && r?.average != null ? ` · was ${Number(before).toFixed(1)}` : ""}</span>
                </div>
                {(r?.comments ?? []).map((cm, j) => (
                  <p key={j} className="small comment-body">“{cm.text}”{cm.member_id && <span className="muted"> · {byId(cm.member_id) ? fullName(byId(cm.member_id)!) : ""}</span>}</p>
                ))}
              </div>
              </div>
            );
          })}
          <p className="small muted">Low scores are a prompt for a conversation: drop the biggest one into Issues.</p>
        </div>
      )}
    </div>
  );
}

interface Group { title: string; items: string[] }
const toGroups = (lines: Line[]): Group[] => {
  const groups: Group[] = [];
  for (const l of lines) {
    const title = l.group_title ?? "";
    if (!groups.length || groups[groups.length - 1].title !== title) groups.push({ title, items: [] });
    groups[groups.length - 1].items.push(l.text);
  }
  return groups;
};
const fromGroups = (groups: Group[]): Line[] =>
  groups.flatMap((g) => g.items.map((t) => t.trim()).filter(Boolean).map((text) => ({ group_title: g.title.trim() || null, text })));

/** Checkup Types and Standard Questions: owners add types and edit each type's statements; everyone can read them. */
function CheckupTypes({ checkupTypes, onClose }: { checkupTypes: ReturnType<typeof useCheckupTypes>; onClose: () => void }) {
  const { company, isOwner } = useMe();
  const { active, reload } = checkupTypes;
  const [key, setKey] = useState("org");
  const type = active.find((t) => t.key === key) ?? active[0];
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [saved, setSaved] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!type) return;
    let live = true;
    setGroups(null); setMsg(null); setName(type.name);
    supabase.from("ss_checkup_standard_questions").select("group_title, text").eq("kind", type.key).order("sort_order")
      .then(({ data }) => { if (!live) return; const g = toGroups((data ?? []) as Line[]); setGroups(g); setSaved(JSON.stringify(fromGroups(g))); });
    return () => { live = false; };
  }, [type?.key, type?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn: (g: Group[]) => Group[]) => setGroups((g) => (g ? fn(g.map((x) => ({ ...x, items: [...x.items] }))) : g));
  const move = (gi: number, i: number, by: -1 | 1) => edit((g) => { const it = g[gi].items; [it[i], it[i + by]] = [it[i + by], it[i]]; return g; });
  const dirty = groups !== null && JSON.stringify(fromGroups(groups)) !== saved;

  const save = async () => {
    if (!groups || !type) return;
    const lines = fromGroups(groups);
    setBusy(true); setMsg(null);
    // Add the new list first, then remove the old rows, so a failure part-way never leaves the type empty.
    const { data: old } = await supabase.from("ss_checkup_standard_questions").select("id").eq("kind", type.key);
    const { error: addError } = lines.length
      ? await supabase.from("ss_checkup_standard_questions").insert(lines.map((l, i) => ({ company_id: company.id, kind: type.key, group_title: l.group_title, sort_order: i + 1, text: l.text })))
      : { error: null };
    const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
    const { error } = addError ? { error: addError } : oldIds.length
      ? await supabase.from("ss_checkup_standard_questions").delete().in("id", oldIds)
      : { error: null };
    setBusy(false);
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
    const g = toGroups(lines);
    setGroups(g); setSaved(JSON.stringify(lines));
    setMsg({ ok: true, text: `Saved ${lines.length} statement${lines.length === 1 ? "" : "s"}. New ${type.name} checkups start from this list; checkups already running don't change.` });
  };
  const rename = async () => {
    if (!type || !name.trim() || name.trim() === type.name) { setName(type?.name ?? ""); return; }
    const { error } = await supabase.from("ss_checkup_types").update({ name: name.trim() }).eq("id", type.id);
    if (error) setMsg({ ok: false, text: friendlyError(error) }); else reload();
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding?.trim()) return;
    const { data, error } = await supabase.from("ss_checkup_types")
      .insert({ company_id: company.id, name: adding.trim(), sort_order: Math.max(0, ...active.filter((t) => !t.is_one_off).map((t) => t.sort_order)) + 1 })
      .select("key").single();
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
    setAdding(null);
    await reload();
    setKey(data.key);
  };
  const remove = async () => {
    if (!type || type.built_in || !confirm(`Remove the ${type.name} type? Past ${type.name} checkups keep their questions and results; it just won't be offered for new checkups.`)) return;
    const { error } = await supabase.from("ss_checkup_types").update({ deleted_at: new Date().toISOString() }).eq("id", type.id);
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
    await reload();
    setKey("org");
  };

  return (
    <Sheet title="Checkup Types and Standard Questions" onClose={onClose}>
      <div className="stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <Chips value={type?.key ?? ""} onChange={setKey} options={active.map((t) => ({ value: t.key, label: t.name }))} />
          {isOwner && adding === null && <button className="btn btn-sm" onClick={() => setAdding("")}><Plus size={16} />New Checkup Type</button>}
        </div>
        {adding !== null && (
          <form className="card card-pad stack" style={{ gap: 8 }} onSubmit={create}>
            <label className="field"><span>New Checkup Type</span>
              <input className="input" autoFocus required placeholder="e.g. Safety, Customer Service" value={adding} onChange={(e) => setAdding(e.target.value)} />
            </label>
            <div className="row"><button className="btn btn-primary btn-sm">Create</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setAdding(null)}>Cancel</button></div>
          </form>
        )}
        {!type ? null : (
          <>
            {isOwner ? (
              <label className="field"><span>Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              </label>
            ) : <h3>{type.name}</h3>}
            {type.is_one_off ? (
              <p className="notice">{type.name} is for one-off checkups: the questions are written for each checkup, so it has no Standard Questions.</p>
            ) : groups === null ? <p className="muted">Loading…</p> : (
              <>
                <p className="small muted">Every new {type.name} checkup starts with these statements, so results can be compared over time. Rewording a statement starts a fresh comparison for it.</p>
                {groups.length === 0 && <Empty>No Standard Questions for {type.name} yet.</Empty>}
                {groups.map((g, gi) => (
                  <div key={gi} className="card card-pad stack std-group">
                    {isOwner ? (
                      <div className="row" style={{ gap: 6 }}>
                        <input className="input input-sm std-group-title" aria-label="Rename Group" placeholder="Group heading (optional)" value={g.title}
                          onChange={(e) => edit((x) => { x[gi].title = e.target.value; return x; })} />
                        <button className="link-btn" title="Remove this group and its statements" aria-label="Remove this group and its statements"
                          onClick={() => confirm(`Remove ${g.title || "this group"} and its ${g.items.length} statement${g.items.length === 1 ? "" : "s"}?`) && edit((x) => x.filter((_, j) => j !== gi))}><X size={16} /></button>
                      </div>
                    ) : g.title && <strong className="checkup-group">{g.title}</strong>}
                    <ol className="std-items">
                      {g.items.map((t, i) => (
                        <li key={i} className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                          {isOwner ? (
                            <>
                              <textarea className="input textarea std-item" rows={2} value={t} aria-label={`Statement ${i + 1}`}
                                onChange={(e) => edit((x) => { x[gi].items[i] = e.target.value; return x; })} />
                              <div className="std-tools">
                                <button className="link-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(gi, i, -1)}><ArrowUp size={14} /></button>
                                <button className="link-btn" aria-label="Move down" disabled={i === g.items.length - 1} onClick={() => move(gi, i, 1)}><ArrowDown size={14} /></button>
                                <button className="link-btn" aria-label="Remove statement" onClick={() => edit((x) => { x[gi].items.splice(i, 1); return x; })}><Trash2 size={14} /></button>
                              </div>
                            </>
                          ) : <span>{t}</span>}
                        </li>
                      ))}
                    </ol>
                    {isOwner && <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => edit((x) => { x[gi].items.push(""); return x; })}><Plus size={14} />Add Statement</button>}
                  </div>
                ))}
                {isOwner && <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => edit((x) => [...x, { title: "", items: [""] }])}><Plus size={16} />Add Group</button>}
              </>
            )}
            {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
            {isOwner && !type.is_one_off && <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>}
            {isOwner && !type.built_in && <button className="btn btn-sm btn-danger" style={{ alignSelf: "flex-start" }} onClick={remove}><Trash2 size={16} />Remove Type</button>}
            {!isOwner && <p className="small muted">Only owners can change checkup types and their Standard Questions.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
