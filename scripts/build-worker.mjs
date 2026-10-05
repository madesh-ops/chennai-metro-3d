#!/usr/bin/env node
/**
 * Bundle the world-tile worker (src/three/world/tileWorker.ts) into
 * public/world/tileWorker.js. Turbopack copies `new Worker(new URL(...))`
 * targets as plain files instead of compiling them, so the worker is built
 * here, as a classic script, before `next dev` / `next build`.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/three/world/tileWorker.ts"],
  outfile: "public/world/tileWorker.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
console.log("built public/world/tileWorker.js");
