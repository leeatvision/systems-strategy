import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { supabase } from "../lib/supabase";

/** The list with the item at `from` moved to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const l = [...list];
  const [x] = l.splice(from, 1);
  l.splice(to, 0, x);
  return l;
}

/** The nearest ancestor that scrolls up and down (or the page). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

interface Drag { from: number; over: number; dy: number; startY: number; startScroll: number; mids: number[]; shift: number }

/**
 * Drag to reorder a list, with mouse, touch or keyboard. Put `itemProps(i)` on each item and spread
 * `handleProps(i, name)` on a grip button (or use <DragHandle>). While dragging, the item follows the
 * pointer and the others slide aside; on release `onMove(from, to)` is called once.
 * Keyboard: focus the grip and press ↑ or ↓.
 */
export function useDragSort(count: number, onMove: (from: number, to: number) => void) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const pointerY = useRef(0);
  const raf = useRef(0);
  const refocus = useRef<number | null>(null);

  const scrollTop = () => (scroller.current ? scroller.current.scrollTop : window.scrollY);
  const update = useCallback((clientY: number) => {
    const d = live.current;
    if (!d) return;
    const y = clientY + (scrollTop() - d.startScroll);
    let over = 0;
    d.mids.forEach((m, j) => { if (j !== d.from && m < y) over++; });
    const next = { ...d, over: Math.min(Math.max(over, 0), count - 1), dy: y - d.startY };
    live.current = next;
    setDrag(next);
  }, [count]);

  // Scroll the list (or page) while the pointer is near its top or bottom edge.
  const autoScroll = useCallback(() => {
    if (!live.current) return;
    const box = scroller.current ? scroller.current.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const y = pointerY.current, edge = 56;
    const speed = y < box.top + edge ? -Math.ceil((box.top + edge - y) / 6) : y > box.bottom - edge ? Math.ceil((y - (box.bottom - edge)) / 6) : 0;
    if (speed) {
      if (scroller.current) scroller.current.scrollTop += speed; else window.scrollBy(0, speed);
      update(y);
    }
    raf.current = requestAnimationFrame(autoScroll);
  }, [update]);

  const start = (i: number, e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || count < 2) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scroller.current = scrollParent(items.current[i]);
    const rects = items.current.slice(0, count).map((el) => el?.getBoundingClientRect());
    const r = rects[i];
    if (!r) return;
    const neighbour = rects[i + 1] ?? rects[i - 1];
    const gap = neighbour ? Math.max(0, i + 1 < count ? neighbour.top - r.bottom : r.top - neighbour.bottom) : 0;
    pointerY.current = e.clientY;
    live.current = { from: i, over: i, dy: 0, startY: e.clientY, startScroll: scrollTop(), mids: rects.map((x) => (x ? x.top + x.height / 2 : 0)), shift: r.height + gap };
    setDrag(live.current);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(autoScroll);
  };
  const move = (e: RPointerEvent<HTMLElement>) => {
    if (!live.current) return;
    pointerY.current = e.clientY;
    update(e.clientY);
  };
  const end = () => {
    const d = live.current;
    live.current = null;
    cancelAnimationFrame(raf.current);
    setDrag(null);
    if (d && d.over !== d.from) onMove(d.from, d.over);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const key = (i: number, e: KeyboardEvent<HTMLElement>) => {
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to < 0 || to >= count) return;
    refocus.current = to;
    onMove(i, to);
  };
  // After a keyboard move, keep focus on the grip of the item that moved.
  useEffect(() => {
    if (refocus.current === null) return;
    const el = items.current[refocus.current]?.querySelector<HTMLElement>("[data-drag-handle]");
    if (el) { el.focus(); refocus.current = null; }
  });

  const itemProps = (i: number) => {
    let style: CSSProperties | undefined;
    let className = "";
    if (drag) {
      if (i === drag.from) { style = { transform: `translateY(${drag.dy}px)` }; className = "drag-lifted"; }
      else {
        const by = drag.from < drag.over && i > drag.from && i <= drag.over ? -drag.shift
          : drag.over < drag.from && i >= drag.over && i < drag.from ? drag.shift : 0;
        style = { transform: by ? `translateY(${by}px)` : undefined, transition: "transform 150ms ease" };
        className = "drag-sibling";
      }
    }
    return { ref: (el: HTMLElement | null) => { items.current[i] = el; }, style, className };
  };
  const handleProps = (i: number, name: string) => ({
    "data-drag-handle": "",
    "aria-label": `Reorder ${name}: drag, or press up or down`,
    title: "Drag to reorder (or focus and press ↑ ↓)",
    onPointerDown: (e: RPointerEvent<HTMLElement>) => start(i, e),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => key(i, e),
    onClick: (e: { stopPropagation: () => void; preventDefault: () => void }) => { e.stopPropagation(); e.preventDefault(); },
  });
  return { itemProps, handleProps, dragging: drag !== null };
}

/** The grip to drag by. */
export function DragHandle(props: ReturnType<ReturnType<typeof useDragSort>["handleProps"]> & { className?: string }) {
  const { className, ...rest } = props;
  return <button type="button" className={`drag-handle-btn ${className ?? ""}`} {...rest}><GripVertical size={16} /></button>;
}

/**
 * Rows in the order just dragged to, until the saved order comes back. `save` gets every row in the new order.
 */
export function useOrderedRows<T extends { id: string }>(rows: T[], save: (ordered: T[]) => unknown) {
  const [order, setOrder] = useState<string[] | null>(null);
  const key = rows.map((r) => r.id).join();
  useEffect(() => { setOrder(null); }, [key]);
  const shown = order ? (order.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as T[]) : rows;
  const reorder = (from: number, to: number) => {
    const next = moved(shown, from, to);
    setOrder(next.map((r) => r.id));
    save(next);
  };
  return { shown, reorder };
}

/** Save an order: each row's sort_order becomes its position (only rows that changed are written). */
export async function saveSortOrder(table: string, rows: { id: string; sort_order: number }[]): Promise<unknown> {
  const results = await Promise.all(rows.map((r, i) => (r.sort_order === i ? null : supabase.from(table).update({ sort_order: i }).eq("id", r.id))));
  return results.find((r) => r?.error)?.error ?? null;
}
