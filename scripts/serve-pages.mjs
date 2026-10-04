// Preview the static export as GitHub Pages serves it: out/ mounted at /<repo-name>/.
// Usage: node scripts/serve-pages.mjs [port] [base]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] ?? 4173);
const base = process.argv[3] ?? "/chennai-metro-3d";
const root = join(process.cwd(), "out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!url.startsWith(base)) {
    res.writeHead(404).end("Not under " + base);
    return;
  }
  let file = normalize(join(root, url.slice(base.length)));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(root, "404.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(file.endsWith("404.html") && !url.endsWith("404.html") ? 404 : 200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("missing");
  }
}).listen(port, () => console.log(`http://localhost:${port}${base}/`));
