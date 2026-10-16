// Dev/verification only: serves dist/ at http://localhost:8080 and audio/ (or AUDIO_DIR) under /audio/. Not a product requirement.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "dist");
const audioRoot = resolve(process.env.AUDIO_DIR ?? resolve(here, "..", "audio"));
const port = Number(process.env.PORT ?? 8080);
createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path.startsWith("/audio/")) {
    const file = normalize(resolve(audioRoot, "." + path.slice("/audio".length)));
    if (!file.startsWith(audioRoot + sep)) { res.writeHead(403).end("forbidden"); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": body.length, "cache-control": "no-store" }).end(req.method === "HEAD" ? undefined : body);
    } catch { res.writeHead(404).end("not found"); }
    return;
  }
  if (path !== "/" && path !== "/index.html") { res.writeHead(404).end("not found"); return; }
  try {
    const body = await readFile(resolve(root, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  } catch { res.writeHead(500).end("run npm run build first"); }
}).listen(port, "127.0.0.1", () => console.log(`serving dist/ at http://localhost:${port}`));
