// Static export for GitHub Pages, served from /<repo-name>/ (cross-platform).
// Usage: npm run build:pages [-- /custom-base-path]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "/chennai-metro-3d";
const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, STATIC_EXPORT: "1", PAGES_BASE_PATH: base },
});
if (result.status !== 0) process.exit(result.status ?? 1);

// Next's static export writes client-navigation payloads into nested folders
// (explore/__next.explore/__PAGE__.txt) while the router requests flat dotted
// names (explore/__next.explore.__PAGE__.txt). Add a copy under the requested
// name so in-app navigation works on a plain static host.
let copied = 0;
function flatten(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) {
      const walk = (d, prefix) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) walk(p, `${prefix}.${n}`);
          else {
            const target = join(dir, `${prefix}.${n}`);
            if (!existsSync(target)) {
              copyFileSync(p, target);
              copied++;
            }
          }
        }
      };
      walk(full, name);
    } else flatten(full);
  }
}
flatten("out");
console.log(`Static export ready in out/ for ${base}/ (${copied} navigation payloads aliased).`);
