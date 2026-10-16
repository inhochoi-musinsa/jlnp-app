import { describe, expect, it } from "vitest";
import { buildPack, type Pack } from "../../shared/pack";
import { buildRecord, computeContentHash, type ContentRecord } from "../../shared/schema";
import { planImport, type ExistingContent } from "../../app/src/content/import";
import { activeVersions, effectiveStatus, flagProjection, studyPool } from "../../app/src/content/status";
import { createEvent } from "../../app/src/storage/events";
import { makeContentId } from "../../shared/normalize";

const GEN = { tool: "t", toolVersion: "1", models: { generate: "claude-sonnet-5-5", verify: "claude-opus-5-5" } };
const checks = (kind: string) => (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const }));
const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string, over: Record<string, unknown> = {}) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: checks(kind), ...over });

const q = (n: number, o: { stem?: string; version?: number; pool?: any; verification?: any; payload?: Record<string, unknown>; stimulusId?: string } = {}): ContentRecord => {
  const stem = o.stem ?? `問題番号${n}：昨日は雨が降っていたので、友達との約束を${"あいうえおかきくけこ"[n % 10]}${n}（　　）ことにした。`;
  const choices = ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `正解${n}` } : { id, text: `誤り${id}${n}`, whyWrong: `${id}は文脈に合わない理由${n}`, howToCorrect: `${id}の直し方${n}` });
  return buildRecord({ kind: "QUESTION", level: "N3", pool: o.pool ?? "LEARN", tags: [], contentVersion: o.version ?? 1,
    payload: { domain: "CONTEXT", stem, choices, correctChoiceId: "a", explanationKo: "해설", scoringSection: "LANGUAGE_KNOWLEDGE", ...(o.stimulusId ? { stimulusId: o.stimulusId } : {}), ...o.payload },
    provenance: prov, verification: o.verification ?? ver("QUESTION") });
};
const vocab = (n: number, over: Record<string, unknown> = {}): ContentRecord => buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { surface: `語${n}`, reading: "ごい", pos: "noun", meaningKo: `뜻${n}`, example: { ja: `例文${n}です。`, ko: "예문" }, levelEstimate: "N3", miscTags: [], ...over }, provenance: prov, verification: ver("VOCAB") });
const pack = (items: ContentRecord[]): Pack => buildPack(items, { generator: GEN });
const text = (p: Pack) => JSON.stringify(p);
const none: ExistingContent = { rows: [], blockedIds: new Set(), exposed: new Set() };
const ex = (rows: ContentRecord[], more: Partial<ExistingContent> = {}): ExistingContent => ({ rows, blockedIds: new Set(), exposed: new Set(), ...more });

describe("TST-IMPORT normal / duplicate / re-import", () => {
  it("a clean pack is added; imported records become selfAttested", () => {
    const items = [q(1), q(2), vocab(3)];
    const r = planImport(text(pack(items)), none);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ added: 3, duplicates: 0, conflicts: 0, rejected: 0, held: 0, demoted: 0 });
    expect(r.toWrite.every((x) => x.verification.selfAttested)).toBe(true);
    expect(r.toWrite.every((x) => x.verification.status === "VERIFIED")).toBe(true);
  });
  it("re-importing the same pack adds 0 and reports 100% duplicates (full and per-kind)", () => {
    const items = [q(1), q(2), vocab(3), vocab(4)];
    const first = planImport(text(pack(items)), none);
    const again = planImport(text(pack(items)), ex(first.toWrite));
    expect(again.summary.added + again.summary.newVersions).toBe(0);
    expect(again.summary.duplicates).toBe(4);
    expect(again.toWrite.length).toBe(0);
    const typed = planImport(text(pack(items)), none, { kinds: ["VOCAB"] });
    expect(typed.toWrite.map((x) => x.kind)).toEqual(["VOCAB", "VOCAB"]);
    const typedAgain = planImport(text(pack(items)), ex(typed.toWrite), { kinds: ["VOCAB"] });
    expect(typedAgain.summary.duplicates).toBe(2);
  });
  it("different id but same normalized key is skipped with the existing id shown", () => {
    const a = q(1);
    const b = { ...q(1), contentId: "q:othersameky" } as ContentRecord;
    const r = planImport(text(pack([b])), ex([a]));
    expect(r.outcomes[0]).toMatchObject({ action: "SKIP_DUPLICATE_KEY", existingId: a.contentId });
    expect(r.toWrite.length).toBe(0);
  });
  it("near duplicates (>= 0.85) are skipped unless the user forces them in", () => {
    const long = "昨日は朝から雨が降っていたので、友達とのたいせつな約束を（　　）ことにして、家で静かに本を読みながら過ごした一日でした";
    const base = q(7, { stem: long });
    const nearStem = long.replace("過ごした一日でした", "過ごした一日だった");
    const near = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { ...base.payload, stem: nearStem }, provenance: prov, verification: ver("QUESTION") });
    expect(near.contentId).not.toBe(base.contentId);
    const r = planImport(text(pack([near])), ex([base]));
    expect(r.outcomes[0]).toMatchObject({ action: "SKIP_SIMILAR", existingId: base.contentId });
    expect(r.outcomes[0]!.score).toBeGreaterThanOrEqual(0.85);
    const forced = planImport(text(pack([near])), ex([base]), { forceAdd: new Set([near.contentId]) });
    expect(forced.outcomes[0]!.action).toBe("ADD");
  });
  it("flagged or retired items are not resurrected", () => {
    const a = q(1);
    const r = planImport(text(pack([a])), ex([], { blockedIds: new Set([a.contentId]) }));
    expect(r.outcomes[0]!.action).toBe("SKIP_FLAGGED_SAME_HASH");
    expect(r.toWrite.length).toBe(0);
  });
});

describe("TST-IMPORT merge: versions and conflicts", () => {
  it("higher version, both VERIFIED -> active pointer moves; otherwise candidate", () => {
    const v1 = q(1);
    const v2 = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], contentVersion: 2, payload: { ...v1.payload, explanationKo: "수정" }, provenance: prov, verification: ver("QUESTION") });
    const r = planImport(text(pack([v2])), ex([v1]));
    expect(r.outcomes[0]!.action).toBe("ADD_VERSION_ACTIVE");
    const v2u = { ...v2, verification: ver("QUESTION", { status: "UNVERIFIED" }) } as ContentRecord;
    const r2 = planImport(text(pack([v2u])), ex([v1]));
    expect(r2.outcomes[0]!.action).toBe("ADD_VERSION_CANDIDATE");
    expect(activeVersions([v1, { ...v2u, verification: { ...v2u.verification, status: "UNVERIFIED" } }])[0]!.contentVersion).toBe(1); // candidate stays inactive
    expect(activeVersions([v1, v2])[0]!.contentVersion).toBe(2);
  });
  it("same id+version with a different hash, or a lower version, is an INTEGRITY_CONFLICT", () => {
    const v1 = q(1);
    const forged = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], contentVersion: 1, payload: { ...v1.payload, explanationKo: "다른 해설" }, provenance: prov, verification: ver("QUESTION") });
    const forgedWithSameId = { ...forged, contentId: v1.contentId } as ContentRecord;
    const r = planImport(text(pack([forgedWithSameId])), ex([v1]));
    expect(r.outcomes[0]).toMatchObject({ action: "REJECT", reason: "INTEGRITY_CONFLICT" });
    expect(r.summary.conflicts).toBe(1);
    const v3 = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], contentVersion: 3, payload: { ...v1.payload, explanationKo: "v3" }, provenance: prov, verification: ver("QUESTION") });
    const lower = { ...forgedWithSameId, contentVersion: 2, contentHash: "" } as ContentRecord;
    lower.contentHash = computeContentHash(lower);
    expect(planImport(text(pack([lower])), ex([{ ...v3, contentId: v1.contentId } as ContentRecord])).outcomes[0]!.reason).toBe("INTEGRITY_CONFLICT");
  });
});

describe("TST-IMPORT tamper, malicious strings, references", () => {
  it("a changed payload with the old hash is rejected per item (HASH_MISMATCH)", () => {
    const p = pack([q(1), q(2)]);
    const t = JSON.parse(text(p)) as Pack;
    (t.items[0]!.payload as any).explanationKo = "변조됨";
    const r = planImport(JSON.stringify(t), none);
    expect(r.ok).toBe(true);
    expect(r.summary.byReason.HASH_MISMATCH).toBe(1);
    expect(r.toWrite.length).toBe(1);
  });
  it("wrong counts or a forged manifestHash reject the whole file", () => {
    const t = JSON.parse(text(pack([q(1), q(2)]))) as Pack;
    t.manifest.counts = { QUESTION: 5 };
    expect(planImport(JSON.stringify(t), none).ok).toBe(false);
    const t2 = JSON.parse(text(pack([q(1)]))) as Pack;
    t2.manifest.manifestHash = "0".repeat(64);
    const r2 = planImport(JSON.stringify(t2), none);
    expect(r2.ok).toBe(false);
    expect(r2.fileError).toContain("IMP-03");
  });
  it("bad format/version/size/count and non-JSON are file errors", () => {
    expect(planImport("nope", none).fileError).toContain("JSON");
    expect(planImport(JSON.stringify({ format: "x" }), none).ok).toBe(false);
    const p = JSON.parse(text(pack([q(1)]))) as Pack;
    expect(planImport(JSON.stringify({ ...p, formatVersion: 99 }), none).ok).toBe(false);
    expect(planImport(text(pack([q(1)])), none, { textSize: 21 * 1024 * 1024 }).fileError).toContain("20MB");
    const big = { ...p, items: Array.from({ length: 20001 }, () => p.items[0]) };
    expect(planImport(JSON.stringify(big), none).fileError).toContain("20,000");
  });
  it("HTML, scripts, URLs, control characters, oversize payloads and bad readings are rejected", () => {
    const bad = [
      vocab(1, { meaningKo: "<img src=x onerror=alert(1)>" }),
      vocab(2, { meaningKo: "<script>steal()</script>" }),
      vocab(3, { meaningKo: "자세히: https://evil.example/x" }),
      vocab(4, { meaningKo: "a\u0001b" }),
      vocab(5, { meaningKo: "가".repeat(31000) }),
      vocab(6, { reading: "ご い" }),
      vocab(7, { reading: "語彙" }),
    ];
    const r = planImport(text(pack(bad)), none);
    expect(r.toWrite.length).toBe(0);
    expect(r.summary.byReason.UNSAFE).toBe(5);
    expect(r.summary.byReason.READING_CHARS).toBe(2);
  });
  it("question rules: wrong choices need distinct reasons and the correct one must have none", () => {
    const a = q(1); (a.payload.choices as any[])[1].whyWrong = "";
    const b = q(2); (b.payload.choices as any[])[0].whyWrong = "x";
    const c = q(3); (c.payload.choices as any[])[1].whyWrong = (c.payload.choices as any[])[2].whyWrong;
    const items = [a, b, c].map((x) => ({ ...x, contentHash: computeContentHash(x) }) as ContentRecord);
    const r = planImport(text(pack(items)), none);
    expect(r.summary.byReason.QUESTION_RULE).toBe(3);
  });
  it("missing references are held, not written", () => {
    const orphan = q(1, { stimulusId: "pass:doesnotexist" });
    const passage = buildRecord({ kind: "PASSAGE", level: "N3", pool: "LEARN", tags: [], payload: { type: "SHORT", pages: ["短い文章です。"], questionIds: ["q:ghost"] }, provenance: prov, verification: ver("PASSAGE") });
    const r = planImport(text(pack([orphan, passage])), none);
    expect(r.summary.held).toBe(2);
    expect(r.toWrite.length).toBe(0);
    const okPassage = buildRecord({ kind: "PASSAGE", level: "N3", pool: "LEARN", tags: [], payload: { type: "SHORT", pages: ["別の短い文章です。"], questionIds: [] }, provenance: prov, verification: ver("PASSAGE") });
    const child = q(2, { stimulusId: okPassage.contentId });
    const good = planImport(text(pack([okPassage, child])), none);
    expect(good.summary.added).toBe(2);
    const alreadyThere = planImport(text(pack([child])), ex([okPassage]));
    expect(alreadyThere.summary.added).toBe(1);
  });
});

describe("TST-IMPORT verification claims and isolation", () => {
  it("claims without proof are demoted to UNVERIFIED (kept, not deleted)", () => {
    const same = q(1, { verification: ver("QUESTION", { verifierModel: "claude-sonnet-5-5" }) });
    const missing = q(2, { verification: ver("QUESTION", { checks: [{ id: "SCHEMA_LINT", result: "PASS" }] }) });
    const failed = q(3, { verification: ver("QUESTION", { checks: [...checks("QUESTION").slice(0, 3), { id: "QUALITY_CHECK", result: "WARN" }] }) });
    const endOnly = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { domain: "GRAMMAR_FORM", stem: "これを（　　）。", choices: ["食べる", "食べた", "食べて", "食べない"].map((t, i) => i === 0 ? { id: "a", text: t } : { id: "abcd"[i]!, text: t, whyWrong: `理由${i}`, howToCorrect: `直し方${i}` }), correctChoiceId: "a", explanationKo: "x", scoringSection: "LANGUAGE_KNOWLEDGE" }, provenance: prov, verification: ver("QUESTION") });
    const r = planImport(text(pack([same, missing, failed, endOnly])), none);
    expect(r.summary).toMatchObject({ added: 4, demoted: 4, rejected: 0 });
    expect(r.toWrite.every((x) => x.verification.status === "UNVERIFIED")).toBe(true);
    // not studied by default; studied only when the toggle is on
    const none2 = flagProjection([]);
    expect(studyPool(r.toWrite, none2, false).length).toBe(0);
    expect(studyPool(r.toWrite, none2, true).length).toBe(4);
  });
  it("ASSESS items that collide with already-studied content are rejected", () => {
    const learned = q(1);
    const assess = buildRecord({ kind: "QUESTION", level: "N3", pool: "ASSESS", tags: [], payload: learned.payload, provenance: prov, verification: ver("QUESTION") });
    const r = planImport(text(pack([assess])), ex([learned], { exposed: new Set([learned.contentId]) }));
    expect(r.outcomes[0]).toMatchObject({ action: "REJECT", reason: "ASSESS_ISOLATION" });
    const fresh = planImport(text(pack([buildRecord({ kind: "QUESTION", level: "N3", pool: "ASSESS", tags: [], payload: q(9).payload, provenance: prov, verification: ver("QUESTION") })])), ex([learned], { exposed: new Set([learned.contentId]) }));
    expect(fresh.summary.added).toBe(1);
  });
});

describe("flags and status projection", () => {
  it("a flagged item leaves the pool at once; the first flag wins", () => {
    const a = q(1), b = q(2);
    const ev = (id: string, reason: string, n: number) => createEvent({ profileId: "p", deviceId: "d", deviceSeq: n, type: "CONTENT_FLAGGED", entityId: id, payload: { contentId: id, reason, contentVersion: 1, contentHash: "h" } });
    const fp = flagProjection([ev(a.contentId, "정답 오류", 1), ev(a.contentId, "기타", 2)]);
    expect(fp.flagged.get(a.contentId)!.reason).toBe("정답 오류");
    expect(effectiveStatus(a, fp)).toBe("FLAGGED");
    expect(studyPool([a, b], fp, true).map((x) => x.contentId)).toEqual([b.contentId]);
  });
});

describe("5,000-item import", () => {
  it("plans quickly and the result is idempotent", () => {
    const items = Array.from({ length: 5000 }, (_, i) => vocab(i, { surface: `語彙${i}`, reading: "ごい", meaningKo: `뜻${i}` }));
    const t0 = Date.now();
    const r = planImport(text(pack(items)), none);
    expect(r.summary.added).toBe(5000);
    expect(Date.now() - t0).toBeLessThan(10000);
    const again = planImport(text(pack(items)), ex(r.toWrite));
    expect(again.summary.duplicates).toBe(5000);
    void makeContentId;
  }, 30000);
});
