import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Download, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, useMeetings, useMembers, useOpenParam, type Headline } from "../lib/data";
import { Comments } from "../components/Comments";
import { FilterButton, FilterPanel, MineToggle, ownerMatches, ownerOptions, useFilters } from "../components/Filters";
import { downloadCsv } from "../lib/csv";
import { fullName } from "../lib/supabase";
import { addDays, today } from "../lib/data";
import { Attachments } from "../components/Attachments";
import { Avatar, Empty, Menu, OwnerSelect, Section } from "../components/ui";
import { Sheet } from "../components/Sheet";

const KIND: Record<Headline["kind"], string> = { general: "General", customer: "Customer", employee: "Employee" };

export function Headlines() {
  const { me, company } = useMe();
  const { active, byId, members } = useMembers();
  const DEFAULTS = { owner: "all", kind: "all", status: "all", added: "any" };
  const filters = useFilters("headlines", DEFAULTS);
  const f = filters.values;
  const { defaultMeetingId } = useMeetings();
  const [items, setItems] = useState<Headline[] | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Headline["kind"]>("general");
  const [showReviewed, setShowReviewed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Headline | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_headlines").select("*").is("deleted_at", null).is("archived_at", null)
      .order("created_at", { ascending: false });
    setItems((data ?? []) as Headline[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useOpenParam(items, "ss_headlines", setEditing);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("ss_headlines").insert({
      company_id: company.id, meeting_id: defaultMeetingId, owner_member_id: me.id, title: title.trim(), kind, created_by: me.id,
    });
    if (error) setError(friendlyError(error)); else { setTitle(""); setError(""); load(); }
  };
  const review = async (h: Headline, reviewed: boolean) => {
    await supabase.from("ss_headlines").update({ status: reviewed ? "reviewed" : "to_review" }).eq("id", h.id);
    load();
  };

  const shown = (items ?? []).filter((h) => ownerMatches(f.owner, h.owner_member_id, me.id)
    && (f.kind === "all" || h.kind === f.kind) && (f.status === "all" || h.status === f.status)
    && (f.added === "any" || h.created_at.slice(0, 10) >= addDays(today(), f.added === "7" ? -7 : -30)));
  const fields = [
    { key: "owner", label: "Owner", options: ownerOptions(members, me.id) },
    { key: "kind", label: "Kind", options: [{ value: "all", label: "Any kind" }, ...(Object.keys(KIND) as Headline["kind"][]).map((k) => ({ value: k, label: KIND[k] }))] },
    { key: "status", label: "Status", options: [{ value: "all", label: "Any" }, { value: "to_review", label: "To review" }, { value: "reviewed", label: "Reviewed" }] },
    { key: "added", label: "Added", options: [{ value: "any", label: "Any time" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }] },
  ];
  const toReview = shown.filter((h) => h.status === "to_review");
  const reviewed = shown.filter((h) => h.status === "reviewed");
  const extra = filters.active - (f.owner !== DEFAULTS.owner ? 1 : 0);
  const exportCsv = () => downloadCsv(`headlines-${today()}`, ["Title", "Owner", "Kind", "Status", "Added"],
    shown.map((h) => { const o = byId(h.owner_member_id); return [h.title, o ? fullName(o) : "", KIND[h.kind], h.status === "reviewed" ? "Reviewed" : "To review", h.created_at.slice(0, 10)]; }));
  const row = (h: Headline) => (
    <li key={h.id} className="clickable" onClick={() => setEditing(h)}>
      <Avatar m={byId(h.owner_member_id)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title">{h.title}</div>
        <div className="row small muted" style={{ gap: 8 }}>
          <span>{byId(h.owner_member_id)?.first_name}</span><span>{KIND[h.kind]}</span><span>{fmtDay(h.created_at)}</span>
        </div>
      </div>
      {h.status === "to_review"
        ? <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); review(h, true); }}><Check size={16} />Reviewed</button>
        : <button className="btn btn-sm btn-ghost" aria-label="Back to review" onClick={(e) => { e.stopPropagation(); review(h, false); }}><RotateCcw size={16} /></button>}
    </li>
  );

  return (
    <div className="stack">
      <div className="page-head goals-head"><h1>Headlines</h1></div>
      <h2 className="print-only">Headlines</h2>
      <div className="toolbar no-print">
        <MineToggle value={f.owner} onChange={(v) => filters.set("owner", v)} />
        <span className="spacer" />
        <FilterButton open={showFilters} active={filters.active} onToggle={() => setShowFilters(!showFilters)} />
        <Menu items={[
          { label: "Print", icon: <Printer size={16} />, onSelect: () => print() },
          { label: "Export CSV", icon: <Download size={16} />, onSelect: exportCsv },
        ]} />
      </div>
      {showFilters && <FilterPanel fields={fields} values={f} defaults={DEFAULTS} onChange={(k, v) => filters.set(k as keyof typeof f, v)} onReset={filters.reset}
        active={filters.active} shown={shown.length} total={(items ?? []).length} />}
      {!showFilters && extra > 0 && items && (
        <p className="small muted no-print" style={{ margin: 0 }}>Showing {shown.length} of {items.length} · <button type="button" className="link-btn" onClick={filters.reset}>Clear filters</button></p>
      )}
      <p className="small muted">Short good or bad news about customers and people, shared at the meeting.</p>
      <form className="card card-pad stack no-print" style={{ gap: 10 }} onSubmit={add}>
        <div className="row">
          <input className="input" placeholder="Add a Headline…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!title.trim()} aria-label="Add Headline"><Plus size={18} /></button>
        </div>
        <div className="chips">
          {(Object.keys(KIND) as Headline["kind"][]).map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? " chip-on" : ""}`} onClick={() => setKind(k)}>{KIND[k]}</button>
          ))}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {items === null ? <p className="muted">Loading…</p> : <>
        <Section title="To review" count={toReview.length}>
          {toReview.length ? <ul className="card list">{toReview.map(row)}</ul> : <Empty>Nothing waiting for the next meeting.</Empty>}
        </Section>
        {reviewed.length > 0 && (
          <Section title="Reviewed" count={reviewed.length}
            action={<button className="btn btn-ghost btn-sm" onClick={() => setShowReviewed(!showReviewed)}>{showReviewed ? "Hide" : "Show"}</button>}>
            {(showReviewed || f.status === "reviewed") && <ul className="card list">{reviewed.map(row)}</ul>}
          </Section>
        )}
      </>}
      {editing && <HeadlineSheet h={editing} members={active} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function HeadlineSheet({ h, members, onClose, onSaved }: {
  h: Headline; members: ReturnType<typeof useMembers>["active"]; onClose: () => void; onSaved: () => void;
}) {
  const { me, company } = useMe();
  const [form, setForm] = useState({ title: h.title, description: h.description ?? "", owner_member_id: h.owner_member_id, kind: h.kind });
  const [error, setError] = useState("");
  const run = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) setError(friendlyError(error)); else onSaved();
  };
  return (
    <Sheet title="Headline" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(supabase.from("ss_headlines").update({ ...form, title: form.title.trim(), description: form.description.trim() || null }).eq("id", h.id)); }}>
        <label className="field"><span>Headline</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field"><span>Details</span><textarea className="input textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field"><span>Owner</span><OwnerSelect members={members} allowNone value={form.owner_member_id} onChange={(v) => setForm({ ...form, owner_member_id: v })} /></label>
          <label className="field"><span>Kind</span>
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Headline["kind"] })}>
              {(Object.keys(KIND) as Headline["kind"][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">Save</button>
        <div className="row wrap">
          <button type="button" className="btn btn-sm" onClick={() => run(supabase.from("ss_issues").insert({
            company_id: company.id, meeting_id: h.meeting_id, owner_member_id: h.owner_member_id, title: h.title,
            description: h.description, source_type: "headline", source_id: h.id, created_by: me.id,
          }))}><CircleAlert size={16} />Drop into Issues</button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-danger" onClick={() => run(supabase.from("ss_headlines").update({ deleted_at: new Date().toISOString() }).eq("id", h.id))}>
            <Trash2 size={16} />Recycle bin
          </button>
        </div>
      </form>
      <div style={{ marginTop: 20 }}><Attachments itemType="headline" itemId={h.id} /></div>
      <div style={{ marginTop: 20 }}><Comments itemType="headline" itemId={h.id} /></div>
    </Sheet>
  );
}
