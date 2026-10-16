import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizedKey } from "../../../shared/normalize";
import type { ContentRecord } from "../../../shared/schema";
import type { Level } from "../../../shared/examSpec";
import { Ledger } from "./ledger";
import { loadTarget } from "./catalog";
import { ensureTaxonomy, executeSteps, makePlan, planEstimate, type Plan, type PlanStep, type Progress } from "./plan";
import { packItems, type RunEnv } from "./run";
import { CONTENT_DIR, REPO_ROOT, ensureDir, readJson, writeJson } from "./util";

const stampOf = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Splits the grammar step into chunks that each name the patterns to cover (taxonomy keeps coverage broad and non-repeating). */
export async function expandGrammar(env: RunEnv, plan: Plan, ledger: Ledger, perChunk: number, level: Level): Promise<PlanStep[]> {
  const out: PlanStep[] = [];
  const lowerLevel = (loadTarget(level) as unknown as { fill: { levels: { lower: Level[] } } }).fill.levels.lower[1] ?? level;
  for (const s of plan.steps) {
    if (s.kind !== "GRAMMAR") { out.push(s); continue; }
    const tax = await ensureTaxonomy(env, level, { lower: 60, target: 140 });
    const used = new Set([...ledger.entries.values()].filter((e) => e.kind === "GRAMMAR").map((e) => e.key));
    const key = (p: string) => normalizedKey("GRAMMAR", { pattern: p });
    const lowerShare = 15 / 40;
    const want = s.count;
    const pick = (band: "lower" | "target", n: number) => tax.patterns.filter((p) => p.band === band && !used.has(key(p.pattern))).slice(0, n).map((p) => p.pattern);
    const lower = pick("lower", Math.round(want * lowerShare));
    const target = pick("target", want - lower.length);
    const all = [...lower, ...target];
    for (let i = 0; i < all.length; i += perChunk) {
      const group = all.slice(i, i + perChunk);
      const isLower = lower.includes(group[0]!);
      out.push({ ...s, id: `grammar-${i / perChunk}`, count: group.length, level: isLower ? lowerLevel : level, extra: [s.extra, `Cover exactly these patterns, one grammar point each: ${group.join(" / ")}`].filter(Boolean).join("\n") });
    }
  }
  return out;
}

export interface FillOptions { level: Level; days: number; dryRun: boolean; only?: string[]; planFile?: string; progressFile?: string }

export async function fill(env: RunEnv, o: FillOptions, log: (m: string) => void = console.log): Promise<number> {
  const ledger = new Ledger(env.ledgerPath);
  const progress = o.progressFile && existsSync(o.progressFile) ? readJson<Progress>(o.progressFile) : undefined;
  let plan = o.planFile && existsSync(o.planFile) ? readJson<Plan>(o.planFile) : makePlan({ level: o.level, days: o.days, progress, ledger });
  if (o.only?.length) plan = { ...plan, steps: plan.steps.filter((s) => o.only!.includes(s.group) || o.only!.includes(s.kind)) };
  const est = planEstimate(plan, env);
  const taxMissing = plan.steps.some((s) => s.kind === "GRAMMAR") && !existsSync(join(env.contentDir ?? CONTENT_DIR, "taxonomy", `grammar-${o.level}.json`));
  const total = est.total.totalCalls + (taxMissing ? 4 : 0);
  log(`plan: ${plan.steps.length} steps; ${plan.steps.map((s) => `${s.group}×${s.count}`).join(", ") || "(nothing to generate)"}`);
  log(`estimate: ${total} calls (generate ${est.total.genCalls} + verify ${est.total.verifyCalls}${taxMissing ? " + 4 taxonomy" : ""})${est.total.usd !== undefined ? `, about $${est.total.usd.toFixed(2)} (API part)` : ""}`);
  log("assumptions: " + est.total.assumptions.join("; "));
  for (const n of plan.notes) log("note: " + n);
  if (!plan.steps.length) { log("nothing to do: the initial amount and the runway target are already met."); return 0; }
  if (o.dryRun) { log("dry-run: nothing generated."); return 0; }
  const steps = await expandGrammar(env, plan, ledger, 4, o.level);
  const planId = (await import("../../../shared/hash")).sha256Hex(JSON.stringify(steps)).slice(0, 10);
  const cdir = env.contentDir ?? CONTENT_DIR;
  ensureDir(join(cdir, "fill"));
  const statePath = join(cdir, "fill", `state-${planId}.json`);
  const r = await executeSteps(env, steps, statePath, log);
  const packedPath = join(cdir, "fill", "packed.json");
  const packed = new Set<string>(existsSync(packedPath) ? readJson<string[]>(packedPath) : []);
  const fresh = r.records.filter((x: ContentRecord) => !packed.has(`${x.contentId}@${x.contentVersion}`));
  if (fresh.length) {
    const dir = ensureDir(env.packsDir ?? join(REPO_ROOT, "packs"));
    const n = readdirSync(dir).filter((f) => f.startsWith(`fill_${stampOf()}`)).length + 1;
    const res = packItems(env, fresh, join(dir, `fill_${stampOf()}_${n}.jlptpack.json`));
    for (const x of res.pack.items) packed.add(`${x.contentId}@${x.contentVersion}`);
    writeJson(packedPath, [...packed]);
    log(`pack ${res.pack.manifest.packId}: ${res.pack.items.length} items -> packs/${res.path.split("/").pop()}`);
    for (const d of res.dropped) log(`dropped ${d.id}: ${d.why}`);
  }
  for (const s of r.shortfalls) log(`short: ${s.id} is ${s.missing} item(s) short (rejected or duplicate); run again to retry`);
  log("budget: " + JSON.stringify(env.budget.summary()));
  if (r.stopped) return 2;
  return r.shortfalls.length ? 3 : 0;
}
