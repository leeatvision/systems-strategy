import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Notification {
  id: string;
  kind: "mention" | "assigned" | "comment" | "reminder" | "test";
  item_type: string;
  item_id: string;
  actor_id: string | null;
  summary: string;
  title?: string | null;
  read_at: string | null;
  created_at: string;
}

/** Where a notification's item lives in the app. */
export function itemLink(itemType: string, itemId: string): string {
  if (itemType === "goal") return `/goals/${itemId}`;
  if (itemType === "process") return `/processes/${itemId}`;
  if (itemType === "todo_list") return "/todos";
  if (itemType === "key_numbers") return "/key-numbers";
  if (itemType === "goals") return "/goals";
  if (itemType === "meeting") return `/meetings/${itemId}`;
  if (itemType === "settings") return "/settings/notifications";
  const page = { todo: "todos", issue: "issues", headline: "headlines" }[itemType];
  return page ? `/${page}?open=${itemId}` : "/";
}

/** Unread count for the bell, kept live with Supabase realtime. */
export function useUnreadCount(memberId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => supabase.from("ss_notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", memberId).is("read_at", null).then(({ count }) => setCount(count ?? 0));
    refresh();
    const channel = supabase.channel(`bell-${memberId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ss_notifications", filter: `recipient_id=eq.${memberId}` }, refresh)
      .subscribe();
    window.addEventListener("ss:notifications", refresh);
    return () => { supabase.removeChannel(channel); window.removeEventListener("ss:notifications", refresh); };
  }, [memberId]);
  return count;
}

/** Tell the bell to recount (after marking things read on this device). */
export function notificationsChanged() { window.dispatchEvent(new Event("ss:notifications")); }
