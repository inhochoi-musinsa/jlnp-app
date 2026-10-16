// Fails when a tracked file looks like it contains a credential, or when local-only files are tracked.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/ya29\.[0-9A-Za-z_-]{20,}/, "Google OAuth access token"],
  [/GOCSPX-[0-9A-Za-z_-]{20,}/, "Google OAuth client secret"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/"client_secret"\s*:\s*"[^"]+"/, "client_secret value"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, "GitHub token"],
  [/https:\/\/docs\.google\.com\/spreadsheets\/d\/(?!1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd|1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms|\.\.\.|<)[A-Za-z0-9_-]{25,}/, "real-looking spreadsheet URL"],
];
export const FORBIDDEN_TRACKED = [/^\.env\.local$/, /^config\.local\.json$/, /^content\//, /^packs\//, /^audio\//, /^site\//, /^\.npm-cache\//];

// the scanner and its own test contain fake credentials on purpose
export const SELF = [/^scripts\/scan-secrets\.mjs$/, /^tests\/unit\/scan-secrets\.test\.ts$/];

export function scanText(text) { return PATTERNS.filter(([re]) => re.test(text)).map(([, n]) => n); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = [];
  for (const f of files) {
    if (FORBIDDEN_TRACKED.some((re) => re.test(f))) problems.push(`${f}: local-only file is tracked`);
    if (SELF.some((re) => re.test(f)) || /\.(png|jpg|gif|ico|woff2?)$/.test(f)) continue;
    let text = "";
    try { text = readFileSync(resolve(root, f), "utf8"); } catch { continue; }
    for (const n of scanText(text)) problems.push(`${f}: ${n}`);
  }
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log(`scan-secrets: OK (${files.length} tracked files)`);
}
