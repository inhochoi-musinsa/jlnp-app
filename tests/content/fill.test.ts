import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetTracker } from "../../tools/content/src/budget";
import { fill } from "../../tools/content/src/fill";
import { ensureTaxonomy, makePlan } from "../../tools/content/src/plan";
import { Ledger } from "../../tools/content/src/ledger";
import type { RunEnv } from "../../tools/content/src/run";
import { FakeProvider, isQuality } from "./fakes";
import { checkPackIntegrity } from "../../shared/pack";
import { buildRecord } from "../../shared/schema";
import { readJson } from "../../tools/content/src/util";

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const verified = (kind: string) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: ["SCHEMA_LINT", "QUALITY_CHECK"].map((id) => ({ id, result: "PASS" as const })) });

function rig(maxCalls = 10000) {
  const dir = mkdtempSync(join(tmpdir(), "fill-"));
  let n = 0;
  const gen = new FakeProvider("headless", (req) => {
    if (req.prompt.includes("pairs of kana")) {
      const count = Number(/write (\d+) pairs/.exec(req.prompt)![1]);
      return JSON.stringify(Array.from({ length: count }, () => { const i = n++; const a = String.fromCodePoint(0x3042 + (i % 80)), b = String.fromCodePoint(0x30a2 + ((i * 7 + 3) % 80)); return { chars: [a, b], readings: { [a]: `가${i}`, [b]: `나${i}` }, confusionNoteKo: `구분 방법 ${i}`, tags: [] }; }));
    }
    if (req.prompt.includes("grammar patterns that are a sensible study list")) {
      const count = Number(/propose (\d+) grammar patterns/.exec(req.prompt)![1]);
      const band = /\(levels below/.test(req.prompt) ? "L" : "T";
      return JSON.stringify({ patterns: Array.from({ length: count }, (_, i) => `〜${band}文型${i}`).concat([`〜${band}文型0`]) }); // one duplicate on purpose
    }
    throw new Error("unexpected generator prompt: " + req.prompt.slice(0, 80));
  }, () => "claude-sonnet-5-5");
  const ver = new FakeProvider("headless", (req) => {
    if (req.prompt.includes("review a proposed list")) return JSON.stringify({ remove: [{ pattern: "〜L文型1", why: "duplicate" }] , missing: [] });
    if (isQuality(req.prompt)) return JSON.stringify({ verdict: "PASS", issues: [], levelFit: true, contextCues: 2 });
    throw new Error("unexpected verifier prompt: " + req.prompt.slice(0, 80));
  }, () => "claude-opus-5-5");
  const env: RunEnv = { generator: { provider: gen, model: "sonnet", concurrency: 2 }, verifier: { provider: ver, model: "opus", concurrency: 2 }, budget: new BudgetTracker({ maxCalls }), contentDir: join(dir, "content"), ledgerPath: join(dir, "ledger.json"), packsDir: join(dir, "packs"), useAnalyzer: false, log: () => {}, sleep: async () => {} };
  return { dir, env, gen, ver };
}
const quiet = () => {};

describe("content:plan", () => {
  const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "pl-")), "l.json"));
  it("without progress it plans the initial amounts (400 words, 40 grammar points, 20 kana pairs, 100 kanji questions)", () => {
    const p = makePlan({ level: "N3", days: 28, ledger });
    const sum = (g: string) => p.steps.filter((s) => s.group === g).reduce((a, s) => a + s.count, 0);
    expect(sum("VOCAB")).toBe(400);
    expect(sum("GRAMMAR")).toBe(40);
    expect(sum("KANA")).toBe(20);
    expect(sum("Q_READING_KANJI") + sum("Q_ORTHOGRAPHY") + sum("Q_CONTEXT")).toBe(100);
    expect(p.steps.find((s) => s.group === "GRAMMAR")!.questionsPerPoint).toBe(4);
  });
  it("what is already in the ledger is not planned again", () => {
    const l = new Ledger(join(mkdtempSync(join(tmpdir(), "pl-")), "l.json"));
    for (let i = 0; i < 100; i++) l.add(buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { surface: `語${i}`, reading: "ごい", pos: "noun", meaningKo: "x", example: { ja: "例です。", ko: "x" }, levelEstimate: "N3", miscTags: [] }, provenance: prov, verification: verified("VOCAB") }));
    const p = makePlan({ level: "N3", days: 28, ledger: l });
    expect(p.steps.filter((s) => s.kind === "VOCAB").reduce((a, s) => a + s.count, 0)).toBe(300);
  });
  it("progress.json drives the runway shortfall and the misconception emphasis", () => {
    const prog = { format: "jlpt-progress", level: "N3", route: "TARGET_FOCUS", dailyNewCap: 15, unseen: { VOCAB: 30, GRAMMAR: 2 }, wrongByTag: { KO_PARTICLE_TRANSFER: 9, KUN_READING: 4, GRAMMAR_NUANCE: 2, VOWEL_LENGTH: 1 } };
    const full = new Ledger(join(mkdtempSync(join(tmpdir(), "pl-")), "l.json"));
    for (let i = 0; i < 400; i++) full.add(buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { surface: `語${i}`, reading: "ごい", pos: "noun", meaningKo: "x", example: { ja: "例です。", ko: "x" }, levelEstimate: "N3", miscTags: [] }, provenance: prov, verification: verified("VOCAB") }));
    const p = makePlan({ level: "N3", days: 28, progress: prog, ledger: full });
    expect(p.steps.filter((s) => s.kind === "VOCAB").reduce((a, s) => a + s.count, 0)).toBe(28 * 15 - 30); // runway shortfall beats the (met) initial amount
    expect(p.emphasisTags.map((e) => e.tag)).toEqual(["KO_PARTICLE_TRANSFER", "KUN_READING", "GRAMMAR_NUANCE"]);
    expect(p.steps.find((s) => s.kind === "VOCAB")!.extra).toContain("KO_PARTICLE_TRANSFER");
  });
  it("when everything is met the plan is empty", () => {
    const l = new Ledger(join(mkdtempSync(join(tmpdir(), "pl-")), "l.json"));
    const prog = { format: "jlpt-progress", route: "FOUNDATION", dailyNewCap: 10, unseen: { VOCAB: 999, GRAMMAR: 999 } };
    const mk = (kind: any, i: number, payload: object) => buildRecord({ kind, level: "N3", pool: "LEARN", tags: [], payload, provenance: prov, verification: verified(kind) });
    for (let i = 0; i < 400; i++) l.add(mk("VOCAB", i, { surface: `語${i}`, reading: "ごい", pos: "noun", meaningKo: "x", example: { ja: "例です。", ko: "x" }, levelEstimate: "N3", miscTags: [] }));
    for (let i = 0; i < 40; i++) l.add(mk("GRAMMAR", i, { pattern: `〜形${i}`, attachment: "a", meaningKo: "b", nuanceKo: "c", contrastPatterns: [], examples: [{ ja: "例1です。", ko: "x" }, { ja: "例2です。", ko: "x" }] }));
    for (let i = 0; i < 20; i++) l.add(mk("KANA", i, { chars: [String.fromCodePoint(0x3042 + i), String.fromCodePoint(0x30a2 + i * 2)], readings: {}, confusionNoteKo: "x" }));
    const p = makePlan({ level: "N3", days: 28, progress: prog, ledger: l, domainCounts: { READING_KANJI: 40, ORTHOGRAPHY: 30, CONTEXT: 30 } });
    expect(p.steps).toEqual([]);
  });
});

describe("content:fill (fake LLM)", () => {
  it("dry-run reports the estimate and writes nothing", async () => {
    const r = rig();
    const lines: string[] = [];
    expect(await fill(r.env, { level: "N3", days: 28, dryRun: true }, (m) => lines.push(m))).toBe(0);
    expect(lines.join("\n")).toMatch(/estimate: \d+ calls/);
    expect(lines.join("\n")).toContain("dry-run: nothing generated");
    expect(r.gen.calls.length + r.ver.calls.length).toBe(0);
    expect(existsSync(join(r.dir, "packs"))).toBe(false);
  });

  it("KANA step: gen -> verify -> pack; the pack is intact; a re-run finds nothing missing and makes no calls", async () => {
    const r = rig();
    const lines: string[] = [];
    expect(await fill(r.env, { level: "N3", days: 28, dryRun: false, only: ["KANA"] }, (m) => lines.push(m))).toBe(0);
    const packs = readdirSync(join(r.dir, "packs"));
    expect(packs.length).toBe(1);
    const pack = readJson<any>(join(r.dir, "packs", packs[0]!));
    expect(pack.items.length).toBe(20);
    expect(pack.items.every((i: any) => i.kind === "KANA" && i.verification.status === "VERIFIED")).toBe(true);
    expect(checkPackIntegrity(pack)).toEqual({ fileErrors: [], badHashItems: [] });
    expect(new Ledger(r.env.ledgerPath).size).toBe(20);
    // second run against the same ledger: the plan is empty
    const calls = r.gen.calls.length + r.ver.calls.length;
    const again: string[] = [];
    expect(await fill(r.env, { level: "N3", days: 28, dryRun: false, only: ["KANA"] }, (m) => again.push(m))).toBe(0);
    expect(r.gen.calls.length + r.ver.calls.length).toBe(calls);
    expect(again.join("\n")).toContain("nothing to do");
  });

  it("stops at the call limit and a re-run continues from the saved state without duplicates", async () => {
    const r = rig(6);
    expect(await fill(r.env, { level: "N3", days: 28, dryRun: false, only: ["KANA"] }, quiet)).toBe(2);
    const first = new Ledger(r.env.ledgerPath).size;
    expect(first).toBeLessThan(20);
    r.env.budget = new BudgetTracker({ maxCalls: 10000 });
    expect(await fill(r.env, { level: "N3", days: 28, dryRun: false, only: ["KANA"] }, quiet)).toBe(0);
    const ids = new Set<string>();
    for (const f of readdirSync(join(r.dir, "packs"))) for (const i of readJson<any>(join(r.dir, "packs", f)).items) { expect(ids.has(i.contentId)).toBe(false); ids.add(i.contentId); }
    expect(ids.size).toBe(20);
  });

  it("taxonomy: the generator proposes, duplicates are dropped, the verifier prunes; saved once and reused", async () => {
    const r = rig();
    const t = await ensureTaxonomy(r.env, "N3", { lower: 6, target: 8 });
    const lower = t.patterns.filter((p) => p.band === "lower").map((p) => p.pattern);
    expect(lower).not.toContain("〜L文型1");            // pruned by the verifier
    expect(lower.filter((p) => p === "〜L文型0").length).toBe(1); // duplicate collapsed
    expect(t.patterns.filter((p) => p.band === "target").length).toBe(8);
    const calls = r.gen.calls.length + r.ver.calls.length;
    await ensureTaxonomy(r.env, "N3", { lower: 6, target: 8 });
    expect(r.gen.calls.length + r.ver.calls.length).toBe(calls);
  });
});
