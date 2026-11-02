import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Bottom sheet on phones, centered dialog on wider screens. */
export function Sheet({ title, onClose, children, tools }: { title: string; onClose: () => void; children: ReactNode; tools?: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 16 }}>
          <h2>{title}</h2>
          <span className="spacer" />
          {tools}
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
