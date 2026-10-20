import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const markdownType = "text/markdown; charset=utf-8";
const htmlType = "text/html; charset=utf-8";
const textType = "text/plain; charset=utf-8";

/** Publish the product page and the llms.txt index on the static site. */
function publishAiDocs(): Plugin {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const page = resolve(root, "docs/what-is-tkn-land.md");
  const pageEs = resolve(root, "docs/que-es-tkn-land.html");
  const llms = resolve(root, "docs/llms.txt");
  const files: Record<string, { path: string; type: string }> = {
    "/docs/what-is-tkn-land.md": { path: page, type: markdownType },
    "/docs/que-es-tkn-land.html": { path: pageEs, type: htmlType },
    "/llms-full.txt": { path: page, type: textType },
    "/llms.txt": { path: llms, type: textType },
    "/.well-known/llms.txt": { path: llms, type: textType },
  };

  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const url = req.url?.split("?")[0];
      const file = url ? files[url] : undefined;
      if (!file) return next();
      res.setHeader("Content-Type", file.type);
      res.setHeader("X-Robots-Tag", "index, follow");
      res.end(readFileSync(file.path));
    });
  };

  return {
    name: "publish-ai-docs",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
    generateBundle() {
      for (const [url, file] of Object.entries(files)) {
        this.emitFile({
          type: "asset",
          fileName: url.slice(1),
          source: readFileSync(file.path),
        });
      }
    },
  };
}

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
      publishAiDocs(),
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
          id: "/",
          name: appName,
          short_name: isDev ? "DEV tkn" : "tkn.land",
          description: "Billetera biométrica sencilla",
          theme_color: "#111318",
          background_color: "#111318",
          display: "standalone",
          orientation: "portrait",
          scope: "/",
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
          navigateFallbackDenylist: [
            /^\/docs\//,
            /^\/llms/,
            /^\/robots\.txt$/,
            /^\/sitemap\.xml$/,
            /^\/\.well-known\//,
          ],
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
