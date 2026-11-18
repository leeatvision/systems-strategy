import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, Columns3, History, Plus, Printer, SlidersHorizontal, Trash2, UserPlus, Users, X } from "lucide-react";
import { flushSync } from "react-dom";
import { friendlyError, fullName, supabase, type Member } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, today, useMembers } from "../lib/data";
import { Empty, Menu } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { printPage } from "../lib/print";
import { w } from "../lib/terms";

// ─── Shapes and rules ───────────────────────────────────────────────────────

export type Scale = "plus" | "yes_no";
export type Rating = "+" | "+/-" | "-" | "Y" | "N";
export interface Trait { id: string; title: string; kind: "value" | "role" | "custom"; scale: Scale; bar: Rating }
interface DefaultTrait extends Trait { company_id: string; sort_order: number }
interface Review {
  id: string; company_id: string; title: string | null; reviewed_on: string; traits: Trait[]; notes: string | null;
  created_by: string | null; created_at: string; deleted_at: string | null;
}
interface Person {
  id: string; company_id: string; review_id: string; member_id: string | null; person_name: string | null;
  ratings: Record<string, Rating>; note: string | null; sort_order: number;
}

export const ROLE_TRAITS: Omit<Trait, "id">[] = [
  { title: "Understands It", kind: "role", scale: "yes_no", bar: "Y" },
  { title: "Wants It", kind: "role", scale: "yes_no", bar: "Y" },
  { title: "Able To Do It", kind: "role", scale: "yes_no", bar: "Y" },
];
const STEPS: Record<Scale, Rating[]> = { plus: ["+", "+/-", "-"], yes_no: ["Y", "N"] };
const RANK: Record<Rating, number> = { "+": 3, "+/-": 2, "-": 1, Y: 2, N: 1 };

/** The next rating when a box is tapped: through the scale, then back to empty. */
function nextRating(scale: Scale, r: Rating | undefined): Rating | undefined {
  const s = STEPS[scale];
  const i = r ? s.indexOf(r) : -1;
  return i + 1 < s.length ? s[i + 1] : undefined;
}
/** Whether a rating clears the trait's bar (unrated: unknown). */
export function passes(t: Trait, r: Rating | undefined): boolean | null {
  if (!r || !STEPS[t.scale].includes(r)) return null;
  return RANK[r] >= RANK[t.bar];
}
/** At The Bar: every trait rated + or Y. Any N, +/- or - means not at the bar; with none, but some unrated, it's not known yet. */
const SHORT: Rating[] = ["N", "+/-", "-"];
export function atTheBar(traits: Trait[], ratings: Record<string, Rating>) {
  const short = traits.filter((t) => SHORT.includes(ratings[t.id])).length;
  const full = traits.filter((t) => ratings[t.id] === "+" || ratings[t.id] === "Y").length;
  return { short, full, at: short > 0 ? false : full === traits.length && traits.length > 0 ? true : null };
}
const newId = () => crypto.randomUUID();
const reviewTitle = (r: Review) => r.title?.trim() || `${w("People Review")} · ${fmtDay(r.reviewed_on, true)}`;
const ratingClass = (ok: boolean | null) => (ok === null ? "" : ok ? "pr-pass" : "pr-fail");
const nameOf = (p: Pick<Person, "member_id" | "person_name">, byId: (id: string | null) => Member | undefined) => {
  const m = byId(p.member_id);
  return m ? fullName(m) : p.person_name ?? "Someone";
};

function useCanReview() {
  const { me } = useMe();
  return me.role === "owner" || me.role === "leader";
}
function NoAccess() {
  return <Empty>Only owners and leaders can see this page.</Empty>;
}

/** The company's default traits, in order. */
async function loadDefaults(): Promise<DefaultTrait[]> {
  const { data } = await supabase.from("ss_review_traits").select("*").order("sort_order").order("created_at");
  return (data ?? []) as DefaultTrait[];
}

// ─── The list of reviews, and people across them ────────────────────────────

export function PeopleReviews() {
  const allowed = useCanReview();
  const { me, company } = useMe();
  const { active, byId } = useMembers();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [view, setView] = useState<"reviews" | "people">("reviews");
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [history, setHistory] = useState<Pick<Person, "member_id" | "person_name"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("ss_people_reviews").select("*").is("deleted_at", null).order("reviewed_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) { setError(friendlyError(error)); setReviews([]); return; }
    const list = (data ?? []) as Review[];
    setReviews(list);
    if (list.length) {
      const { data: ps } = await supabase.from("ss_people_ratings").select("*").in("review_id", list.map((r) => r.id));
      setPeople(((ps ?? []) as Person[]).map((p) => ({ ...p, ratings: p.ratings ?? {} })));
    } else setPeople([]);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  /** A new review: today's date, the default traits, and the people from the last review (or everyone). */
  const create = async () => {
    setError(null);
    const defaults = await loadDefaults();
    const traits: Trait[] = (defaults.length ? defaults : ROLE_TRAITS.map((t) => ({ ...t, id: newId() })))
      .map(({ id, title, kind, scale, bar }) => ({ id, title, kind, scale, bar }));
    const { data, error } = await supabase.from("ss_people_reviews")
      .insert({ company_id: company.id, reviewed_on: today(), traits, created_by: me.id }).select("id").single();
    if (error || !data) { setError(friendlyError(error)); return; }
    const last = reviews?.[0];
    const from = last ? people.filter((p) => p.review_id === last.id).sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({ member_id: p.member_id, person_name: p.person_name }))
      : active.filter((m) => m.role !== "viewer").map((m) => ({ member_id: m.id, person_name: null }));
    if (from.length) {
      const { error: e2 } = await supabase.from("ss_people_ratings").insert(from.map((p, i) => ({ ...p, company_id: company.id, review_id: data.id, sort_order: i })));
      if (e2) setError(friendlyError(e2));
    }
    navigate(`/people-review/${data.id}`);
  };

  if (!allowed) return <div className="stack"><h1>{w("People Review")}</h1><NoAccess /></div>;

  // Everyone who's been reviewed, with their latest review.
  const reviewById = new Map((reviews ?? []).map((r) => [r.id, r]));
  const personKey = (p: Pick<Person, "member_id" | "person_name">) => p.member_id ?? `name:${(p.person_name ?? "").trim().toLowerCase()}`;
  const latest = new Map<string, { p: Person; r: Review }>();
  for (const p of people) {
    const r = reviewById.get(p.review_id);
    if (!r) continue;
    const k = personKey(p);
    const cur = latest.get(k);
    if (!cur || cur.r.reviewed_on < r.reviewed_on) latest.set(k, { p, r });
  }
  const everyone = [...latest.values()].sort((a, b) => nameOf(a.p, byId).localeCompare(nameOf(b.p, byId)));

  return (
    <div className="stack">
      <div className="page-head goals-head">
        <h1>{w("People Review")}</h1>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={create}><Plus size={16} />New Review</button>
      </div>
      <p className="small muted page-sub">Rate each person against the traits, review by review. Only owners and leaders see this page.</p>
      {error && <p className="error">{error}</p>}
      <div className="toolbar no-print">
        <span className="seg" role="group" aria-label="View">
          {([["reviews", "Reviews", Columns3], ["people", "People", Users]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} aria-label={label} title={label} onClick={() => setView(v)}><Icon size={18} /></button>
          ))}
        </span>
        <span className="spacer" />
        <Menu items={[{ label: "Default traits", icon: <SlidersHorizontal size={16} />, onSelect: () => setTraitsOpen(true) }]} />
      </div>

      {reviews === null ? <p className="muted">Loading…</p> : view === "reviews" ? (
        reviews.length === 0 ? <Empty>No reviews yet. Start one with New Review: it begins with the default traits and everyone in People.</Empty> : (
          <ul className="card list">
            {reviews.map((r) => {
              const ps = people.filter((p) => p.review_id === r.id);
              const below = ps.filter((p) => atTheBar(r.traits, p.ratings).at === false).length;
              return (
                <li key={r.id} className="clickable" onClick={() => navigate(`/people-review/${r.id}`)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="item-title">{reviewTitle(r)}</div>
                    <div className="small muted">{fmtDay(r.reviewed_on, true)} · {ps.length} {ps.length === 1 ? "person" : "people"} · {r.traits.length} traits</div>
                  </div>
                  {below > 0 ? <span className="badge badge-danger">{below} below The Bar</span> : ps.length > 0 && <span className="badge badge-green">All At The Bar</span>}
                </li>
              );
            })}
          </ul>
        )
      ) : everyone.length === 0 ? <Empty>No one has been reviewed yet.</Empty> : (
        <ul className="card list">
          {everyone.map(({ p, r }) => {
            const { short: below } = atTheBar(r.traits, p.ratings);
            const rated = r.traits.filter((t) => p.ratings[t.id]).length;
            return (
              <li key={personKey(p)} className="clickable" onClick={() => setHistory(p)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title">{nameOf(p, byId)}</div>
                  <div className="small muted">Last reviewed {fmtDay(r.reviewed_on, true)} · {people.filter((x) => personKey(x) === personKey(p) && reviewById.has(x.review_id)).length} reviews</div>
                </div>
                {below > 0 ? <span className="badge badge-danger">{below} below</span>
                  : rated < r.traits.length ? <span className="badge">{rated} of {r.traits.length} rated</span>
                  : <span className="badge badge-green">At The Bar</span>}
                <History size={16} color="var(--color-fg-muted)" />
              </li>
            );
          })}
        </ul>
      )}

      {traitsOpen && <TraitsSheet mode="default" onClose={() => setTraitsOpen(false)} />}
      {history && <PersonHistory who={history} reviews={reviews ?? []} people={people} onClose={() => setHistory(null)} />}
    </div>
  );
}

// ─── One review ─────────────────────────────────────────────────────────────

export function PeopleReviewDetail() {
  const allowed = useCanReview();
  const { id } = useParams();
  const { company } = useMe();
  const { active, byId } = useMembers();
  const navigate = useNavigate();
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [people, setPeople] = useState<Person[]>([]);
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [history, setHistory] = useState<Pick<Person, "member_id" | "person_name"> | null>(null);
  const [allReviews, setAllReviews] = useState<{ reviews: Review[]; people: Person[] } | null>(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_people_reviews").select("*").eq("id", id!).maybeSingle();
    setReview((data as Review) ?? null);
    const { data: ps } = await supabase.from("ss_people_ratings").select("*").eq("review_id", id!).order("sort_order").order("created_at");
    setPeople(((ps ?? []) as Person[]).map((p) => ({ ...p, ratings: p.ratings ?? {} })));
  }, [id]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const patchReview = async (p: Partial<Review>) => {
    if (!review) return;
    setReview({ ...review, ...p });
    const { error } = await supabase.from("ss_people_reviews").update(p).eq("id", review.id);
    if (error) { setError(friendlyError(error)); load(); }
  };
  const rate = async (person: Person, t: Trait) => {
    const r = nextRating(t.scale, person.ratings[t.id]);
    const ratings = { ...person.ratings };
    if (r) ratings[t.id] = r; else delete ratings[t.id];
    setPeople((ps) => ps.map((p) => (p.id === person.id ? { ...p, ratings } : p)));
    const { error } = await supabase.from("ss_people_ratings").update({ ratings }).eq("id", person.id);
    if (error) { setError(friendlyError(error)); load(); }
  };
  const addPeople = async (list: { member_id: string | null; person_name: string | null }[]) => {
    if (!review || !list.length) return;
    const start = people.reduce((n, p) => Math.max(n, p.sort_order + 1), 0);
    const { error } = await supabase.from("ss_people_ratings").insert(list.map((p, i) => ({ ...p, company_id: company.id, review_id: review.id, sort_order: start + i })));
    if (error) setError(friendlyError(error));
    load();
  };
  const addOne = (e: FormEvent) => {
    e.preventDefault();
    const v = adding.trim();
    if (!v) return;
    setAdding("");
    if (v.startsWith("member:")) addPeople([{ member_id: v.slice(7), person_name: null }]);
  };
  const addName = () => {
    const name = prompt("Name of the person (someone not in People):")?.trim();
    if (name) addPeople([{ member_id: null, person_name: name }]);
  };
  const removePerson = async (p: Person) => {
    if (!confirm(`Take ${nameOf(p, byId)} off this review? Their ratings on it are removed.`)) return;
    const { error } = await supabase.from("ss_people_ratings").delete().eq("id", p.id);
    if (error) setError(friendlyError(error));
    load();
  };
  const remove = async () => {
    if (!review || !confirm("Move this review to the recycle bin? You can restore it from More → Recycle bin.")) return;
    const { error } = await supabase.from("ss_people_reviews").update({ deleted_at: new Date().toISOString() }).eq("id", review.id);
    if (error) setError(friendlyError(error)); else navigate("/people-review");
  };
  const openHistory = async (p: Person) => {
    if (!allReviews) {
      const { data } = await supabase.from("ss_people_reviews").select("*").is("deleted_at", null);
      const rs = (data ?? []) as Review[];
      const { data: ps } = rs.length ? await supabase.from("ss_people_ratings").select("*").in("review_id", rs.map((r) => r.id)) : { data: [] };
      setAllReviews({ reviews: rs, people: (ps ?? []) as Person[] });
    }
    setHistory(p);
  };

  if (!allowed) return <div className="stack"><h1>{w("People Review")}</h1><NoAccess /></div>;
  if (review === undefined) return <p className="muted">Loading…</p>;
  if (review === null) return <p className="error">That review wasn't found.</p>;

  const traits = review.traits;
  const inReview = new Set(people.map((p) => p.member_id).filter(Boolean));
  const notIn = active.filter((m) => !inReview.has(m.id));

  return (
    <div className="stack">
      <Link to="/people-review" className="row small no-print" style={{ gap: 4 }}><ChevronLeft size={16} />{w("People Review")}</Link>
      <div className="page-head">
        <h1 className="goal-title">{reviewTitle(review)}</h1>
        <span className="spacer" />
        <Menu items={[
          { label: "Print", icon: <Printer size={16} />, onSelect: () => { flushSync(() => setError(null)); printPage(reviewTitle(review)); } },
          { label: "Columns for this review", icon: <Columns3 size={16} />, onSelect: () => setTraitsOpen(true) },
          { label: "Move to recycle bin", icon: <Trash2 size={16} />, onSelect: remove, danger: true },
        ]} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row no-print" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="field" style={{ flex: "0 1 180px" }}><span>Date</span>
          <input className="input" type="date" value={review.reviewed_on} onChange={(e) => e.target.value && patchReview({ reviewed_on: e.target.value })} />
        </label>
        <label className="field" style={{ flex: "1 1 220px" }}><span>Name (optional)</span>
          <input className="input" defaultValue={review.title ?? ""} placeholder={`${w("People Review")} · ${fmtDay(review.reviewed_on, true)}`}
            onBlur={(e) => { const t = e.target.value.trim() || null; if (t !== review.title) patchReview({ title: t }); }} />
        </label>
      </div>

      {traits.length === 0 ? <Empty>This review has no traits. Add some with ⋮ → Columns for this review.</Empty> : (
        <div className="card pr-wrap">
          <table className="pr-table">
            <thead>
              <tr>
                <th className="pr-name">Name</th>
                {traits.map((t) => <th key={t.id} className="pr-trait" title={w(t.title)}><span>{w(t.title)}</span></th>)}
                <th className="pr-sum pr-trait"><span>At The Bar</span></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const bar = atTheBar(traits, p.ratings);
                const rated = traits.filter((t) => p.ratings[t.id]);
                return (
                  <tr key={p.id}>
                    <td className="pr-name">
                      <button type="button" className="link-btn" onClick={() => openHistory(p)} title="See their history">{nameOf(p, byId)}</button>
                      <button type="button" className="link-btn pr-remove no-print" aria-label={`Take ${nameOf(p, byId)} off this review`} onClick={() => removePerson(p)}><X size={14} /></button>
                    </td>
                    {traits.map((t) => {
                      const r = p.ratings[t.id];
                      return (
                        <td key={t.id} className={`pr-cell ${ratingClass(passes(t, r))}`}>
                          <button type="button" aria-label={`${nameOf(p, byId)}, ${w(t.title)}: ${r ?? "not rated"}. Tap to change.`} onClick={() => rate(p, t)}>{r ?? ""}</button>
                        </td>
                      );
                    })}
                    <td className={`pr-sum ${bar.at === true ? "pr-pass" : bar.at === false ? "pr-fail" : ""}`}
                      title={bar.at === false ? `${bar.short} rated N, +/- or -` : undefined}>
                      {rated.length ? `${bar.full}/${traits.length}` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="pr-name">The bar</th>
                {traits.map((t) => (
                  <td key={t.id} className="pr-bar">
                    <select aria-label={`Bar for ${w(t.title)}`} value={t.bar}
                      onChange={(e) => patchReview({ traits: traits.map((x) => (x.id === t.id ? { ...x, bar: e.target.value as Rating } : x)) })}>
                      {STEPS[t.scale].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="pr-bar-print">{t.bar}</span>
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="small muted no-print">Tap a box to rate: + , +/- , - (or Y, N for yes-or-no traits); tap again to change it. Green clears the bar, red is below it. At The Bar turns red for any N, +/- or -. Tap a name for that person's history.</p>

      <form className="row no-print" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={addOne}>
        <select className="input" style={{ flex: "1 1 200px" }} aria-label="Add a person" value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add someone from People…</option>
          {notIn.map((m) => <option key={m.id} value={`member:${m.id}`}>{fullName(m)}</option>)}
        </select>
        <button className="btn btn-sm" disabled={!adding}><UserPlus size={16} />Add</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={addName}>Add by name</button>
        {notIn.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => addPeople(notIn.map((m) => ({ member_id: m.id, person_name: null })))}>Add everyone</button>}
      </form>

      <label className="field"><span>Notes</span>
        <textarea className="input" rows={3} defaultValue={review.notes ?? ""} onBlur={(e) => { const t = e.target.value.trim() || null; if (t !== review.notes) patchReview({ notes: t }); }} />
      </label>

      {traitsOpen && <TraitsSheet mode="review" traits={traits} onSave={(t) => patchReview({ traits: t })} onClose={() => setTraitsOpen(false)} />}
      {history && allReviews && <PersonHistory who={history} reviews={allReviews.reviews} people={allReviews.people} onClose={() => setHistory(null)} />}
    </div>
  );
}

// ─── One person across reviews ──────────────────────────────────────────────

function PersonHistory({ who, reviews, people, onClose }: {
  who: Pick<Person, "member_id" | "person_name">; reviews: Review[]; people: Person[]; onClose: () => void;
}) {
  const { byId } = useMembers();
  const same = (p: Person) => (who.member_id ? p.member_id === who.member_id : !p.member_id && (p.person_name ?? "").trim().toLowerCase() === (who.person_name ?? "").trim().toLowerCase());
  const rows = useMemo(() => {
    const byReview = new Map(reviews.map((r) => [r.id, r]));
    return people.filter(same).map((p) => ({ p, r: byReview.get(p.review_id)! })).filter((x) => x.r && !x.r.deleted_at)
      .sort((a, b) => b.r.reviewed_on.localeCompare(a.r.reviewed_on));
  }, [reviews, people]); // eslint-disable-line react-hooks/exhaustive-deps
  // Columns: every trait these reviews used, matched by name so renamed copies line up.
  const cols: string[] = [];
  for (const { r } of rows) for (const t of r.traits) if (!cols.includes(w(t.title))) cols.push(w(t.title));
  return (
    <Sheet title={nameOf(who, byId)} onClose={onClose} wide>
      {rows.length === 0 ? <Empty>No reviews yet.</Empty> : (
        <div className="pr-wrap">
          <table className="pr-table pr-history">
            <thead><tr><th className="pr-name">Review</th>{cols.map((c) => <th key={c} className="pr-trait" title={c}><span>{c}</span></th>)}<th className="pr-gap" aria-hidden><i className="pr-gap-in" /></th></tr></thead>
            <tbody>
              {rows.map(({ p, r }) => (
                <tr key={p.id}>
                  <td className="pr-name"><Link to={`/people-review/${r.id}`} onClick={onClose}>{fmtDay(r.reviewed_on, true)}</Link></td>
                  {cols.map((c) => {
                    const t = r.traits.find((x) => w(x.title) === c);
                    const v = t ? p.ratings[t.id] : undefined;
                    return <td key={c} className={`pr-cell ${t ? ratingClass(passes(t, v)) : "pr-none"}`}><span>{t ? v ?? "" : "·"}</span></td>;
                  })}
                  <td className="pr-gap" aria-hidden />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Newest first. A dot means that review didn't have the trait.</p>
    </Sheet>
  );
}

// ─── Traits: the company default, or one review's own columns ───────────────

function TraitsSheet(props: { mode: "default"; onClose: () => void } | { mode: "review"; traits: Trait[]; onSave: (t: Trait[]) => void; onClose: () => void }) {
  const { company } = useMe();
  const [list, setList] = useState<Trait[] | null>(props.mode === "review" ? props.traits : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<string[]>([]);

  useEffect(() => {
    if (props.mode === "default") loadDefaults().then((d) => setList(d.map(({ id, title, kind, scale, bar }) => ({ id, title, kind, scale, bar }))));
    // The values in the official plan, for the Add values button.
    (async () => {
      const { data: v } = await supabase.from("ss_plan_versions").select("id").eq("status", "official").maybeSingle();
      if (!v) return;
      const { data: its } = await supabase.from("ss_plan_items").select("title, sort_order").eq("version_id", v.id).eq("section", "value").order("sort_order");
      setValues(((its ?? []) as { title: string }[]).map((i) => i.title).filter((t) => t?.trim()));
    })();
  }, [props.mode]);

  if (!list) return <Sheet title="Traits" onClose={props.onClose}><p className="muted">Loading…</p></Sheet>;
  const set = (i: number, p: Partial<Trait>) => setList(list.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const move = (i: number, d: -1 | 1) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; setList(l); };
  const has = (title: string) => list.some((t) => w(t.title).toLowerCase() === w(title).toLowerCase());
  const missingRole = ROLE_TRAITS.filter((t) => !has(t.title));
  const missingValues = values.filter((v) => !has(v));

  const save = async () => {
    const clean = list.map((t) => ({ ...t, title: t.title.trim(), bar: STEPS[t.scale].includes(t.bar) ? t.bar : STEPS[t.scale][STEPS[t.scale].length - 1] }))
      .filter((t) => t.title);
    if (props.mode === "review") { props.onSave(clean); props.onClose(); return; }
    setSaving(true); setError(null);
    const old = await loadDefaults();
    const keep = new Set(clean.map((t) => t.id));
    const gone = old.filter((t) => !keep.has(t.id)).map((t) => t.id);
    if (gone.length) {
      const { error } = await supabase.from("ss_review_traits").delete().in("id", gone);
      if (error) { setError(friendlyError(error)); setSaving(false); return; }
    }
    const { error } = await supabase.from("ss_review_traits")
      .upsert(clean.map((t, i) => ({ id: t.id, company_id: company.id, title: t.title, kind: t.kind, scale: t.scale, bar: t.bar, sort_order: i })));
    setSaving(false);
    if (error) setError(friendlyError(error)); else props.onClose();
  };

  return (
    <Sheet title={props.mode === "default" ? "Default traits" : "Columns for this review"} onClose={props.onClose}>
      <p className="small muted">
        {props.mode === "default"
          ? "Every new review starts with these. Changing them doesn't change past reviews."
          : "Changes here apply to this review only. The defaults stay as they are."}
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="stack pr-traits" style={{ gap: 8 }}>
        {list.map((t, i) => (
          <li key={t.id} className="row pr-trait-row">
            <input className="input input-sm" style={{ flex: "1 1 160px" }} aria-label="Trait" value={w(t.title)} onChange={(e) => set(i, { title: e.target.value })} />
            <select className="input input-sm" aria-label="Rated with" value={t.scale}
              onChange={(e) => { const scale = e.target.value as Scale; set(i, { scale, bar: scale === "yes_no" ? "Y" : "+/-" }); }}>
              <option value="plus">+ / +/- / -</option><option value="yes_no">Y / N</option>
            </select>
            <label className="row small" style={{ gap: 4 }}>Bar
              <select className="input input-sm" value={t.bar} onChange={(e) => set(i, { bar: e.target.value as Rating })}>
                {STEPS[t.scale].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button type="button" className="link-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="link-btn" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="link-btn" aria-label={`Remove ${w(t.title)}`} onClick={() => setList(list.filter((_, j) => j !== i))}><X size={16} /></button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={() => setList([...list, { id: newId(), title: "", kind: "custom", scale: "plus", bar: "+/-" }])}><Plus size={16} />Add a trait</button>
        {missingValues.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setList([...missingValues.map((v) => ({ id: newId(), title: v, kind: "value" as const, scale: "plus" as const, bar: "+/-" as Rating })), ...list])}>
          Add values from the {w("Vision and Plan")}</button>}
        {missingRole.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
          // Keep the three role traits together and in their usual order.
          const roles = ROLE_TRAITS.map((r) => list.find((t) => w(t.title).toLowerCase() === w(r.title).toLowerCase()) ?? { ...r, id: newId() });
          const at = list.findIndex((t) => roles.includes(t));
          const rest = list.filter((t) => !roles.includes(t));
          const i = at < 0 ? rest.length : list.slice(0, at).filter((t) => !roles.includes(t)).length;
          setList([...rest.slice(0, i), ...roles, ...rest.slice(i)]);
        }}>
          Add {missingRole.map((t) => w(t.title)).join(", ")}</button>}
      </div>
      <div className="row"><span className="spacer" /><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></div>
    </Sheet>
  );
}

