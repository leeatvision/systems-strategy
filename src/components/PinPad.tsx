import { Delete } from "lucide-react";
import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/**
 * Six-digit PIN entry with an on-screen keypad; the hardware keyboard works too.
 * With `field`, the PIN shows in a real password box that password managers (Bitwarden, 1Password,
 * the browser's own) can fill and save; otherwise it shows as six dots.
 */
export function PinPad({ value, onChange, disabled, field }: {
  value: string; onChange: (v: string) => void; disabled?: boolean;
  field?: { autoComplete: "current-password" | "new-password"; id?: string; label?: string };
}) {
  // Quick taps can land before the screen redraws, so build on the latest PIN rather than the drawn one.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);

  const press = (k: string) => {
    if (disabled) return;
    const next = k === "del" ? latest.current.slice(0, -1) : latest.current.length < 6 ? latest.current + k : latest.current;
    if (next === latest.current) return;
    latest.current = next;
    onChange(next);
  };

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") press("del");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Register on touch-down for an instant response; clicks only count when they come from
  // the keyboard (Enter/Space on a focused key), so a tap is never counted twice.
  const handlers = (k: string) => ({
    onPointerDown: (e: PointerEvent) => { if (e.button === 0) { e.preventDefault(); press(k); } },
    onClick: (e: MouseEvent) => { if (e.detail === 0) press(k); },
  });

  return (
    <div className="stack" style={{ gap: 12 }}>
      {field ? (
        <input id={field.id} className="input pin-field" type="password" name="password" autoComplete={field.autoComplete}
          inputMode="numeric" pattern="[0-9]*" maxLength={6} aria-label={field.label ?? "PIN"} placeholder="••••••" disabled={disabled}
          value={value} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); latest.current = v; onChange(v); }} />
      ) : (
        <div className="pin-dots" aria-label={`${value.length} of 6 digits entered`}>
          {Array.from({ length: 6 }, (_, i) => <span key={i} className={`pin-dot${i < value.length ? " filled" : ""}`} />)}
        </div>
      )}
      <div className="keypad" aria-disabled={disabled}>
        {KEYS.map((k, i) =>
          k === "" ? <span key={i} className="key key-blank" /> :
          k === "del" ? (
            <button key={i} type="button" className="key" aria-label="Delete digit" disabled={disabled} {...handlers(k)}><Delete size={22} /></button>
          ) : (
            <button key={i} type="button" className="key" disabled={disabled} {...handlers(k)}>{k}</button>
          ))}
      </div>
    </div>
  );
}
