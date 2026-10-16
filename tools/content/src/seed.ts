import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Level } from "../../../shared/examSpec";
import type { ContentRecord, Kind, Pool } from "../../../shared/schema";
import { loadTarget } from "./catalog";
import { estimate } from "./estimate";
import { closeReferences, genCommand, packItems, runDir, verifyCommand, type RunEnv } from "./run";
import { REPO_ROOT, listJson, readJson, writeJson, makeRunId } from "./util";

interface SeedStep { group: string; kind: Kind; pool: Pool; level: Level; count: number; domain?: string; guide?: string; topic?: string; groupTag?: string; passageType?: "SHORT" | "MEDIUM" | "LONG" | "INFO"; questionsPerPassage?: number; questionsPerPoint?: number }

export const SEED_PACK_PATH = join(REPO_ROOT, "app/seed/seed.jlptpack.json");

/** Builds the built-in seed (diagnostic + a few study items) through the normal gen -> verify -> pack pipeline. */
export async function runSeed(env: RunEnv, o: { dryRun: boolean; level: Level }): Promise<number> {
  const target = loadTarget(o.level) as unknown as { seedPlan: SeedStep[] };
  const steps = target.seedPlan;
  const est = steps.map((s) => estimate({ kind: s.kind, count: s.count, pool: s.pool, questionsPerPassage: s.questionsPerPassage, questionsPerPoint: s.questionsPerPoint, gen: { provider: env.generator.provider.kind, model: env.generator.model }, verify: { provider: env.verifier.provider.kind, model: env.verifier.model } }));
  const total = est.reduce((a, e) => a + e.totalCalls, 0);
  console.log(`seed plan: ${steps.length} steps, estimated ${total} calls${est.some((e) => e.usd !== undefined) ? `, about $${est.reduce((a, e) => a + (e.usd ?? 0), 0).toFixed(2)} (API part)` : ""}`);
  if (o.dryRun) return 0;

  const statePath = join(REPO_ROOT, "content", "seed-state.json");
  const raw: { runIds?: Record<string, string>; runs?: Record<string, string[]> } = existsSync(statePath) ? readJson(statePath) : {};
  const state: { runs: Record<string, string[]> } = { runs: raw.runs ?? Object.fromEntries(Object.entries(raw.runIds ?? {}).map(([k, v]) => [k, [v]])) };
  const verifiedOf = (key: string): ContentRecord[] => (state.runs[key] ?? []).flatMap((id) => listJson(join(runDir(env, id), "verified")).map((f) => readJson<ContentRecord>(f)));
  const goodCount = (key: string, kind: Kind): number => closeReferences(verifiedOf(key)).kept.filter((r) => r.kind === kind).length;

  for (const [i, s] of steps.entries()) {
    const key = `${i}:${s.group}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      // finish verification of any run that was interrupted
      for (const id of state.runs[key] ?? []) {
        const v = await verifyCommand(env, id);
        if (v.stoppedByBudget) { console.log(`[seed] stopped: ${v.stoppedByBudget}. Re-run to continue.`); return 2; }
      }
      const missing = s.count - goodCount(key, s.kind);
      if (missing <= 0) break;
      if (attempt === 3) { console.log(`[seed] ${key}: still ${missing} short after 3 attempts`); break; }
      const r = await genCommand(env, { kind: s.kind, level: s.level, count: missing, pool: s.pool, domain: s.domain, domainGuide: s.guide, topic: s.topic, passageType: s.passageType, questionsPerPassage: s.questionsPerPassage, questionsPerPoint: s.questionsPerPoint, groupTag: s.groupTag, runId: makeRunId(`seed${i}-${s.group}`) } as any);
      (state.runs[key] ??= []).push(r.runId);
      writeJson(statePath, state);
      console.log(`[seed] ${key}: attempt ${attempt + 1}: ${r.written} drafts for ${missing} missing (${r.runId})`);
      const v = await verifyCommand(env, r.runId);
      console.log(`[seed] ${key}: verified ${v.verified}, rejected ${v.rejected}, duplicates ${v.duplicates}, pending ${v.pending}`);
    }
  }
  // Pack every step's verified items into one seed pack.
  const items = steps.flatMap((st, i) => verifiedOf(`${i}:${st.group}`));
  const r = packItems(env, items, SEED_PACK_PATH);
  console.log(`[seed] pack ${r.pack.manifest.packId}: ${r.pack.items.length} items -> app/seed/seed.jlptpack.json`);
  for (const d of r.dropped) console.log(`[seed] dropped ${d.id}: ${d.why}`);
  return 0;
}
