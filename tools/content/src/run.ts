import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureDir, listJson, makeRunId, pool, readJson, writeJson, CONTENT_DIR, REPO_ROOT } from "./util";
import type { ContentRecord, Kind, Pool } from "../../../shared/schema";
import { checkPackIntegrity, buildPack, type Pack } from "../../../shared/pack";
import { validateContentRecord } from "../../../shared/schema";
import { claimsVerified } from "../../../shared/verification";
import type { Level } from "../../../shared/examSpec";
import { BudgetExceeded, BudgetTracker } from "./budget";
import { generate, type GenParams } from "./generate";
import { Ledger } from "./ledger";
import { loadKuromoji } from "./readingCheck";
import { verifyRecord, type VerifyCtx, type VerifyResult } from "./verify";
import type { LlmProvider } from "./llm/types";
import { TrackingProvider } from "./llm/types";

export interface RoleSetup { provider: LlmProvider; model: string; concurrency: number }
export interface RunEnv {
  generator: RoleSetup;
  verifier: RoleSetup;
  budget: BudgetTracker;
  contentDir?: string;
  log?: (m: string) => void;
  sleep?: (ms: number) => Promise<void>;
  useAnalyzer?: boolean;
  rng?: () => number;
  ledgerPath?: string;
  /** where finished packs are written (default: <repo>/packs) */
  packsDir?: string;
}

export const runDir = (env: RunEnv, runId: string) => join(env.contentDir ?? CONTENT_DIR, "runs", runId);
const sub = (env: RunEnv, runId: string, name: string) => ensureDir(join(runDir(env, runId), name));
export const track = (s: RoleSetup): RoleSetup => ({ ...s, provider: s.provider instanceof TrackingProvider ? s.provider : new TrackingProvider(s.provider) });

export interface RunState { runId: string; params: unknown; createdAt: string; status: "GENERATED" | "VERIFYING" | "DONE" | "BUDGET_STOPPED"; generator: { provider: string; model: string }; verifier: { provider: string; model: string }; counts?: Record<string, number> }

export async function genCommand(env: RunEnv, params: Omit<GenParams, "runId"> & { runId?: string }): Promise<{ runId: string; written: number; calls: number }> {
  const runId = params.runId ?? makeRunId(params.kind);
  const gen = track(env.generator);
  env.generator = gen;
  const out = await generate({ provider: gen.provider, model: gen.model }, { ...params, runId }, { budget: env.budget, log: env.log, sleep: env.sleep });
  const dir = sub(env, runId, "drafts");
  const tag = (params as any).groupTag as string | undefined;
  for (const r of out.records) writeJson(join(dir, `${r.contentId.replace(":", "_")}.json`), tag ? { ...r, tags: [...new Set([...r.tags, tag])] } : r);
  writeJson(join(runDir(env, runId), "run.json"), { runId, params, createdAt: new Date().toISOString(), status: "GENERATED", generator: { provider: gen.provider.kind, model: gen.model }, verifier: { provider: env.verifier.provider.kind, model: env.verifier.model } } satisfies RunState);
  return { runId, written: out.records.length, calls: out.calls };
}

export interface VerifySummary { runId: string; verified: number; unverified: number; rejected: number; duplicates: number; pending: number; stoppedByBudget?: string; results: { id: string; outcome: string; reason?: string; revisions: number }[] }

/** Verifies every draft of a run that has no result yet (so an interrupted run resumes where it stopped). */
export async function verifyCommand(env: RunEnv, runId: string, opts: { maxRevise?: number } = {}): Promise<VerifySummary> {
  const dir = runDir(env, runId);
  const drafts = listJson(join(dir, "drafts")).map((f) => readJson<ContentRecord>(f));
  const done = new Set<string>();
  for (const d of ["verified", "rejected", "unverified", "duplicates"]) for (const f of listJson(join(dir, d))) done.add(basename(f));
  const fileOf = (r: ContentRecord) => `${r.contentId.replace(":", "_")}.json`;
  const todo = drafts.filter((r) => !done.has(fileOf(r)));

  const ledger = new Ledger(env.ledgerPath);
  const gen = track(env.generator), ver = track(env.verifier);
  env.generator = gen; env.verifier = ver;
  const context = new Map<string, string>();
  for (const r of drafts) {
    if (r.kind === "PASSAGE") context.set(r.contentId, (r.payload.pages as string[]).join("\n"));
    if (r.kind === "GRAMMAR") context.set(r.contentId, `Grammar point: ${r.payload.pattern} — ${r.payload.meaningKo}`);
    if (r.kind === "LISTENING") context.set(r.contentId, "Audio script (the learner HEARS this; the question is not part of the audio):\n" + (r.payload.segments as { speaker: string; text: string }[]).map((x) => `${x.speaker}: ${x.text}`).join("\n"));
  }
  const ctx: VerifyCtx = {
    verifier: { provider: ver.provider, model: ver.model }, generator: { provider: gen.provider, model: gen.model }, ledger, context,
    analyzer: env.useAnalyzer === false ? undefined : loadKuromoji, rng: env.rng, maxRevise: opts.maxRevise,
    call: { budget: env.budget, log: env.log, sleep: env.sleep },
  };
  const summary: VerifySummary = { runId, verified: 0, unverified: 0, rejected: 0, duplicates: 0, pending: 0, results: [] };
  const status = new Map<string, string>(); // contentId -> outcome, for parent/child cascade
  for (const f of listJson(join(dir, "verified"))) status.set(readJson<ContentRecord>(f).contentId, "VERIFIED");

  const ordered = [...todo.filter((r) => r.kind !== "QUESTION"), ...todo.filter((r) => r.kind === "QUESTION")];
  const save = (res: VerifyResult, original: ContentRecord) => {
    const name = res.outcome === "VERIFIED" ? "verified" : res.outcome === "UNVERIFIED" ? "unverified" : res.outcome === "DUPLICATE" ? "duplicates" : "rejected";
    writeJson(join(sub(env, runId, name), fileOf(original)), name === "rejected" || name === "duplicates" ? { ...res.record, _reason: res.reason, _existingId: res.existingId } : res.record);
    summary.results.push({ id: original.contentId, outcome: res.outcome, reason: res.reason, revisions: res.revisions });
    status.set(original.contentId, res.outcome);
    if (res.outcome === "VERIFIED") { ledger.add(res.record); ledger.save(); summary.verified++; }
    else if (res.outcome === "UNVERIFIED") summary.unverified++;
    else if (res.outcome === "DUPLICATE") summary.duplicates++;
    else summary.rejected++;
  };
  try {
    // Parents (passages, grammar points) first, then children, so a rejected parent cascades.
    for (const batch of [ordered.filter((r) => r.kind !== "QUESTION"), ordered.filter((r) => r.kind === "QUESTION")]) {
      await pool(batch, ver.concurrency, async (rec) => {
        const parent = (rec.payload.stimulusId ?? rec.payload.linkedContentId) as string | undefined;
        if (parent && status.has(parent) && status.get(parent) !== "VERIFIED") {
          save({ outcome: "REJECTED", record: rec, checks: [], reason: `parent ${parent} is ${status.get(parent)}`, revisions: 0 }, rec);
          return;
        }
        const res = await verifyRecord(ctx, rec);
        // A revised question keeps its slot: write the result under the ORIGINAL draft file name.
        save(res, rec);
      });
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) summary.stoppedByBudget = e.message; else throw e;
  }
  summary.pending = todo.length - summary.results.length;
  const state = readJson<RunState>(join(dir, "run.json"));
  writeJson(join(dir, "run.json"), { ...state, status: summary.stoppedByBudget ? "BUDGET_STOPPED" : summary.pending ? "VERIFYING" : "DONE", counts: { verified: summary.verified, unverified: summary.unverified, rejected: summary.rejected, duplicates: summary.duplicates } });
  writeJson(join(dir, "report.json"), { ...summary, budget: env.budget.summary(), generatorModel: gen.model, verifierModel: ver.model });
  return summary;
}

export const TOOL = { tool: "jlpt-content", toolVersion: "0.1.0" };

/** Keeps only references that resolve inside the pack (IMP-08): passages need all their questions; questions need their parent. */
export function closeReferences(items: ContentRecord[]): { kept: ContentRecord[]; dropped: { id: string; why: string }[] } {
  let kept = [...items];
  const dropped: { id: string; why: string }[] = [];
  for (let changed = true; changed;) {
    changed = false;
    const ids = new Set(kept.map((i) => i.contentId));
    kept = kept.filter((i) => {
      let why = "";
      if (i.kind === "PASSAGE" && (i.payload.questionIds as string[]).some((q) => !ids.has(q))) why = "passage has questions that are not in the pack";
      if (i.kind === "LISTENING" && typeof i.payload.questionId === "string" && !ids.has(i.payload.questionId)) why = "listening item has a question that is not in the pack";
      const parent = (i.payload.stimulusId ?? i.payload.linkedContentId) as string | undefined;
      if (i.kind === "QUESTION" && parent && !ids.has(parent)) why = "parent item is not in the pack";
      if (why) { dropped.push({ id: i.contentId, why }); changed = true; return false; }
      return true;
    });
  }
  return { kept, dropped };
}

export function packItems(env: RunEnv, all: ContentRecord[], outPath: string, opts: { packVersion?: string } = {}): { pack: Pack; dropped: { id: string; why: string }[]; path: string } {
  const items = all.filter((r) => r.verification.status === "VERIFIED" && claimsVerified(r).ok && validateContentRecord(r).length === 0);
  const { kept, dropped } = closeReferences(items);
  const pack = buildPack(kept, { packVersion: opts.packVersion, generator: { ...TOOL, models: { generate: env.generator.model, verify: env.verifier.model } } });
  const check = checkPackIntegrity(pack);
  if (check.fileErrors.length || check.badHashItems.length) throw new Error(`pack integrity failed: ${JSON.stringify(check)}`);
  writeJson(outPath, pack);
  return { pack, dropped, path: outPath };
}

export function packCommand(env: RunEnv, runId: string, outPath: string, opts: { packVersion?: string } = {}) {
  return packItems(env, listJson(join(runDir(env, runId), "verified")).map((f) => readJson<ContentRecord>(f)), outPath, opts);
}

export function readPack(path: string): Pack { return JSON.parse(readFileSync(path, "utf8")) as Pack; }

export function ledgerCommand(fromPack: string, ledgerPath?: string): number {
  const l = new Ledger(ledgerPath);
  const n = l.rebuildFromPack(readPack(fromPack));
  l.save();
  return n;
}

export function sampleCommand(env: RunEnv, n: number, outPath: string, rng: () => number = Math.random): string {
  const all: ContentRecord[] = [];
  const runsDir = join(env.contentDir ?? CONTENT_DIR, "runs");
  if (existsSync(runsDir)) for (const r of require_readdir(runsDir)) for (const f of listJson(join(runsDir, r, "verified"))) all.push(readJson<ContentRecord>(f));
  const picked = [...all].sort(() => rng() - 0.5).slice(0, n);
  const lines = ["# Content sample for manual spot check", "", `Items: ${picked.length} of ${all.length} verified.`, ""];
  for (const r of picked) {
    lines.push(`## ${r.contentId} (${r.kind}, ${r.level}, ${r.pool})`, "", "```json", JSON.stringify(r.payload, null, 1), "```", "");
  }
  writeFileSync(outPath, lines.join("\n"));
  return outPath;
}
import { readdirSync } from "node:fs";
const require_readdir = (d: string) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

export { REPO_ROOT };
