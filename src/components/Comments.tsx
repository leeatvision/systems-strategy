import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { friendlyError, fullName, supabase, type Member } from "../lib/supabase";
import { useMe } from "../lib/session";
import { fmtDateTime, useMembers } from "../lib/data";
import { Avatar } from "./ui";

export type ItemType = "goal" | "todo" | "issue" | "headline" | "process" | "plan";

interface Comment {
  id: string;
  author_id: string;
  body: string;
  mentions: string[];
  edited_at: string | null;
  created_at: string;
}

/** Everyone whose "@FirstName" appears in the text. */
function findMentions(body: string, members: Member[]): string[] {
  return members.filter((m) => new RegExp(`(^|\\s)@${m.first_name}\\b`, "i").test(body)).map((m) => m.id);
}

function Body({ text, members }: { text: string; members: Member[] }) {
  const names = members.map((m) => m.first_name).filter(Boolean);
  if (!names.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(@(?:${names.join("|")})\\b)`, "gi"));
  return <>{parts.map((p, i) => (p.startsWith("@") ? <strong key={i} className="mention">{p}</strong> : p))}</>;
}

export function Comments({ itemType, itemId, bare, onCount }: { itemType: ItemType; itemId: string; bare?: boolean; onCount?: (n: number) => void }) {
  const { me, company } = useMe();
  const { members, active } = useMembers();
  const [list, setList] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("ss_comments").select("id, author_id, body, mentions, edited_at, created_at")
      .eq("item_type", itemType).eq("item_id", itemId).is("deleted_at", null).order("created_at");
    setList((data ?? []) as Comment[]);
    onCount?.((data ?? []).length);
  }, [itemType, itemId]);
  useEffect(() => { load(); }, [load]);

  // Suggest people while an "@name" is being typed at the end of the box.
  const typing = draft.match(/(?:^|\s)@(\w*)$/);
  const suggestions = typing ? active.filter((m) => m.id !== me.id && m.first_name.toLowerCase().startsWith(typing[1].toLowerCase())) : [];
  const pick = (m: Member) => {
    setDraft(draft.replace(/@(\w*)$/, `@${m.first_name} `));
    box.current?.focus();
  };

  const post = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const { error } = await supabase.from("ss_comments").insert({
      company_id: company.id, item_type: itemType, item_id: itemId, author_id: me.id, body, mentions: findMentions(body, active),
    });
    if (error) { setError(friendlyError(error)); return; }
    setDraft(""); setError(""); load();
  };
  const saveEdit = async () => {
    if (!editing?.body.trim()) return;
    const { error } = await supabase.from("ss_comments")
      .update({ body: editing.body.trim(), edited_at: new Date().toISOString() }).eq("id", editing.id);
    if (error) setError(friendlyError(error)); else { setEditing(null); load(); }
  };
  const remove = async (c: Comment) => {
    if (!confirm("Delete this comment?")) return;
    await supabase.from("ss_comments").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
    load();
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      {!bare && <h3>Comments{list?.length ? <span className="count">{list.length}</span> : null}</h3>}
      {list?.map((c) => {
        const author = members.find((m) => m.id === c.author_id);
        return (
          <div key={c.id} className="comment">
            <Avatar m={author} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small"><strong>{author ? fullName(author) : "Someone"}</strong>
                <span className="muted"> · {fmtDateTime(c.created_at)}{c.edited_at ? " · edited" : ""}</span></div>
              {editing?.id === c.id ? (
                <div className="stack" style={{ gap: 6 }}>
                  <textarea className="input textarea" rows={2} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                  <div className="row"><button type="button" className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              ) : <p className="comment-body"><Body text={c.body} members={members} /></p>}
              {c.author_id === me.id && editing?.id !== c.id && (
                <div className="row small" style={{ gap: 4 }}>
                  <button type="button" className="link-btn" onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</button>
                  <button type="button" className="link-btn" onClick={() => remove(c)}>Delete</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <form className="stack" style={{ gap: 6 }} onSubmit={post}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <textarea ref={box} className="input textarea" rows={2} placeholder="Write a comment. Type @ to mention someone."
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e); }} />
          <button className="btn btn-primary btn-sm" disabled={!draft.trim()} aria-label="Post comment"><Send size={16} /></button>
        </div>
        {suggestions.length > 0 && (
          <div className="chips">{suggestions.map((m) => (
            <button key={m.id} type="button" className="chip" onClick={() => pick(m)}>@{m.first_name}</button>
          ))}</div>
        )}
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
