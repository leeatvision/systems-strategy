import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./brand/brand.css";
import "./styles.css";

// The app caches itself to open fast. Look for a newer version every few minutes
// and whenever it's brought back to the front; when one is found it installs and
// the page reloads onto it, so nobody keeps running an old version.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  },
});

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
