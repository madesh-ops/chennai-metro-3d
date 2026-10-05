/**
 * Minimal, polite Overpass API client with an on-disk cache.
 *
 * Every query is cached under data-cache/osm/<name>.json (gitignored), so
 * baking is repeatable offline and the public servers are hit once. Retries
 * with backoff and falls back to a mirror when the main server is busy.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const CACHE_DIR = path.resolve("data-cache/osm");
const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "chennai-metro-3d/0.2 (https://github.com/madesh-ops/chennai-metro-3d; data bake)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run (or load from cache) one Overpass QL query; returns the parsed JSON. */
export async function overpass(name, query, { attempts = 6, refresh = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const endpoint = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(200_000),
      });
      if (res.ok) {
        const text = await res.text();
        const json = JSON.parse(text);
        if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
        await writeFile(file, text);
        return json;
      }
      lastError = new Error(`${endpoint} → HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    const wait = Math.min(60_000, 4000 * 2 ** i);
    console.warn(`  ${name}: ${lastError.message}; retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw lastError;
}
