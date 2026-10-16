// Builds dist/index.html: the ONLY shipped app artifact (inline CSS + JS).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
// The OAuth client ID is public (no secret). It is read from config.local.json at build time.
let clientId = "";
try { clientId = String(JSON.parse(readFileSync(resolve(root, "config.local.json"), "utf8")).clientId ?? ""); } catch { /* no local config */ }
if (process.env.JLPT_CLIENT_ID !== undefined) clientId = process.env.JLPT_CLIENT_ID;

const js = await build({
  entryPoints: [resolve(root, "app/src/app.ts")],
  bundle: true, minify: true, format: "iife", target: "es2022", write: false,
  charset: "utf8", legalComments: "none",
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __GOOGLE_CLIENT_ID__: JSON.stringify(clientId) },
  logLevel: "warning",
});
const jsText = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync(resolve(root, "app/src/ui/styles.css"), "utf8").replace(/\s*\n\s*/g, "");
const html = readFileSync(resolve(root, "app/index.template.html"), "utf8")
  .replace("/*__CSS__*/", () => css)
  .replace("/*__JS__*/", () => jsText);

const dist = resolve(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(resolve(dist, "index.html"), html);

const files = readdirSync(dist);
if (files.length !== 1 || files[0] !== "index.html") {
  console.error("BUILD FAIL: dist must contain exactly index.html, found:", files);
  process.exit(1);
}
const bytes = Buffer.byteLength(html);
const sha = createHash("sha256").update(html).digest("hex");
console.log(`dist/index.html ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB) sha256=${sha}`);
