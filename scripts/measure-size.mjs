import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = resolve(root, "dist/index.html");
if (!existsSync(p)) { console.error("dist/index.html missing: run npm run build"); process.exit(1); }
const buf = readFileSync(p);
const html = buf.toString("utf8");
const scriptM = html.match(/<script>([\s\S]*)<\/script>/);
const styleM = html.match(/<style>([\s\S]*?)<\/style>/);
const budgetKiB = Number(process.env.SIZE_BUDGET_KIB ?? 300); // V0 target (execution_plan §8.3)
const report = {
  rawBytes: buf.length,
  gzipBytes: gzipSync(buf).length,
  jsBytes: Buffer.byteLength(scriptM?.[1] ?? ""),
  cssBytes: Buffer.byteLength(styleM?.[1] ?? ""),
  sha256: createHash("sha256").update(buf).digest("hex"),
  budgetKiB,
  withinBudget: buf.length <= budgetKiB * 1024,
  externalRefs: [...html.matchAll(/(?:src|href)=["'](?!#)([^"']+)["']/g)].map((m) => m[1]),
};
console.log(JSON.stringify(report, null, 2));
if (!report.withinBudget || report.externalRefs.length) process.exit(1);
