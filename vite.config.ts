import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
// Name, colours and icons come from the brand files (scripts/brand.mjs puts them in place).
import brand from "./src/brand/brand.json" with { type: "json" };

// Relative base + hash routes so the build works from any folder,
// including GitHub Pages' https://<owner>.github.io/<repo>/.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "brand-html",
      transformIndexHtml: (html) => html.replaceAll("%WORDMARK%", brand.wordmark).replaceAll("%THEME_COLOR%", brand.themeColor),
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon-48.png", "icons/logo-mark.png", "icons/badge-96.png", "push-sw.js"],
      manifest: {
        // Lowercase wordmark, as in the design system.
        name: brand.wordmark,
        short_name: brand.wordmark,
        description: brand.description,
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: brand.backgroundColor,
        theme_color: brand.themeColor,
        icons: [
          // The maskable ones keep everything inside the
          // circle Android crops to, so the home-screen icon never shows a blank or grey tile.
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
        // Shows push notifications and opens the right screen when one is tapped.
        importScripts: ["push-sw.js"],
        // Never cache Supabase responses: data must always be live.
        runtimeCaching: [],
      },
    }),
  ],
});
