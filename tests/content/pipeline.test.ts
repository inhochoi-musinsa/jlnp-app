import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetTracker } from "../../tools/content/src/budget";
import { genCommand, packCommand, verifyCommand, ledgerCommand, readPack, type RunEnv } from "../../tools/content/src/run";
import { Ledger } from "../../tools/content/src/ledger";
import { estimate } from "../../tools/content/src/estimate";
import { FakeProvider, isBlind, isDistractor, isGen, isQuality, isRevise, labelOfCorrect, mkQuestion } from "./fakes";
import { checkPackIntegrity } from "../../shared/pack";
import { claimsVerified } from "../../shared/verification";
import type { ContentRecord } from "../../shared/schema";
import { listJson, readJson } from "../../tools/content/src/util";

interface World { dir: string; env: RunEnv; gen: FakeProvider; ver: FakeProvider }

const STEMS = Array.from({ length: 10 }, (_, i) => `昨日は雨が降っていたので、友達とのやくそく${i}を（　　）ことにした${"あいうえおかきくけこ"[i]}。`);

/** Fake LLM. `plan` tweaks behaviour per stem: blindFail, qualityRevise, qualityReject. */
function world(opts: { plan?: Record<string, "blindFail" | "qualityRevise" | "qualityReject" | "multi">; genModel?: string; verModel?: string; hideModel?: boolean; stems?: string[] } = {}): World {
  const dir = mkdtempSync(join(tmpdir(), "content-"));
  const stems = opts.stems ?? STEMS;
  const correctOf = new Map(stems.map((s) => [s, `正解${s.length}a`]));
  const revised = new Set<string>();
  const stemIn = (p: string) => stems.find((s) => p.includes(s));
  const gen = new FakeProvider("headless", (req) => {
    if (isGen(req.prompt)) {
      const n = Number(/write (\d+)/.exec(req.prompt)![1]);
      const start = n === 8 ? 0 : Math.max(0, stems.length - n);
      return JSON.stringify(stems.slice(start, start + n).map((s) => mkQuestion(s)));
    }
    if (isRevise(req.prompt)) {
      const s = stemIn(req.prompt)!;
      revised.add(s);
      return JSON.stringify(mkQuestion(s, "a", { explanationKo: "수정된 해설입니다." }));
    }
    throw new Error("unexpected generator prompt");
  }, () => (opts.hideModel ? undefined : opts.genModel ?? "claude-sonnet-5-5"));
  const ver = new FakeProvider("headless", (req) => {
    const s = stemIn(req.prompt);
    const plan = s ? opts.plan?.[s] : undefined;
    if (isBlind(req.prompt)) {
      const good = labelOfCorrect(req.prompt, correctOf.get(s!)!);
      // a label that is guaranteed to be wrong (random shuffles must not make this test flaky)
      if (plan === "blindFail" && !revised.has(s!)) return JSON.stringify({ answer: good === "A" ? "B" : "A", reason: "ambiguous" });
      return JSON.stringify({ answer: good, reason: "ok" });
    }
    if (isDistractor(req.prompt)) {
      if (plan === "multi") return JSON.stringify({ wrong: [{ option: "B", clearlyWrong: false, note: "also fine" }], multipleCorrectPossible: true, issues: ["B also works"] });
      return JSON.stringify({ wrong: [], multipleCorrectPossible: false, issues: [] });
    }
    if (isQuality(req.prompt)) {
      if (plan === "qualityReject") return JSON.stringify({ verdict: "REJECT", issues: ["copied from an official exam"] });
      if (plan === "qualityRevise" && !revised.has(s!)) return JSON.stringify({ verdict: "REVISE", issues: ["explanation is unclear"] });
      return JSON.stringify({ verdict: "PASS", issues: [], levelFit: true, contextCues: 2 });
    }
    throw new Error("unexpected verifier prompt");
  }, () => (opts.hideModel ? undefined : opts.verModel ?? "claude-opus-5-5"));
  const env: RunEnv = {
    generator: { provider: gen, model: "sonnet", concurrency: 2 }, verifier: { provider: ver, model: "opus", concurrency: 2 },
    budget: new BudgetTracker({ maxCalls: 1000 }), contentDir: join(dir, "content"), ledgerPath: join(dir, "ledger.json"), useAnalyzer: false, log: () => {}, sleep: async () => {},
  };
  return { dir, env, gen, ver };
}

describe("T05 pilot: gen -> verify -> pack (fake LLM, both roles resolved)", () => {
  let w: World;
  beforeEach(() => { w = world(); });

  it("10 items go through every step and every one is VERIFIED", async () => {
    const g = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 10, pool: "LEARN", domain: "GRAMMAR_FORM" });
    expect(g.written).toBe(10);
    const s = await verifyCommand(w.env, g.runId);
    expect(s).toMatchObject({ verified: 10, rejected: 0, duplicates: 0, pending: 0 });
    const rec = readJson<ContentRecord>(listJson(join(w.dir, "content/runs", g.runId, "verified"))[0]!);
    expect(rec.verification.checks.map((c) => c.id)).toEqual(["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK", "DEDUPE"]);
    expect(rec.provenance.generatorModel).toBe("claude-sonnet-5-5");
    expect(rec.verification.verifierModel).toBe("claude-opus-5-5");
    expect(rec.verification.verifierResolved).toBe(true);
    expect(claimsVerified(rec).ok).toBe(true);
    const out = join(w.dir, "packs/p.jlptpack.json");
    const p = packCommand(w.env, g.runId, out);
    expect(p.pack.items.length).toBe(10);
    expect(checkPackIntegrity(readPack(out))).toEqual({ fileErrors: [], badHashItems: [] });
    // blind solving shuffles: at least one prompt must list the correct text at a position other than A
    const blind = w.ver.calls.filter((c) => isBlind(c.prompt));
    expect(blind.length).toBe(20); // 2 rounds x 10
    expect(new Set(blind.map((c) => /^([A-D])\. 正解/m.exec(c.prompt)?.[1])).size).toBeGreaterThan(1);
    // blind prompts never contain the key
    expect(blind.every((c) => !/correctChoiceId|whyWrong|howToCorrect/.test(c.prompt))).toBe(true);
  });

  it("REVISE path: blind-solve failure triggers a rewrite and the revised item is then verified", async () => {
    const stems = STEMS.slice(0, 3);
    const ww = world({ stems, plan: { [stems[1]!]: "blindFail", [stems[2]!]: "qualityRevise" } });
    const g = await genCommand(ww.env, { kind: "QUESTION", level: "N3", count: 3, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const s = await verifyCommand(ww.env, g.runId);
    expect(s.verified).toBe(3);
    expect(s.results.filter((r) => r.revisions === 1).length).toBe(2);
    expect(ww.gen.calls.filter((c) => isRevise(c.prompt)).length).toBe(2);
    const revisedItem = listJson(join(ww.dir, "content/runs", g.runId, "verified")).map((f) => readJson<ContentRecord>(f)).find((r) => r.payload.explanationKo === "수정된 해설입니다.")!;
    expect(revisedItem.verification.rounds).toBe(2);
  });

  it("REJECT path: quality REJECT, repeated failure after 2 rewrites, and multi-answer distractors", async () => {
    const stems = STEMS.slice(0, 3);
    const ww = world({ stems, plan: { [stems[0]!]: "qualityReject", [stems[1]!]: "multi" } });
    const g = await genCommand(ww.env, { kind: "QUESTION", level: "N3", count: 3, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const s = await verifyCommand(ww.env, g.runId);
    expect(s.verified).toBe(1);
    expect(s.rejected).toBe(2);
    const byId = Object.fromEntries(s.results.map((r) => [r.id, r]));
    const rej = s.results.filter((r) => r.outcome === "REJECTED");
    expect(rej.some((r) => r.reason!.startsWith("QUALITY_CHECK"))).toBe(true);
    expect(rej.some((r) => r.reason!.startsWith("DISTRACTOR_CHECK") && r.revisions === 2)).toBe(true); // 2 rewrites max, then REJECT
    expect(Object.keys(byId).length).toBe(3);
    expect(ww.gen.calls.filter((c) => isRevise(c.prompt)).length).toBe(2);
  });

  it("V1 lint failures are rejected immediately without spending verifier calls", async () => {
    const stem = "明日は会議があるので、早く（　　）ことにした。";
    const ww = world({ stems: [stem] });
    const g = await genCommand(ww.env, { kind: "QUESTION", level: "N3", count: 1, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const file = listJson(join(ww.dir, "content/runs", g.runId, "drafts"))[0]!;
    const rec = readJson<ContentRecord>(file);
    (rec.payload.choices as any[])[1].whyWrong = "";
    const { writeJson } = await import("../../tools/content/src/util");
    writeJson(file, rec);
    const s = await verifyCommand(ww.env, g.runId);
    expect(s.rejected).toBe(1);
    expect(s.results[0]!.reason).toContain("SCHEMA_LINT");
    expect(ww.ver.calls.length).toBe(0);
  });

  it("ledger blocks duplicates in a later run and survives a rebuild from a full-export pack", async () => {
    const g1 = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 10, pool: "LEARN", domain: "GRAMMAR_FORM" });
    await verifyCommand(w.env, g1.runId);
    const g2 = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 10, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const callsBefore = w.ver.calls.length;
    const s2 = await verifyCommand(w.env, g2.runId);
    expect(s2.duplicates).toBe(10);
    expect(s2.verified).toBe(0);
    expect(w.ver.calls.length).toBe(callsBefore); // duplicates cost no verifier calls
    // lose the ledger, rebuild it from the pack, duplicates are still caught
    const out = join(w.dir, "packs/full.jlptpack.json");
    packCommand(w.env, g1.runId, out);
    const lp = join(w.dir, "ledger2.json");
    expect(ledgerCommand(out, lp)).toBe(10);
    const l = new Ledger(lp);
    const rec = readJson<ContentRecord>(listJson(join(w.dir, "content/runs", g2.runId, "drafts"))[0]!);
    expect(l.check(rec).dup).toBe(true);
  });

  it("an interrupted run resumes: items already judged are not verified twice", async () => {
    const g = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 10, pool: "LEARN", domain: "GRAMMAR_FORM" });
    w.env.budget = new BudgetTracker({ maxCalls: 12 }); // blind x2 + distractor + quality = 4 calls per item
    const s1 = await verifyCommand(w.env, g.runId);
    expect(s1.stoppedByBudget).toBeTruthy();
    expect(s1.verified).toBeLessThan(10);
    w.env.budget = new BudgetTracker({ maxCalls: 1000 });
    const s2 = await verifyCommand(w.env, g.runId);
    expect(s1.verified + s2.verified).toBe(10);
    expect(s2.pending).toBe(0);
  });
});

describe("generator and verifier must be provably different models", () => {
  it("same resolved model -> UNVERIFIED and excluded from packs", async () => {
    const w = world({ stems: STEMS.slice(0, 2), genModel: "claude-opus-5-5", verModel: "claude-opus-5-5" });
    const g = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 2, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const s = await verifyCommand(w.env, g.runId);
    expect(s.verified).toBe(0);
    expect(s.unverified).toBe(2);
    expect(packCommand(w.env, g.runId, join(w.dir, "p.json")).pack.items.length).toBe(0);
  });
  it("unresolved aliases that cannot be compared -> UNVERIFIED", async () => {
    const w = world({ stems: STEMS.slice(0, 1), hideModel: true });
    w.env.generator.model = "claude-sonnet-5-5"; // full id vs alias 'opus': family differs -> still decidable
    const g = await genCommand(w.env, { kind: "QUESTION", level: "N3", count: 1, pool: "LEARN", domain: "GRAMMAR_FORM" });
    const s = await verifyCommand(w.env, g.runId);
    expect(s.verified).toBe(1); // sonnet vs opus families differ even without resolved names
    const w2 = world({ stems: STEMS.slice(0, 1), hideModel: true });
    w2.env.verifier.model = "claude-sonnet-5-5"; w2.env.generator.model = "sonnet";
    const g2 = await genCommand(w2.env, { kind: "QUESTION", level: "N3", count: 1, pool: "LEARN", domain: "GRAMMAR_FORM" });
    expect((await verifyCommand(w2.env, g2.runId)).unverified).toBe(1); // alias vs full id of the same family: cannot tell
  });
});

describe("dry run estimate", () => {
  it("reports calls for headless and USD for api", () => {
    const h = estimate({ kind: "QUESTION", count: 100, pool: "LEARN", gen: { provider: "headless", model: "sonnet" }, verify: { provider: "headless", model: "opus" } });
    expect(h.usd).toBeUndefined();
    expect(h.totalCalls).toBeGreaterThan(400);
    const a = estimate({ kind: "QUESTION", count: 100, pool: "LEARN", gen: { provider: "api", model: "claude-sonnet-5-5" }, verify: { provider: "api", model: "claude-opus-5-5" } });
    expect(a.usd).toBeGreaterThan(0);
    const assess = estimate({ kind: "QUESTION", count: 10, pool: "ASSESS", gen: { provider: "api", model: "claude-sonnet-5-5" }, verify: { provider: "api", model: "claude-opus-5-5" } });
    const learn = estimate({ kind: "QUESTION", count: 10, pool: "LEARN", gen: { provider: "api", model: "claude-sonnet-5-5" }, verify: { provider: "api", model: "claude-opus-5-5" } });
    expect(assess.verifyCalls).toBeGreaterThan(learn.verifyCalls);
  });
});
