#!/usr/bin/env node
/**
 * Bundles the server into a single ESM file (apps/server/dist/server.mjs) so the production
 * image needs Node only: no node_modules, no TypeScript loader. Used by the Dockerfile.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
  // CommonJS dependencies (express and friends) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log("bundled → apps/server/dist/server.mjs");
