import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);

await build({
  entryPoints: [fileURLToPath(new URL("./server/vercel-entry.ts", root))],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: fileURLToPath(new URL("./api/vault.js", root)),
  legalComments: "none",
  banner: {
    js: "/* Generated from server/vercel-entry.ts. Do not edit. */",
  },
  footer: {
    js: "module.exports = module.exports.default;",
  },
});
