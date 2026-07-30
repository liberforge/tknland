import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const appName = isDev ? "DEV tkn.land" : "tkn.land";

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "html-dev-title",
        transformIndexHtml(html) {
          if (!isDev) return html;
          return html.replaceAll("<title>tkn.land</title>", `<title>${appName}</title>`);
        },
      },
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          name: appName,
          short_name: isDev ? "DEV tkn" : "tkn.land",
          description: "Billetera biométrica sencilla",
          theme_color: "#111318",
          background_color: "#111318",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            {
              src: "pwa-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          navigateFallback: "/index.html",
        },
      }),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      // Suffix form allows any subdomain without committing a tunnel URL.
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    },
  };
});
