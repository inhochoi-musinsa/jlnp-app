// Dev/verification only: serves dist/ at http://localhost:8080. Not a product requirement.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT ?? 8080);
createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path !== "/" && path !== "/index.html") { res.writeHead(404).end("not found"); return; }
  try {
    const body = await readFile(resolve(root, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  } catch { res.writeHead(500).end("run npm run build first"); }
}).listen(port, "127.0.0.1", () => console.log(`serving dist/ at http://localhost:${port}`));
