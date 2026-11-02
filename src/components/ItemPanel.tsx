import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Fold, Menu, type MenuItem } from "./ui";
import { Sheet } from "./Sheet";
import { Attachments } from "./Attachments";
import { Comments, type ItemType } from "./Comments";

/**
 * A To-Do, Issue or Headline opened from a list, laid out like a Goal: a summary first, then the main thing
 * (a checklist, the next step), with Files and Comments folded away. Edit switches to the form; ⋮ holds the rest.
 */
export function ItemPanel({ heading, itemType, itemId, onClose, editing, onEdit, edit, actions, children }: {
  heading: string; itemType: ItemType; itemId: string; onClose: () => void;
  editing: boolean; onEdit: () => void; edit: ReactNode; actions: MenuItem[]; children: ReactNode;
}) {
  const [open, setOpen] = useState<"files" | "comments" | null>(null);
  const [counts, setCounts] = useState({ files: 0, comments: 0 });
  useEffect(() => {
    Promise.all([
      supabase.from("ss_attachments").select("id", { count: "exact", head: true }).eq("item_type", itemType).eq("item_id", itemId),
      supabase.from("ss_comments").select("id", { count: "exact", head: true }).eq("item_type", itemType).eq("item_id", itemId).is("deleted_at", null),
    ]).then(([f, c]) => setCounts({ files: f.count ?? 0, comments: c.count ?? 0 }));
  }, [itemType, itemId]);
  const toggle = (f: "files" | "comments") => setOpen(open === f ? null : f);

  return (
    <Sheet title={editing ? `Edit ${heading}` : heading} onClose={onClose} tools={!editing && <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}><Pencil size={16} />Edit</button>
      <Menu items={actions} />
    </>}>
      {editing ? edit : (
        <div className="stack panel">
          {children}
          <div className="card folds">
            <Fold title="Files" count={counts.files} open={open === "files"} onToggle={() => toggle("files")}>
              <Attachments itemType={itemType} itemId={itemId} bare onCount={(n) => setCounts((c) => ({ ...c, files: n }))} />
            </Fold>
            <Fold title="Comments" count={counts.comments} open={open === "comments"} onToggle={() => toggle("comments")}>
              <Comments itemType={itemType} itemId={itemId} bare onCount={(n) => setCounts((c) => ({ ...c, comments: n }))} />
            </Fold>
          </div>
        </div>
      )}
    </Sheet>
  );
}
