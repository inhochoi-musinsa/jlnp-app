import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CONTENT_DIR = join(REPO_ROOT, "content");

export const ensureDir = (d: string) => { mkdirSync(d, { recursive: true }); return d; };
export const readJson = <T = any>(p: string): T => JSON.parse(readFileSync(p, "utf8"));
/** Atomic JSON write (tmp + rename) so an interrupted run never leaves a half file. */
export function writeJson(p: string, v: unknown): void {
  ensureDir(dirname(p));
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(v, null, 1) + "\n");
  renameSync(tmp, p);
}
export const listJson = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)) : []);

export function makeRunId(kind: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${kind.toLowerCase()}-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")}`;
}

/** Runs tasks with a concurrency limit, preserving result order; the first thrown error stops scheduling. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, failed: unknown;
  const worker = async () => {
    while (failed === undefined) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]!, i); } catch (e) { failed = e ?? new Error("failed"); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  if (failed !== undefined) throw failed;
  return out;
}
