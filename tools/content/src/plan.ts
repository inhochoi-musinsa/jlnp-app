import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ContentRecord, Kind, Pool } from "../../../shared/schema";
import type { Level } from "../../../shared/examSpec";
import { callJson } from "./llm/call";
import { loadPrompt, render } from "./prompts";
import { estimate, type Estimate } from "./estimate";
import { Ledger } from "./ledger";
import { closeReferences, genCommand, runDir, verifyCommand, type RunEnv } from "./run";
import { CONTENT_DIR, REPO_ROOT, listJson, makeRunId, readJson, writeJson } from "./util";

export interface PlanStep {
  id: string; group: string; kind: Kind; pool: Pool; level: Level; count: number;
  domain?: string; guide?: string; topic?: string; extra?: string; groupTag?: string;
  passageType?: "SHORT" | "MEDIUM" | "LONG" | "INFO"; questionsPerPassage?: number; questionsPerPoint?: number;
}
export interface Plan { createdAt: string; level: string; days: number; steps: PlanStep[]; emphasisTags: { tag: string; wrong: number }[]; notes: string[] }

interface Targets {
  level: string; initial: any; dailyNewCap: Record<string, number>; topics: string[]; domainGuides: Record<string, string>;
  fill: { VOCAB: { chunk: number }; GRAMMAR: { questionsPerPoint: number; patternsPerChunk: number }; KANJI_QUESTIONS: Record<string, number>; KANA: { chunk: number }; levels: { lower: Level[]; target: Level[] } };
  longTerm: any;
}
const targets = (level: string): Targets => readJson<Targets>(join(REPO_ROOT, "tools/content/targets", `${level}.json`));

export interface Progress { format?: string; level?: string; route?: string | null; dailyNewCap?: number; wrongByTag?: Record<string, number>; unseen?: Record<string, number>; runway?: { days?: number } }

/** How many verified items the ledger holds, by kind and level (and domain for questions via the key prefix is not needed here). */
export function ledgerCounts(ledger: Ledger, level?: string): { byKind: Record<string, number>; questionsByDomain: Record<string, number>; grammarByLevel: Record<string, number> } {
  const byKind: Record<string, number> = {}, grammarByLevel: Record<string, number> = {};
  for (const e of ledger.entries.values()) {
    if (e.status !== "VERIFIED") continue;
    if (!level || e.level === level || e.kind === "KANA") byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.kind === "GRAMMAR") grammarByLevel[e.level] = (grammarByLevel[e.level] ?? 0) + 1;
  }
  return { byKind, questionsByDomain: {}, grammarByLevel };
}

const chunks = (n: number, size: number): number[] => { const out: number[] = []; for (let left = n; left > 0; left -= size) out.push(Math.min(size, left)); return out; };

/**
 * execution_plan §4.1/§4.3: the next generation plan = max(initial-amount shortfall, runway shortfall for `days`),
 * with extra weight on the misconception tags the learner gets wrong most often.
 */
export function makePlan(o: { level: Level; days: number; progress?: Progress; ledger: Ledger; domainCounts?: Record<string, number> }): Plan {
  const t = targets(o.level);
  const have = ledgerCounts(o.ledger, o.level);
  const route = (o.progress?.route as string | null | undefined) ?? "FOUNDATION";
  const cap = o.progress?.dailyNewCap ?? t.dailyNewCap[route] ?? 10;
  const unseenWords = o.progress?.unseen?.VOCAB ?? have.byKind.VOCAB ?? 0;
  const unseenPoints = o.progress?.unseen?.GRAMMAR ?? have.byKind.GRAMMAR ?? 0;
  const notes: string[] = [];
  const need = (initial: number, haveN: number, runwayNeed: number, unseen: number) => Math.max(0, Math.max(initial - haveN, runwayNeed - unseen));
  const vocabNeed = need(t.initial.beforeV1.VOCAB, have.byKind.VOCAB ?? 0, o.days * cap, unseenWords);
  const grammarNeed = need(t.initial.beforeV1.GRAMMAR.points, have.byKind.GRAMMAR ?? 0, o.days * 1, unseenPoints);
  const kanaNeed = Math.max(0, t.initial.beforeV1.KANA_CONFUSION_PAIRS - (have.byKind.KANA ?? 0));
  const emphasis = Object.entries(o.progress?.wrongByTag ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag, wrong]) => ({ tag, wrong }));
  const emphasisLine = emphasis.length ? `Give extra weight to these Korean-speaker misconception tags (the learner often gets them wrong): ${emphasis.map((e) => e.tag).join(", ")}.` : "";
  const steps: PlanStep[] = [];
  chunks(vocabNeed, t.fill.VOCAB.chunk).forEach((n, i) => steps.push({ id: `vocab-${i}`, group: "VOCAB", kind: "VOCAB", pool: "LEARN", level: o.level, count: n, topic: t.topics[i % t.topics.length], extra: emphasisLine || undefined }));
  if (grammarNeed > 0) steps.push({ id: "grammar", group: "GRAMMAR", kind: "GRAMMAR", pool: "LEARN", level: o.level, count: grammarNeed, questionsPerPoint: t.fill.GRAMMAR.questionsPerPoint, extra: emphasisLine || undefined });
  const done = o.domainCounts ?? {};
  for (const [dom, total] of Object.entries(t.fill.KANJI_QUESTIONS)) {
    if (dom === "chunk") continue;
    const missing = Math.max(0, (total as number) - (done[dom] ?? 0));
    chunks(missing, t.fill.KANJI_QUESTIONS.chunk!).forEach((n, i) => steps.push({ id: `q-${dom}-${i}`, group: `Q_${dom}`, kind: "QUESTION", pool: "LEARN", level: o.level, count: n, domain: dom, guide: t.domainGuides[dom], topic: t.topics[(i + 3) % t.topics.length], extra: emphasisLine || undefined }));
  }
  if (kanaNeed > 0) steps.push({ id: "kana", group: "KANA", kind: "KANA", pool: "LEARN", level: t.fill.levels.lower[0]!, count: kanaNeed });
  notes.push(`daily new words ${cap}; runway target ${o.days} days -> vocab ${vocabNeed}, grammar points ${grammarNeed}, kana pairs ${kanaNeed}`);
  if (!o.progress) notes.push("no progress.json given: the plan assumes nothing has been studied yet");
  return { createdAt: new Date().toISOString(), level: o.level, days: o.days, steps, emphasisTags: emphasis, notes };
}

export function planEstimate(plan: Plan, env: RunEnv): { total: Estimate; perStep: Estimate[] } {
  const g = { provider: env.generator.provider.kind, model: env.generator.model }, v = { provider: env.verifier.provider.kind, model: env.verifier.model };
  const perStep = plan.steps.map((s) => estimate({ kind: s.kind, count: s.count, pool: s.pool, questionsPerPoint: s.questionsPerPoint, questionsPerPassage: s.questionsPerPassage, gen: g, verify: v }));
  const total: Estimate = { genCalls: 0, verifyCalls: 0, totalCalls: 0, items: 0, questions: 0, assumptions: perStep[0]?.assumptions ?? [], usd: undefined };
  for (const e of perStep) { total.genCalls += e.genCalls; total.verifyCalls += e.verifyCalls; total.totalCalls += e.totalCalls; total.items += e.items; total.questions += e.questions; if (e.usd !== undefined) total.usd = (total.usd ?? 0) + e.usd; }
  return { total, perStep };
}

/* ---------------- taxonomy (grammar patterns) ---------------- */

export interface Taxonomy { generatedAt: string; level: string; patterns: { pattern: string; band: "lower" | "target" }[] }
const taxPath = (env: RunEnv, level: string) => join(env.contentDir ?? CONTENT_DIR, "taxonomy", `grammar-${level}.json`);
const BAND_NOTE = (b: "lower" | "target", lv: string) => (b === "lower" ? "levels below the target, as a foundation" : `the target level ${lv}`);

/** The generator proposes the list, the verifier prunes it (execution_plan §4.3 taxonomy). Saved once, reused by every fill. */
export async function ensureTaxonomy(env: RunEnv, level: Level, sizes: { lower: number; target: number }): Promise<Taxonomy> {
  if (existsSync(taxPath(env, level))) return readJson<Taxonomy>(taxPath(env, level));
  const out: Taxonomy = { generatedAt: new Date().toISOString(), level, patterns: [] };
  for (const band of ["lower", "target"] as const) {
    const bandLabel = band === "lower" ? "lower levels" : level;
    const prompt = render(loadPrompt("taxonomy_grammar"), { level, band: bandLabel, bandNote: BAND_NOTE(band, level), count: sizes[band] });
    const arr = (v: unknown) => { const o = v as { patterns?: unknown }; if (!Array.isArray(o?.patterns)) throw new Error("patterns[] expected"); return o.patterns.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean); };
    const { value } = await callJson(env.generator.provider, { prompt, model: env.generator.model }, arr, { budget: env.budget, log: env.log, sleep: env.sleep });
    const seen = new Set<string>();
    const proposed = value.filter((p) => { const k = p.normalize("NFKC").replace(/[\s〜~～]/g, ""); if (seen.has(k)) return false; seen.add(k); return true; });
    const review = render(loadPrompt("taxonomy_review"), { band: bandLabel, bandNote: BAND_NOTE(band, level), list: proposed.map((p) => `- ${p}`).join("\n") });
    const { value: rv } = await callJson(env.verifier.provider, { prompt: review, model: env.verifier.model }, (v) => { const o = v as { remove?: { pattern: string }[] }; return { remove: Array.isArray(o?.remove) ? o.remove.map((r) => String(r.pattern)) : [] }; }, { budget: env.budget, log: env.log, sleep: env.sleep });
    const drop = new Set(rv.remove);
    for (const p of proposed) if (!drop.has(p)) out.patterns.push({ pattern: p, band });
  }
  writeJson(taxPath(env, level), out);
  return out;
}

/* ---------------- running steps (shared by seed and fill) ---------------- */

export interface StepResult { stepId: string; runIds: string[]; verified: number; stopped?: string }
export interface StepState { runs: Record<string, string[]> }

/**
 * Runs each step: generate, verify, and top up (up to 3 more attempts) until `count` good items exist.
 * Interrupted runs resume from the saved state file; finished steps cost nothing on a re-run.
 */
/** "Do not repeat ..." line so top-up attempts ask for NEW items instead of the model's favourites again. */
export function avoidLine(kind: Kind, ledger: Ledger, extra: ContentRecord[]): string {
  const items: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => { if (k && !seen.has(k)) { seen.add(k); items.push(k); } };
  for (const e of ledger.entries.values()) if (e.kind === kind) add(e.key.replace(/^.*?\|/, (m) => (kind === "VOCAB" ? "" : m)).split("|")[0]!);
  for (const r of extra) if (r.kind === kind) add(kind === "KANA" ? [...(r.payload.chars as string[])].sort().join("") : kind === "VOCAB" ? String(r.payload.surface) : String(r.payload.pattern));
  if (!items.length || kind === "QUESTION") return "";
  const shown = items.slice(-200);
  return `Already covered, do NOT output these again (choose different ones): ${shown.join(", ")}`;
}

export async function executeSteps(env: RunEnv, steps: PlanStep[], statePath: string, log: (m: string) => void = console.log): Promise<{ records: ContentRecord[]; stopped?: string; shortfalls: { id: string; missing: number }[] }> {
  const state: StepState = existsSync(statePath) ? readJson<StepState>(statePath) : { runs: {} };
  const verifiedOf = (id: string): ContentRecord[] => (state.runs[id] ?? []).flatMap((rid) => listJson(join(runDir(env, rid), "verified")).map((f) => readJson<ContentRecord>(f)));
  const good = (id: string, kind: Kind) => closeReferences(verifiedOf(id)).kept.filter((r) => r.kind === kind).length;
  const shortfalls: { id: string; missing: number }[] = [];
  for (const s of steps) {
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const rid of state.runs[s.id] ?? []) {
        const v = await verifyCommand(env, rid);
        if (v.stoppedByBudget) { log(`[fill] stopped: ${v.stoppedByBudget}. Run the same command again to continue.`); return { records: stateRecords(), stopped: v.stoppedByBudget, shortfalls }; }
      }
      const missing = s.count - good(s.id, s.kind);
      if (missing <= 0) break;
      if (attempt === 3) { shortfalls.push({ id: s.id, missing }); log(`[fill] ${s.id}: still ${missing} short after 3 attempts`); break; }
      try {
        const avoid = avoidLine(s.kind, new Ledger(env.ledgerPath), verifiedOf(s.id));
        const r = await genCommand(env, { kind: s.kind, level: s.level, count: missing, pool: s.pool, domain: s.domain, domainGuide: s.guide, topic: s.topic, extra: [s.extra, avoid].filter(Boolean).join("\n") || undefined, passageType: s.passageType, questionsPerPassage: s.questionsPerPassage, questionsPerPoint: s.questionsPerPoint, groupTag: s.groupTag, runId: makeRunId(`${s.id}`) } as never);
        (state.runs[s.id] ??= []).push(r.runId); writeJson(statePath, state);
        log(`[fill] ${s.id}: attempt ${attempt + 1}: ${r.written} drafts for ${missing} missing (${r.runId})`);
      } catch (e) {
        if ((e as { reason?: string }).reason) { log(`[fill] stopped: ${(e as Error).message}. Run the same command again to continue.`); return { records: stateRecords(), stopped: (e as Error).message, shortfalls }; }
        throw e;
      }
    }
  }
  function stateRecords(): ContentRecord[] { return steps.flatMap((s) => closeReferences(verifiedOf(s.id)).kept); }
  return { records: stateRecords(), shortfalls };
}
