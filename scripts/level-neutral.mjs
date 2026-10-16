// Level-neutral check (D10): no JLPT level literal (N5..N1) in app/, shared/, tools/ sources.
// Allowed: shared/examSpec.ts and tools/content/targets/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEVEL_RE = /(?<![A-Za-z0-9])N[1-5](?![A-Za-z0-9])/g;
export const ALLOWED = [/^shared\/examSpec\.ts$/, /^tools\/content\/targets\//];
const SCAN_DIRS = ["app", "shared", "tools"];
const EXT = /\.(ts|js|mjs|json|css|html|md)$/;

export function isAllowedPath(rel) { return ALLOWED.some((re) => re.test(rel)); }

/** Returns [{line, text}] for each level literal in the text, or [] when the path is allowed. */
export function findViolations(text, rel) {
  if (isAllowedPath(rel)) return [];
  const out = [];
  text.split("\n").forEach((line, i) => { if (new RegExp(LEVEL_RE.source).test(line)) out.push({ line: i + 1, text: line.trim() }); });
  const nameHit = rel.split("/").some((seg) => new RegExp(LEVEL_RE.source, "i").test(seg.replace(/\.[^.]+$/, "")));
  if (nameHit) out.push({ line: 0, text: "level literal in file path" });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc); else if (EXT.test(name)) acc.push(p);
  }
  return acc;
}

export function scan(root) {
  const bad = [];
  for (const d of SCAN_DIRS) {
    let files = [];
    try { files = walk(resolve(root, d)); } catch { continue; }
    for (const f of files) {
      const rel = relative(root, f).split("\\").join("/");
      for (const v of findViolations(readFileSync(f, "utf8"), rel)) bad.push({ file: rel, ...v });
    }
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const bad = scan(root);
  if (bad.length) { for (const b of bad) console.error(`${b.file}:${b.line}: ${b.text}`); console.error(`level-neutral: ${bad.length} violation(s)`); process.exit(1); }
  console.log("level-neutral: OK (0 violations)");
}
