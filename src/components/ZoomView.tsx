import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

const MIN = 0.2, MAX = 2.5;
const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

/**
 * A window that fills the rest of the screen and shows its content zoomed to fit, with pinch, wheel and
 * + / − / Fit to zoom and a drag to move around. Taps and buttons inside still work: a press only becomes
 * a pan once it moves a few pixels, and drag handles or form controls inside are left alone.
 */
export function ZoomView({ children, refitKey }: { children: ReactNode; refitKey?: unknown }) {
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, s: 1 });
  const tRef = useRef(t);
  tRef.current = t;
  const [height, setHeight] = useState<number | null>(null);

  // Fill the screen below the window's top edge (above the phone tab bar).
  const size = useCallback(() => {
    const el = view.current;
    if (!el) return;
    // The page's own bottom padding already leaves room for the phone tab bar.
    const page = el.closest(".content");
    const bottom = page ? parseFloat(getComputedStyle(page).paddingBottom) || 0 : 0;
    setHeight(Math.max(320, Math.floor(window.innerHeight - el.getBoundingClientRect().top - bottom - 2)));
  }, []);

  const fit = useCallback(() => {
    const v = view.current, c = canvas.current;
    if (!v || !c) return;
    const w = c.scrollWidth, h = c.scrollHeight;
    const vw = v.clientWidth, vh = v.clientHeight;
    if (!w || !h || !vw || !vh) return;
    const s = clamp(Math.min((vw - 24) / w, (vh - 24) / h, 1));
    setT({ s, x: (vw - w * s) / 2, y: Math.max(12, (vh - h * s) / 2) });
  }, []);

  useLayoutEffect(() => { size(); }, [size]);
  useEffect(() => {
    const onResize = () => { size(); requestAnimationFrame(fit); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size, fit]);
  // Fit when the window first has a size, and whenever the content changes shape.
  useEffect(() => { requestAnimationFrame(fit); }, [height, refitKey, fit]);

  /** Zoom by `factor`, keeping the point (px, py) inside the window still. */
  const zoomAt = (factor: number, px: number, py: number) => {
    const { x, y, s } = tRef.current;
    const ns = clamp(s * factor);
    const k = ns / s;
    setT({ s: ns, x: px - (px - x) * k, y: py - (py - y) * k });
  };
  const zoomCenter = (factor: number) => {
    const v = view.current;
    if (v) zoomAt(factor, v.clientWidth / 2, v.clientHeight / 2);
  };

  // Wheel and trackpad pinch zoom; a plain trackpad scroll moves the chart.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= 40 && e.deltaMode === 0 && !e.deltaX) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else setT((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, []);

  // Drag to pan (one finger or the mouse), pinch to zoom (two fingers).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; panning: boolean; dist?: number } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".drag-handle, input, select, textarea, .zoom-controls")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { startX: e.clientX, startY: e.clientY, panning: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { startX: 0, startY: 0, panning: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      view.current?.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && g.dist) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = view.current!.getBoundingClientRect();
      zoomAt(d / g.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      g.dist = d;
      suppressClick.current = true;
      return;
    }
    if (!g.panning && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 5) {
      g.panning = true;
      suppressClick.current = true;
      view.current?.setPointerCapture(e.pointerId);
    }
    if (g.panning) setT((p) => ({ ...p, x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { startX: p.x, startY: p.y, panning: true };
    }
  };

  return (
    <div ref={view} className={`zoom-view${gesture.current?.panning ? " is-panning" : ""}`} style={height ? { height } : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}>
      <div ref={canvas} className="zoom-canvas" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>{children}</div>
      <div className="zoom-controls no-print">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomCenter(1 / 1.25)}><Minus size={18} /></button>
        <span className="zoom-pct">{Math.round(t.s * 100)}%</span>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomCenter(1.25)}><Plus size={18} /></button>
        <button type="button" aria-label="Fit to window" title="Fit to window" onClick={fit}><Maximize2 size={16} /></button>
      </div>
    </div>
  );
}
