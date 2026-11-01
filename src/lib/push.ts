import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const toBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.ready;
}

/** What this device can do right now. */
export async function pushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iPhones only offer push to apps added to the Home Screen.
    return isIos() && !isInstalled() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

async function publicKey(): Promise<string> {
  let { data } = await supabase.rpc("ss_push_public_key");
  if (!data) {
    // The push function makes its keys the first time it's asked.
    await fetch(`${SUPABASE_URL}/functions/v1/push-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"init"}' });
    ({ data } = await supabase.rpc("ss_push_public_key"));
  }
  if (!data) throw new Error("Push isn't set up on the server yet.");
  return data as string;
}

/** Ask permission, subscribe this device and save it. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed. You can allow them in this browser's or phone's settings.");
  const reg = await registration();
  const key = await publicKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.rpc("ss_save_push_subscription", {
    p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Stop push on this device. */
export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("ss_push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
