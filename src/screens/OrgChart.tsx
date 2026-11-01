import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BadgeCheck, Copy, GripVertical, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { friendlyError, fullName, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay, useMembers } from "../lib/data";
import { Avatar, Empty, OwnerChips } from "../components/ui";
import { Sheet } from "../components/Sheet";

interface Chart { id: string; title: string; status: "draft" | "official" | "archived"; published_at: string | null; updated_at: string }
interface Position {
  id: string; chart_id: string; parent_position_id: string | null; title: string; position_role: "vision_lead" | "operations_lead" | "none";
  is_assistant: boolean; roles: string[]; notes: string | null; sort_order: number;
}
interface Holder { id: string; position_id: string; member_id: string | null; placeholder_name: string | null; is_primary: boolean }

const ROLE_BADGE = { vision_lead: "Vision Lead", operations_lead: "Operations Lead", none: "" };

export function ChartScreen() {
  const { me, company, isOwner } = useMe();
  const { byId } = useMembers();
  const [charts, setCharts] = useState<Chart[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [editing, setEditing] = useState<{ position: Position | null; parent: string | null } | null>(null);
  const [error, setError] = useState("");
  // A position being dragged by its handle: where the pointer is and which drop target ("top" or a position id) it's over.
  const [drag, setDrag] = useState<{ id: string; title: string; x: number; y: number; over: string | null } | null>(null);
  const dragging = drag !== null;
  // While dragging, the page scrolls on its own when the pointer is near the top or bottom edge,
  // so a position can reach any part of a long chart (on a phone especially).
  const pointer = useRef({ x: 0, y: 0 });
  const retarget = useRef<() => void>(() => {});
  useEffect(() => {
    if (!dragging) return;
    const cancel = (e: KeyboardEvent) => { if (e.key === "Escape") setDrag(null); };
    window.addEventListener("keydown", cancel);
    const edge = 90;
    const timer = window.setInterval(() => {
      const { y } = pointer.current;
      const step = y < edge ? -Math.ceil((edge - y) / 6) : y > window.innerHeight - edge ? Math.ceil((y - (window.innerHeight - edge)) / 6) : 0;
      if (step) { window.scrollBy(0, step); retarget.current(); }
    }, 16);
    return () => { window.removeEventListener("keydown", cancel); window.clearInterval(timer); };
  }, [dragging]);

  const load = useCallback(async (pick?: string) => {
    const { data } = await supabase.from("ss_org_charts").select("id, title, status, published_at, updated_at").neq("status", "archived").order("created_at", { ascending: false });
    const list = (data ?? []) as Chart[];
    setCharts(list);
    const wanted = pick ?? current;
    const id = (wanted && list.some((c) => c.id === wanted) ? wanted : null) ?? list.find((c) => c.status === "official")?.id ?? list[0]?.id ?? null;
    setCurrent(id);
    if (!id) { setPositions([]); setHolders([]); return; }
    const { data: s } = await supabase.from("ss_positions").select("*").eq("chart_id", id).order("sort_order");
    const positionList = (s ?? []) as Position[];
    setPositions(positionList);
    const { data: h } = positionList.length ? await supabase.from("ss_position_holders").select("*").in("position_id", positionList.map((x) => x.id)) : { data: [] };
    setHolders((h ?? []) as Holder[]);
  }, [current]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const chart = charts?.find((c) => c.id === current) ?? null;

  const createChart = async (from: Chart | null) => {
    const { data, error } = await supabase.from("ss_org_charts")
      .insert({ company_id: company.id, title: from?.title ?? "Org Chart", status: "draft", created_by: me.id }).select("id").single();
    if (error) { setError(friendlyError(error)); return; }
    if (from) {
      // Copy parents before children so each copy can point at its parent's copy.
      const map = new Map<string, string>();
      const pending = [...positions];
      while (pending.length) {
        const i = pending.findIndex((s) => !s.parent_position_id || map.has(s.parent_position_id));
        if (i < 0) break;
        const [s] = pending.splice(i, 1);
        const { data: copy } = await supabase.from("ss_positions").insert({
          company_id: company.id, chart_id: data.id, parent_position_id: s.parent_position_id ? map.get(s.parent_position_id) : null, title: s.title,
          position_role: s.position_role, is_assistant: s.is_assistant, roles: s.roles, notes: s.notes, sort_order: s.sort_order,
        }).select("id").single();
        if (copy) map.set(s.id, copy.id);
      }
      const copies = holders.filter((h) => map.has(h.position_id)).map((h) => ({
        company_id: company.id, position_id: map.get(h.position_id), member_id: h.member_id, placeholder_name: h.placeholder_name, is_primary: h.is_primary,
      }));
      if (copies.length) await supabase.from("ss_position_holders").insert(copies);
    }
    load(data.id);
  };
  const publish = async () => {
    if (!chart || !confirm("Make this the official Org Chart? The current official one is kept as an archived version.")) return;
    const official = charts?.find((c) => c.status === "official");
    if (official) await supabase.from("ss_org_charts").update({ status: "archived" }).eq("id", official.id);
    const { error } = await supabase.from("ss_org_charts").update({ status: "official", published_at: new Date().toISOString() }).eq("id", chart.id);
    if (error) setError(friendlyError(error)); else load(chart.id);
  };

  if (charts === null) return <p className="muted">Loading…</p>;
  if (!chart) {
    return (
      <div className="stack">
        <h1>Org Chart</h1>
        <Empty>No chart yet.{isOwner ? " Start with the top Positions and build down." : " An owner can start it."}</Empty>
        {isOwner && <button className="btn btn-primary" onClick={() => createChart(null)}><Plus size={16} />Start the chart</button>}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const children = (parent: string | null) => positions.filter((s) => s.parent_position_id === parent).sort((a, b) => a.sort_order - b.sort_order);

  /** The position and every position under it: a position can't be moved under any of these. */
  const branch = (id: string) => {
    const out = new Set<string>([id]);
    const walk = (p: string) => positions.filter((x) => x.parent_position_id === p).forEach((x) => { out.add(x.id); walk(x.id); });
    walk(id);
    return out;
  };

  /** Moves a position (with everything under it) to report to another position, or to the top, as the last of its new siblings. */
  const moveUnder = async (id: string, parent: string | null) => {
    const position = positions.find((x) => x.id === id);
    if (!position || position.parent_position_id === parent || (parent && branch(id).has(parent))) return;
    const sort_order = Math.max(0, ...children(parent).map((x) => x.sort_order)) + 1;
    setPositions(positions.map((x) => (x.id === id ? { ...x, parent_position_id: parent, sort_order } : x)));
    const { error } = await supabase.from("ss_positions").update({ parent_position_id: parent, sort_order }).eq("id", id);
    if (error) setError(friendlyError(error));
    load(chart.id);
  };

  /** Swaps a position with its neighbour among the positions that report to the same position. */
  const shift = async (s: Position, by: -1 | 1) => {
    const sibs = children(s.parent_position_id);
    const i = sibs.findIndex((x) => x.id === s.id);
    const other = sibs[i + by];
    if (!other) return;
    // Renumber so equal or missing sort orders still swap cleanly.
    const order = sibs.map((x) => x.id);
    [order[i], order[i + by]] = [order[i + by], order[i]];
    setPositions(positions.map((x) => (order.includes(x.id) ? { ...x, sort_order: order.indexOf(x.id) + 1 } : x)));
    const results = await Promise.all(order.map((id, n) => supabase.from("ss_positions").update({ sort_order: n + 1 }).eq("id", id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(friendlyError(failed.error));
    load(chart.id);
  };

  // Dragging works the same with a mouse, a finger or a pen: the handle captures the pointer
  // and whatever drop target is under it lights up.
  const dropTargetAt = (x: number, y: number, id: string) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
    const target = el?.dataset.drop ?? null;
    if (!target) return null;
    if (target === "top") return positions.find((x) => x.id === id)?.parent_position_id ? "top" : null;
    return branch(id).has(target) || positions.find((x) => x.id === id)?.parent_position_id === target ? null : target;
  };
  retarget.current = () => setDrag((d) => (d ? { ...d, over: dropTargetAt(pointer.current.x, pointer.current.y, d.id) } : d));
  const dragHandle = (s: Position) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pointer.current = { x: e.clientX, y: e.clientY };
      setDrag({ id: s.id, title: s.title, x: e.clientX, y: e.clientY, over: null });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag?.id !== s.id) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      setDrag({ ...drag, x: e.clientX, y: e.clientY, over: dropTargetAt(e.clientX, e.clientY, s.id) });
    },
    onPointerUp: () => {
      if (drag?.id !== s.id) return;
      const over = drag.over;
      setDrag(null);
      if (over) moveUnder(s.id, over === "top" ? null : over);
    },
    onPointerCancel: () => setDrag(null),
  });

  const node = (s: Position) => {
    const hs = holders.filter((h) => h.position_id === s.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    const kids = children(s.id);
    return (
      <li key={s.id} className="org-node">
        <div data-drop={isOwner ? s.id : undefined}
          className={`position${s.is_assistant ? " position-assistant" : ""}${drag?.over === s.id ? " drop-ok" : ""}${drag?.id === s.id ? " is-dragging" : ""}`}>
          <div className="row" style={{ gap: 6 }}>
            {isOwner && <button type="button" className="drag-handle no-print" aria-label={`Drag ${s.title} to move it under another Position`}
              title="Drag onto another Position to move it there" {...dragHandle(s)}><GripVertical size={16} /></button>}
            <strong className="position-title">{s.title}</strong>
            {s.position_role !== "none" && <span className="badge badge-green">{ROLE_BADGE[s.position_role]}</span>}
            {s.is_assistant && <span className="badge">Assistant</span>}
          </div>
          <div className="position-people">
            {hs.length ? hs.map((h) => {
              const m = h.member_id ? byId(h.member_id) : undefined;
              return <span key={h.id} className="row small" style={{ gap: 6 }}>{m ? <><Avatar m={m} size={22} />{fullName(m)}</> : <span className="muted">{h.placeholder_name ?? "Open Position"}</span>}</span>;
            }) : <span className="small muted">Open Position</span>}
          </div>
          {s.roles.length > 0 && <ul className="position-roles">{s.roles.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {isOwner && <div className="row no-print" style={{ gap: 4, justifyContent: "flex-end" }}>
            <button className="link-btn" aria-label={`Edit ${s.title}`} onClick={() => setEditing({ position: s, parent: s.parent_position_id })}><Pencil size={14} /></button>
            <button className="link-btn" aria-label={`Add a Position under ${s.title}`} onClick={() => setEditing({ position: null, parent: s.id })}><Plus size={14} /></button>
            <span className="spacer" />
            <button className="link-btn" aria-label={`Move ${s.title} earlier`} title="Move earlier" disabled={children(s.parent_position_id)[0]?.id === s.id} onClick={() => shift(s, -1)}>
              <span className="ic-tree"><ArrowLeft size={14} /></span><span className="ic-list"><ArrowUp size={14} /></span></button>
            <button className="link-btn" aria-label={`Move ${s.title} later`} title="Move later" disabled={children(s.parent_position_id).at(-1)?.id === s.id} onClick={() => shift(s, 1)}>
              <span className="ic-tree"><ArrowRight size={14} /></span><span className="ic-list"><ArrowDown size={14} /></span></button>
          </div>}
        </div>
        {kids.length > 0 && <ul className="org-kids">{kids.map(node)}</ul>}
      </li>
    );
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{chart.title}</h1>
        <span className={`badge ${chart.status === "official" ? "badge-green" : "badge-warn"}`}>{chart.status === "official" ? "Official" : "Draft"}</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost no-print" onClick={() => print()} aria-label="Print" title="Print"><Printer size={18} /></button>
      </div>
      <div className="row wrap no-print">
        {charts.length > 1 && (
          <select className="select" style={{ width: "auto" }} value={chart.id} onChange={(e) => load(e.target.value)}>
            {charts.map((c) => <option key={c.id} value={c.id}>{c.status === "official" ? "Official" : "Draft"} · {fmtDay(c.updated_at, true)}</option>)}
          </select>
        )}
        {isOwner && <button className="btn btn-sm" onClick={() => setEditing({ position: null, parent: null })}><Plus size={16} />Top Position</button>}
        <span className="spacer" />
        {!isOwner ? null : chart.status === "official"
          ? <button className="btn btn-sm" onClick={() => createChart(chart)}><Copy size={16} />Make a draft copy</button>
          : <>
              <button className="btn btn-sm btn-ghost" onClick={async () => { if (confirm("Archive this draft?")) { await supabase.from("ss_org_charts").update({ status: "archived" }).eq("id", chart.id); load(""); } }}>Archive draft</button>
              <button className="btn btn-sm btn-primary" onClick={publish}><BadgeCheck size={16} />Make official</button>
            </>}
      </div>
      {!isOwner && <p className="small muted no-print">Only owners can change the Org Chart.</p>}
      {error && <p className="error">{error}</p>}
      {isOwner && positions.length > 0 && <p className="small muted no-print">Drag a Position by its handle onto another Position to move it there, along with everyone under it.</p>}
      {drag && <div data-drop="top" className={`drop-top no-print${drag.over === "top" ? " drop-ok" : ""}`}>Drop here to make it a top Position</div>}
      {positions.length ? <div className="org-wrap"><ul className="org">{children(null).map(node)}</ul></div> : <Empty>No Positions yet. Add the top Position.</Empty>}
      {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}{drag.over && <span className="small"> → {drag.over === "top" ? "top Position" : positions.find((x) => x.id === drag.over)?.title}</span>}</div>}
      {editing && <PositionSheet position={editing.position} parent={editing.parent} chartId={chart.id} positions={positions} holders={holders}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(chart.id); }} />}
    </div>
  );
}

function PositionSheet({ position, parent, chartId, positions, holders, onClose, onSaved }: {
  position: Position | null; parent: string | null; chartId: string; positions: Position[]; holders: Holder[]; onClose: () => void; onSaved: () => void;
}) {
  const { company } = useMe();
  const { active } = useMembers();
  const mine = position ? holders.filter((h) => h.position_id === position.id) : [];
  const [form, setForm] = useState({
    title: position?.title ?? "", position_role: position?.position_role ?? ("none" as Position["position_role"]), is_assistant: position?.is_assistant ?? false,
    parent_position_id: position ? position.parent_position_id : parent, roles: (position?.roles ?? []).join("\n"), notes: position?.notes ?? "",
  });
  const [people, setPeople] = useState<string[]>(mine.filter((h) => h.member_id).map((h) => h.member_id!));
  const [placeholder, setPlaceholder] = useState(mine.find((h) => !h.member_id)?.placeholder_name ?? "");
  const [error, setError] = useState("");

  // A position can't move under itself or anything below it.
  const below = new Set<string>();
  if (position) {
    const walk = (id: string) => { below.add(id); positions.filter((s) => s.parent_position_id === id).forEach((s) => walk(s.id)); };
    walk(position.id);
  }

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const row = {
      title: form.title.trim(), position_role: form.position_role, is_assistant: form.is_assistant, parent_position_id: form.parent_position_id || null,
      roles: form.roles.split("\n").map((r) => r.trim()).filter(Boolean), notes: form.notes.trim() || null,
    };
    try {
      let id = position?.id;
      if (position) {
        const { error } = await supabase.from("ss_positions").update(row).eq("id", position.id);
        if (error) throw error;
      } else {
        const siblings = positions.filter((s) => s.parent_position_id === row.parent_position_id);
        const { data, error } = await supabase.from("ss_positions").insert({ ...row, company_id: company.id, chart_id: chartId,
          sort_order: siblings.reduce((n, s) => Math.max(n, s.sort_order), 0) + 1 }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (mine.length) await supabase.from("ss_position_holders").delete().eq("position_id", id!);
      const rows = people.map((m, i) => ({ company_id: company.id, position_id: id, member_id: m as string | null, placeholder_name: null as string | null, is_primary: i === 0 }));
      if (placeholder.trim()) rows.push({ company_id: company.id, position_id: id, member_id: null, placeholder_name: placeholder.trim(), is_primary: !people.length });
      if (rows.length) { const { error } = await supabase.from("ss_position_holders").insert(rows); if (error) throw error; }
      onSaved();
    } catch (err) { setError(friendlyError(err)); }
  };
  // Removing a position never takes the positions under it with it: they move up to where it was.
  const remove = async () => {
    if (!position) return;
    const kids = positions.filter((x) => x.parent_position_id === position.id);
    const to = positions.find((x) => x.id === position.parent_position_id)?.title ?? "the top";
    if (!confirm(kids.length ? `Remove ${position.title}? The ${kids.length} position${kids.length === 1 ? "" : "s"} under it move up to ${to}.` : `Remove ${position.title}?`)) return;
    if (kids.length) {
      const { error } = await supabase.from("ss_positions").update({ parent_position_id: position.parent_position_id }).in("id", kids.map((k) => k.id));
      if (error) { setError(friendlyError(error)); return; }
    }
    const { error } = await supabase.from("ss_positions").delete().eq("id", position.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  return (
    <Sheet title={position ? "Position" : "New Position"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Position</span><input className="input" required placeholder="e.g. Operations" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <div className="field"><span>Who sits here</span><OwnerChips members={active} value={people} onChange={setPeople} /></div>
        <label className="field"><span>…or a name for someone without a login, or "Open Position"</span>
          <input className="input" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
        </label>
        <label className="field"><span>Roles <span className="muted" style={{ fontWeight: 400 }}>· one per line, usually about five</span></span>
          <textarea className="input textarea" rows={5} value={form.roles} onChange={(e) => setForm({ ...form, roles: e.target.value })} />
        </label>
        <div className="grid-2">
          <label className="field"><span>Reports to</span>
            <select className="select" value={form.parent_position_id ?? ""} onChange={(e) => setForm({ ...form, parent_position_id: e.target.value || null })}>
              <option value="">Nobody (top Position)</option>
              {positions.filter((s) => !below.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="field"><span>Marker</span>
            <select className="select" value={form.position_role} onChange={(e) => setForm({ ...form, position_role: e.target.value as Position["position_role"] })}>
              <option value="none">None</option><option value="vision_lead">Vision Lead</option><option value="operations_lead">Operations Lead</option>
            </select>
          </label>
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_assistant} onChange={(e) => setForm({ ...form, is_assistant: e.target.checked })} />Assistant Position
        </label>
        <label className="field"><span>Notes</span><textarea className="input textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">{position ? "Save" : "Add Position"}</button>
        {position && <button type="button" className="btn btn-sm btn-danger" onClick={remove}><Trash2 size={16} />Remove Position</button>}
      </form>
    </Sheet>
  );
}

