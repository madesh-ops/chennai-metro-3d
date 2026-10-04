import type { NextConfig } from "next";

/**
 * In development, Next.js only serves its internal assets (/_next/*, the
 * live-reload socket) to localhost. Opening the dev server from a phone or
 * another machine on your network would otherwise hang on the loading
 * screen, so private network addresses are allowed here. These are only
 * reachable from your own network; public tunnel hosts must be opted into
 * explicitly via ALLOWED_DEV_ORIGINS (comma-separated, wildcards allowed).
 */
const PRIVATE_NETWORK_ORIGINS = [
  "127.0.0.1",
  "10.*.*.*",
  "192.168.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  "*.local",
];

const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Static export for GitHub Pages: `STATIC_EXPORT=1 PAGES_BASE_PATH=/repo-name next build`
 * writes plain files to out/, served from https://<user>.github.io/<repo-name>/.
 * Without these variables nothing changes: dev and normal builds run at the root.
 */
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = staticExport ? (process.env.PAGES_BASE_PATH ?? "") : "";

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const, trailingSlash: true, basePath, images: { unoptimized: true } } : {}),
  // Client code that builds URLs by hand (audio files) needs the base path too.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactStrictMode: true,
  poweredByHeader: false,
  // three.js ships modern ESM; transpiling keeps older Safari builds happy.
  transpilePackages: ["three"],
  allowedDevOrigins: [...PRIVATE_NETWORK_ORIGINS, ...extraDevOrigins],
  // Don't write AGENTS.md / CLAUDE.md into the project on every `next dev`.
  agentRules: false,
};

export default nextConfig;
