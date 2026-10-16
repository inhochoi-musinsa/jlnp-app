import { audioKeyFor } from "../../../shared/audio";
import { buildRecord, validateContentRecord, type Check, type ContentRecord } from "../../../shared/schema";
import { lintRecord } from "../../../shared/lint";
import { stripRuby } from "../../../shared/ruby";
import { claimsVerified } from "../../../shared/verification";
import { callJson, type CallOptions } from "./llm/call";
import { TrackingProvider, type LlmProvider } from "./llm/types";
import { loadPrompt, promptVersion, render } from "./prompts";
import { cleanQuestion } from "./generate";
import type { Ledger } from "./ledger";
import { readingFindings, type Analyzer } from "./readingCheck";
import { shuffleIds, type Rng } from "../../../app/src/domain/quiz";

export interface VerifyRole { provider: LlmProvider; model: string }
export interface VerifyCtx {
  verifier: VerifyRole;
  generator: VerifyRole;          // used for REVISE rewrites
  ledger: Ledger;
  analyzer?: () => Promise<Analyzer>;
  /** passage / grammar-point text by contentId, shown to the blind solver. */
  context: Map<string, string>;
  rng?: Rng;
  maxRevise?: number;             // default 2
  call?: CallOptions;
}

export type Outcome = "VERIFIED" | "UNVERIFIED" | "REJECTED" | "DUPLICATE";
export interface VerifyResult { outcome: Outcome; record: ContentRecord; checks: Check[]; reason?: string; revisions: number; existingId?: string }

const LABELS = ["A", "B", "C", "D"];
const asObj = (v: unknown) => { if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("expected a JSON object"); return v as Record<string, any>; };

const blindLetters = new Set(["A", "B", "C", "D", "NONE", "MULTIPLE"]);
const validateBlind = (v: unknown) => { const o = asObj(v); const a = String(o.answer ?? "").toUpperCase(); if (!blindLetters.has(a)) throw new Error("answer must be A-D, NONE or MULTIPLE"); return { answer: a, reason: String(o.reason ?? "") }; };
const validateDistractor = (v: unknown) => {
  const o = asObj(v);
  if (!Array.isArray(o.wrong)) throw new Error("wrong[] required");
  return { wrong: o.wrong.map((w: any) => ({ option: String(w.option), clearlyWrong: w.clearlyWrong === true, note: String(w.note ?? "") })), multipleCorrectPossible: o.multipleCorrectPossible === true, issues: Array.isArray(o.issues) ? o.issues.map(String) : [] };
};
const validateQuality = (v: unknown) => {
  const o = asObj(v);
  if (!["PASS", "REVISE", "REJECT"].includes(o.verdict)) throw new Error("verdict must be PASS|REVISE|REJECT");
  return { verdict: o.verdict as "PASS" | "REVISE" | "REJECT", issues: Array.isArray(o.issues) ? o.issues.map(String) : [], levelFit: o.levelFit !== false, contextCues: Number(o.contextCues ?? 0) };
};

function questionView(rec: ContentRecord, order: string[], ctx: VerifyCtx) {
  const p = rec.payload;
  const byId = new Map<string, any>((p.choices as any[]).map((c) => [c.id, c]));
  const options = order.map((id, i) => `${LABELS[i]}. ${stripRuby(byId.get(id).text)}`).join("\n");
  const ref = (p.stimulusId ?? p.linkedContentId) as string | undefined;
  const ctxText = ref ? ctx.context.get(ref) : undefined;
  const passage = ctxText ? `Reference text:\n${ctxText}\n\n` : "";
  return { stem: stripRuby(String(p.stem)), options, passage, order };
}

/** Item JSON shown to the quality reviewer (ids and hashes removed). */
const itemForReview = (rec: ContentRecord) => JSON.stringify({ kind: rec.kind, level: rec.level, pool: rec.pool, tags: rec.tags, payload: rec.payload }, null, 1);

interface StepFail { id: string; verdict: "REVISE" | "REJECT"; issues: string[] }

async function runChecks(ctx: VerifyCtx, rec: ContentRecord, checks: Check[]): Promise<StepFail | null> {
  const level = rec.level;
  const call = ctx.call;
  const rng = ctx.rng ?? Math.random;

  // V1 SCHEMA_LINT -> immediate REJECT
  const issues = [...validateContentRecord(rec), ...lintRecord(rec)];
  if (issues.length) { checks.push({ id: "SCHEMA_LINT", result: "FAIL", note: issues.map((i) => `${i.code}@${i.path}`).join("; ").slice(0, 400) }); return { id: "SCHEMA_LINT", verdict: "REJECT", issues: issues.map((i) => `${i.code}: ${i.message} (${i.path})`) }; }
  checks.push({ id: "SCHEMA_LINT", result: "PASS" });

  // V2 READING_CHECK (WARN is passed to V5)
  let readingNote = "";
  if (ctx.analyzer) {
    const findings = readingFindings(rec, await ctx.analyzer());
    if (findings.length) {
      checks.push({ id: "READING_CHECK", result: "WARN", note: findings.map((f) => `${f.text}: declared ${f.expected}, analyzer ${f.analyzer}`).join("; ").slice(0, 400) });
      readingNote = "Reading check WARNING (decide which reading is right and report it as an issue if the record is wrong):\n" + findings.map((f) => `- ${f.text}: record says ${f.expected}, analyzer says ${f.analyzer}`).join("\n") + "\n";
    } else checks.push({ id: "READING_CHECK", result: "PASS" });
  }

  if (rec.kind === "QUESTION") {
    // V3 BLIND_SOLVE: shuffled order each round, answer hidden
    const rounds = rec.pool === "ASSESS" ? 4 : 2;
    const ids = (rec.payload.choices as any[]).map((c) => c.id as string);
    const tally: string[] = [];
    for (let r = 0; r < rounds; r++) {
      const order = shuffleIds(ids, rng);
      const v = questionView(rec, order, ctx);
      const prompt = render(loadPrompt("verify_blind"), { stem: v.stem, options: v.options, passage: v.passage });
      const { value } = await callJson(ctx.verifier.provider, { prompt, model: ctx.verifier.model }, validateBlind, call);
      const idx = LABELS.indexOf(value.answer);
      const picked = idx >= 0 ? order[idx]! : value.answer;
      tally.push(picked);
      if (picked !== rec.payload.correctChoiceId) {
        checks.push({ id: "BLIND_SOLVE", result: "FAIL", note: `round ${r + 1}: solver chose ${picked} (${value.reason.slice(0, 120)})` });
        return { id: "BLIND_SOLVE", verdict: "REVISE", issues: [`A blind solver answered "${picked}" instead of the key "${rec.payload.correctChoiceId}" (${value.reason}). Make exactly one option correct and unambiguous.`] };
      }
    }
    checks.push({ id: "BLIND_SOLVE", result: "PASS", note: `${rounds}/${rounds} rounds matched` });

    // V4 DISTRACTOR_CHECK
    const order = ids;
    const v = questionView(rec, order, ctx);
    const correctLabel = LABELS[order.indexOf(rec.payload.correctChoiceId)]!;
    const prompt = render(loadPrompt("verify_distractor"), { level, stem: v.stem, options: v.options, passage: v.passage, correct: correctLabel });
    const { value } = await callJson(ctx.verifier.provider, { prompt, model: ctx.verifier.model }, validateDistractor, call);
    const weak = value.wrong.filter((w) => !w.clearlyWrong);
    if (value.multipleCorrectPossible || weak.length) {
      const iss = [...value.issues, ...weak.map((w) => `Option ${w.option} is not clearly wrong: ${w.note}`)];
      checks.push({ id: "DISTRACTOR_CHECK", result: "FAIL", note: iss.join(" | ").slice(0, 400) });
      return { id: "DISTRACTOR_CHECK", verdict: "REVISE", issues: iss.length ? iss : ["More than one option may be correct."] };
    }
    checks.push({ id: "DISTRACTOR_CHECK", result: "PASS" });
  }

  // V5 QUALITY_CHECK
  const prompt = render(loadPrompt("verify_quality"), { level, item: itemForReview(rec), readingNote });
  const { value } = await callJson(ctx.verifier.provider, { prompt, model: ctx.verifier.model }, validateQuality, call);
  if (value.verdict !== "PASS") {
    checks.push({ id: "QUALITY_CHECK", result: "FAIL", note: value.issues.join(" | ").slice(0, 400) });
    return { id: "QUALITY_CHECK", verdict: value.verdict, issues: value.issues.length ? value.issues : ["unspecified quality issue"] };
  }
  checks.push({ id: "QUALITY_CHECK", result: "PASS", note: `contextCues=${value.contextCues}` });
  return null;
}

/** The model may reword a listening script; the audio reference and links are never taken from it (the key is recomputed from the new script). */
export function mergeListeningRevision(orig: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const { audio, ...rest } = orig;
  const segments = Array.isArray(incoming.segments) && incoming.segments.length ? incoming.segments : rest.segments;
  const payload: Record<string, any> = { ...rest, ...(typeof incoming.taskType === "string" ? { taskType: incoming.taskType } : {}), segments };
  if (audio) payload.audio = { key: audioKeyFor(segments, audio.engine, audio.voice, audio.speed), source: audio.source, engine: audio.engine, voice: audio.voice, speed: audio.speed };
  return payload;
}

async function revise(ctx: VerifyCtx, rec: ContentRecord, issues: string[]): Promise<ContentRecord> {
  const prompt = render(loadPrompt("revise"), { level: rec.level, issues: issues.map((i) => `- ${i}`).join("\n"), item: JSON.stringify({ kind: rec.kind, tags: rec.tags, payload: rec.kind === "LISTENING" ? { ...rec.payload, audio: undefined, questionId: undefined } : rec.payload }, null, 1) });
  const { value, response } = await callJson(ctx.generator.provider, { prompt, model: ctx.generator.model }, asObj, ctx.call);
  const incoming = (value.payload ?? value) as Record<string, any>;
  let payload: Record<string, any>;
  if (rec.kind === "QUESTION") {
    const keep: Record<string, unknown> = { domain: rec.payload.domain, scoringSection: rec.payload.scoringSection };
    if (rec.payload.stimulusId) keep.stimulusId = rec.payload.stimulusId;
    if (rec.payload.linkedContentId) keep.linkedContentId = rec.payload.linkedContentId;
    payload = cleanQuestion(incoming, keep);
  } else if (rec.kind === "LISTENING") payload = mergeListeningRevision(rec.payload, incoming);
  else payload = { ...rec.payload, ...incoming };
  const revised = buildRecord({
    kind: rec.kind, level: rec.level, pool: rec.pool, tags: Array.isArray(value.tags) ? value.tags : rec.tags, payload, contentVersion: rec.contentVersion,
    provenance: { ...rec.provenance, generatorModel: response.resolvedModel ?? ctx.generator.model, resolved: response.resolved, promptVersion: promptVersion(["revise"]) },
    verification: { status: "UNVERIFIED", selfAttested: false, checks: [] },
  });
  // A revision is still the same unpublished slot: keep the id so passage.questionIds / parent links stay valid.
  return { ...revised, contentId: rec.contentId };
}

const tracked = (r: VerifyRole): { model: string; resolved: boolean } =>
  r.provider instanceof TrackingProvider && r.provider.resolvedModel ? { model: r.provider.resolvedModel, resolved: r.provider.resolved } : { model: r.model, resolved: false };

export async function verifyRecord(ctx: VerifyCtx, input: ContentRecord): Promise<VerifyResult> {
  const maxRevise = ctx.maxRevise ?? 2;
  let rec = input;
  let revisions = 0;
  const pre = ctx.ledger.check(rec);
  if (pre.dup) return { outcome: "DUPLICATE", record: rec, checks: [], reason: `${pre.reason}${pre.score ? ` ${pre.score.toFixed(2)}` : ""}`, existingId: pre.existingId, revisions };
  for (;;) {
    const checks: Check[] = [];
    const fail = await runChecks(ctx, rec, checks);
    if (!fail) {
      const dup = ctx.ledger.check(rec);
      if (dup.dup) return { outcome: "DUPLICATE", record: rec, checks, reason: dup.reason, existingId: dup.existingId, revisions };
      checks.push({ id: "DEDUPE", result: "PASS" });
      const verified: ContentRecord = {
        ...rec,
        verification: {
          status: "VERIFIED", selfAttested: false, verifierModel: tracked(ctx.verifier).model, verifierProvider: ctx.verifier.provider.kind, verifierResolved: tracked(ctx.verifier).resolved,
          rounds: revisions + 1, checks, verifiedAt: new Date().toISOString(),
        },
      };
      const claim = claimsVerified(verified);
      if (!claim.ok) return { outcome: "UNVERIFIED", record: { ...verified, verification: { ...verified.verification, status: "UNVERIFIED" } }, checks, reason: claim.reason, revisions };
      return { outcome: "VERIFIED", record: verified, checks, revisions };
    }
    if (fail.verdict === "REJECT" || revisions >= maxRevise) return { outcome: "REJECTED", record: { ...rec, verification: { ...rec.verification, checks } }, checks, reason: `${fail.id}: ${fail.issues.join(" | ").slice(0, 300)}`, revisions };
    revisions++;
    rec = await revise(ctx, rec, fail.issues);
  }
}
