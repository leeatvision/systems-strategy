import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { friendlyError, supabase } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDay } from "../lib/data";
import type { ItemType } from "./Comments";

const BUCKET = "ss-attachments";
const MAX_BYTES = 25 * 1024 * 1024;

interface Attachment { id: string; storage_path: string; file_name: string; size_bytes: number | null; created_at: string }

const size = (n: number | null) => (n === null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Files on a Goal, To-Do, Issue or Headline. Private: opened through short-lived links. */
export function Attachments({ itemType, itemId, bare, onCount }: { itemType: ItemType; itemId: string; bare?: boolean; onCount?: (n: number) => void }) {
  const { me, company, isOwner } = useMe();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_attachments").select("id, storage_path, file_name, size_bytes, created_at")
      .eq("item_type", itemType).eq("item_id", itemId).order("created_at");
    setFiles((data ?? []) as Attachment[]);
    onCount?.((data ?? []).length);
  }, [itemType, itemId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setError("");
    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) { setError(`${file.name} is over 25 MB.`); continue; }
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
      const path = `${company.id}/${itemType}/${itemId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (upErr) { setError(friendlyError(upErr)); continue; }
      const { error: rowErr } = await supabase.from("ss_attachments").insert({
        company_id: company.id, item_type: itemType, item_id: itemId, storage_path: path, file_name: file.name,
        content_type: file.type || null, size_bytes: file.size, uploaded_by: me.id,
      });
      if (rowErr) setError(friendlyError(rowErr));
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    load();
  };

  const open = async (a: Attachment) => {
    // Open the tab first so phones don't block it as a pop-up, then point it at the signed link.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 300, { download: a.file_name });
    if (error || !data) { tab?.close(); setError(friendlyError(error)); return; }
    if (tab) tab.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };

  const remove = async (a: Attachment) => {
    if (!confirm(`Delete ${a.file_name}? This can't be undone.`)) return;
    const { error } = await supabase.storage.from(BUCKET).remove([a.storage_path]);
    if (error) { setError(friendlyError(error)); return; }
    await supabase.from("ss_attachments").delete().eq("id", a.id);
    load();
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        {!bare && <h3>Files{files.length > 0 && <span className="count">{files.length}</span>}</h3>}
        <span className="spacer" />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={16} />{busy ? "Uploading…" : "Add file"}
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {files.map((a) => (
        <div key={a.id} className="row" style={{ gap: 8 }}>
          <Paperclip size={16} color="var(--color-fg-muted)" />
          <button type="button" className="link-btn file-link" onClick={() => open(a)}>{a.file_name}</button>
          <span className="small muted">{size(a.size_bytes)} · {fmtDay(a.created_at)}</span>
          <span className="spacer" />
          {isOwner && <button type="button" className="link-btn" aria-label={`Delete ${a.file_name}`} onClick={() => remove(a)}><Trash2 size={14} /></button>}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
