import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

function resolveAppCommit(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const appName = isDev ? "DEV tkn.land" : "tkn.land";
  const appCommit = resolveAppCommit();
  const appBuiltAt = new Date().toISOString();

  return {
    define: {
      __APP_COMMIT__: JSON.stringify(appCommit),
      __APP_BUILT_AT__: JSON.stringify(appBuiltAt),
    },
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
      proxy: {
        "/mettal-api": {
          target: "https://api.v1.stg.mettal.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/mettal-api/, ""),
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
      proxy: {
        "/mettal-api": {
          target: "https://api.v1.stg.mettal.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/mettal-api/, ""),
        },
      },
    },
  };
});
