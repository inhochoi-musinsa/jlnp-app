// Stages site/ (= dist/index.html + audio/) and, ONLY with --publish, pushes it to the gh-pages branch.
// Publishing is an external, user-approved action (execution_plan §10-4): never run it without their OK.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const publish = args.has("--publish");

export function stage(rootDir = root) {
  const dist = join(rootDir, "dist/index.html");
  if (!existsSync(dist)) throw new Error("dist/index.html is missing: run npm run build first");
  const site = join(rootDir, "site");
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  cpSync(dist, join(site, "index.html"));
  const audio = join(rootDir, "audio");
  if (existsSync(audio)) cpSync(audio, join(site, "audio"), { recursive: true });
  const names = readdirSync(site).sort();
  const bad = names.filter((n) => n !== "index.html" && n !== "audio");
  if (bad.length) throw new Error(`site/ must contain only index.html and audio/, found: ${bad.join(", ")}`);
  let bytes = 0;
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else bytes += statSync(p).size; } };
  walk(site);
  return { names, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = stage();
  console.log(`staged site/: ${r.names.join(", ")} (${(r.bytes / 1024).toFixed(1)} KiB)`);
  if (!publish) {
    console.log("NOT published. Publishing needs the user's approval (git push / GitHub Pages).");
    console.log("After approval run: npm run deploy -- --publish");
    process.exit(0);
  }
  // Publish: replace the contents of the gh-pages branch with site/ and push. Requires a configured `origin`.
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "inherit" });
  const out = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  const origin = out("remote", "get-url", "origin");
  const tmp = join(root, ".deploy-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  cpSync(join(root, "site"), tmp, { recursive: true });
  const git2 = (...a) => execFileSync("git", a, { cwd: tmp, stdio: "inherit" });
  git2("init", "-q", "-b", "gh-pages");
  git2("add", "-A");
  git2("-c", "user.name=deploy", "-c", "user.email=deploy@localhost", "commit", "-q", "-m", `deploy ${new Date().toISOString()}`);
  git2("push", "--force", origin, "gh-pages");
  rmSync(tmp, { recursive: true, force: true });
  console.log("published to gh-pages of", origin.replace(/\/\/[^@]*@/, "//"));
  void git;
}
