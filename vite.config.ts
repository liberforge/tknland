import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Connect, type Plugin, type ViteDevServer } from "vite";
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

/** Same handler as `api/vault.ts`, so a tunnel to this dev server can reach Upstash. */
function vaultApiDev(): Plugin {
  const handlerPath = fileURLToPath(
    new URL("./server/vault-handler.ts", import.meta.url),
  );

  const readBody = (req: Connect.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const attach = (server: ViteDevServer) => {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split("?")[0];
      if (path !== "/api/vault") return next();
      void (async () => {
        try {
          const mod = (await server.ssrLoadModule(handlerPath)) as typeof import(
            "./server/vault-handler.ts"
          );
          let body: unknown;
          if (req.method === "POST") {
            const raw = await readBody(req);
            if (raw) {
              try {
                body = JSON.parse(raw) as unknown;
              } catch {
                body = null;
              }
            }
          }
          const host = req.headers.host ?? "127.0.0.1";
          const originHeader = req.headers.origin;
          const result = await mod.handleVault({
            method: req.method ?? "GET",
            url: new URL(req.url ?? "/api/vault", `http://${host}`),
            origin: typeof originHeader === "string" ? originHeader : null,
            body,
          });
          res.statusCode = result.status;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify(result.body));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "No se pudo guardar la billetera." }));
        }
      })();
    });
  };

  return {
    name: "vault-api-dev",
    configureServer: attach,
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
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  for (const key of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "KV_REST_API_READ_ONLY_TOKEN",
  ]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

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
      vaultApiDev(),
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
            /^\/api\//,
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
