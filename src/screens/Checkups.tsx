import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, CircleAlert, ListChecks, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, useMeetings, useMembers } from "../lib/data";
import { Chips, Empty, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";

type Kind = "org" | "culture" | "other";
interface Checkup {
  id: string; company_id: string; title: string; kind: Kind; anonymous: boolean; status: "open" | "closed";
  closed_at: string | null; deleted_at: string | null; created_at: string;
}
interface Question { id: string; checkup_id: string; sort_order: number; text: string; group_title: string | null }
interface Line { group_title: string | null; text: string }
interface Answer { id: string; question_id: string; score: number | null; comment: string | null }
interface Result { question_id: string; answered: number; average: number | null; spread: number[]; comments: { text: string; member_id: string | null }[] }

const KIND: Record<Kind, string> = { org: "Organisation", culture: "Culture", other: "Other" };
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
        <div className="small muted">{KIND[c.kind]} · {fmtDay(c.created_at, true)}{c.anonymous ? " · anonymous" : ""}
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
        <button className="btn btn-sm" onClick={() => setStandard(true)}><ListChecks size={16} />Standard Questions</button>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={16} />New checkup</button>
      </div>
      <p className="small muted">A quick, honest read on how the organisation or culture is doing. Each type starts from its Standard Questions, so results compare from one checkup to the next. Run one every quarter or so and watch the trend.</p>
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty>No checkups yet.</Empty> : <>
        {open.length > 0 && <Section title="Open" count={open.length}><ul className="card list">{open.map(row)}</ul></Section>}
        {closed.length > 0 && <Section title="Closed" count={closed.length}><ul className="card list">{closed.map(row)}</ul></Section>}
      </>}
      {standard && <StandardQuestions onClose={() => setStandard(false)} />}
      {creating && <NewCheckup previous={list ?? []} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/checkups/${id}`)} />}
    </div>
  );
}

function NewCheckup({ previous, onClose, onCreated }: { previous: Checkup[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { me, company } = useMe();
  const [form, setForm] = useState({ title: "", kind: "org" as Kind, anonymous: true, questions: "" });
  const [error, setError] = useState("");
  const last = previous.find((c) => c.kind === form.kind);

  // Each type starts from its Standard Questions; they can still be changed for this checkup.
  useEffect(() => {
    let live = true;
    supabase.from("ss_checkup_standard_questions").select("group_title, text").eq("kind", form.kind).order("sort_order")
      .then(({ data }) => { if (live) setForm((f) => ({ ...f, questions: toText((data ?? []) as Line[]) })); });
    return () => { live = false; };
  }, [form.kind]);

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
          <input className="input" required placeholder={`e.g. ${KIND[form.kind]} checkup, Q4 2026`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <Chips value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: KIND[k] }))} />
        <label className="field"><span>Questions <span className="muted" style={{ fontWeight: 400 }}>· from this type's Standard Questions; change them for this checkup if you need to</span></span>
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
      <Link to="/checkups" className="row small" style={{ gap: 4 }}><ChevronLeft size={16} />Checkups</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>{c.title}</h1>
        <span className={`badge ${c.status === "open" ? "badge-green" : ""}`}>{c.status === "open" ? "Open" : "Closed"}</span>
      </div>
      <p className="small muted">{KIND[c.kind]}{c.anonymous ? " · anonymous" : " · names shown"} · {responders?.responders ?? 0} {responders?.responders === 1 ? "person has" : "people have"} answered
        {responders?.member_ids?.length ? ` (${responders.member_ids.map((m) => byId(m)?.first_name).filter(Boolean).join(", ")})` : ""}</p>
      <div className="row wrap">
        <Chips value={tab} onChange={setTab} options={[{ value: "answer", label: c.status === "open" ? `My answers ${done}/${questions.length}` : "My answers" }, { value: "results", label: "Results" }]} />
        <span className="spacer" />
        {c.status === "open"
          ? <button className="btn btn-sm" onClick={() => confirm("Close this checkup? Nobody can change their answers after it's closed.") && setStatus("closed")}><Lock size={16} />Close</button>
          : <button className="btn btn-sm btn-ghost" onClick={() => setStatus("open")}><LockOpen size={16} />Reopen</button>}
      </div>
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
      <div className="row">
        <span className="spacer" />
        <button className="btn btn-sm btn-danger" onClick={async () => {
          if (!confirm("Move this checkup to the recycle bin?")) return;
          await supabase.from("ss_checkups").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
          navigate("/checkups");
        }}><Trash2 size={16} />Recycle bin</button>
      </div>
    </div>
  );
}

/** Each checkup type's Standard Questions: owners edit them, everyone can read them. */
function StandardQuestions({ onClose }: { onClose: () => void }) {
  const { company, isOwner } = useMe();
  const [kind, setKind] = useState<Kind>("org");
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null); setMsg(null);
    supabase.from("ss_checkup_standard_questions").select("group_title, text").eq("kind", kind).order("sort_order")
      .then(({ data }) => { if (!live) return; const t = toText((data ?? []) as Line[]); setText(t); setSaved(t); });
    return () => { live = false; };
  }, [kind]);

  const save = async () => {
    if (text === null) return;
    const lines = fromText(text);
    setBusy(true); setMsg(null);
    // Replace the whole list: add the new list first, then remove the old rows, so a failure part-way
    // never leaves the type with no questions.
    const { data: old } = await supabase.from("ss_checkup_standard_questions").select("id").eq("kind", kind);
    const { error: addError } = lines.length
      ? await supabase.from("ss_checkup_standard_questions").insert(lines.map((l, i) => ({ company_id: company.id, kind, group_title: l.group_title, sort_order: i + 1, text: l.text })))
      : { error: null };
    const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
    const { error } = addError ? { error: addError } : oldIds.length
      ? await supabase.from("ss_checkup_standard_questions").delete().in("id", oldIds)
      : { error: null };
    setBusy(false);
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return; }
    const t = toText(lines);
    setText(t); setSaved(t);
    setMsg({ ok: true, text: `Saved ${lines.length} question${lines.length === 1 ? "" : "s"}. New ${KIND[kind]} checkups start from this list; checkups already running don't change.` });
  };

  return (
    <Sheet title="Standard Questions" onClose={onClose}>
      <div className="stack">
        <Chips value={kind} onChange={setKind} options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: KIND[k] }))} />
        <p className="small muted">Every new {KIND[kind]} checkup starts with these, so results can be compared over time. Rewording a question starts a fresh comparison for it.</p>
        {text === null ? <p className="muted">Loading…</p> : isOwner ? (
          <>
            <textarea className="input textarea" rows={16} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"# A group heading\nA statement people agree or disagree with.\nAnother statement."} />
            <p className="small muted">One statement per line. Start a line with # for a group heading.</p>
            {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
            <button className="btn btn-primary" disabled={busy || text === saved} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          </>
        ) : (
          <>
            {fromText(text).length === 0 ? <Empty>No Standard Questions for {KIND[kind]} yet.</Empty> : (
              <ol className="standard-list">
                {fromText(text).map((l, i, all) => (
                  <li key={i}>{groupStart(all, i) && <strong className="checkup-group">{l.group_title}</strong>}<span>{l.text}</span></li>
                ))}
              </ol>
            )}
            <p className="small muted">Only owners can change Standard Questions.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
