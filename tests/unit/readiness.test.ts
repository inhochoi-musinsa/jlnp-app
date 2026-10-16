import { describe, expect, it } from "vitest";
import { computeReadiness, sectionLines, wilson, MIN_SAMPLE, WILSON_MIN_SAMPLE, EVIDENCE_LABEL, WEAK_NOTE, EXCLUDED_LABEL } from "../../app/src/domain/readiness";
import { assessmentSet } from "../../app/src/domain/assessment";
import { dailyMinutes } from "../../app/src/domain/report";
import { createEvent, type SyncEvent } from "../../app/src/storage/events";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import { audioKeyFor } from "../../shared/audio";

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (q: boolean) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (q ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });
const NOW = new Date("2026-11-20T03:00:00Z");

const q = (n: number, o: { pool?: "LEARN" | "ASSESS"; domain?: string; section?: string; stimulusId?: string } = {}): ContentRecord => buildRecord({ kind: "QUESTION", level: "N3", pool: o.pool ?? "ASSESS", tags: [],
  payload: { domain: o.domain ?? "GRAMMAR_FORM", stem: `問題${n}番：昨日は雨が降っていたので、約束を（　　）ことにした。`, choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `正${n}` } : { id, text: `誤${id}${n}`, whyWrong: `w${id}${n}`, howToCorrect: `h${id}${n}` }), correctChoiceId: "a", explanationKo: `x${n}`, scoringSection: o.section ?? "LANGUAGE_KNOWLEDGE", ...(o.stimulusId ? { stimulusId: o.stimulusId } : {}) }, provenance: prov, verification: ver(true) });
let seq = 0;
const sub = (r: ContentRecord, correct: boolean, o: { day?: string; exposure?: string; audio?: { source: string; plays: number }; ms?: number } = {}): SyncEvent =>
  createEvent({ profileId: "p", deviceId: "d", deviceSeq: ++seq, type: "QUESTION_SUBMITTED", entityId: r.contentId, now: new Date(o.day ?? "2026-11-19T01:00:00Z"), payload: { contentId: r.contentId, isCorrect: correct, exposureType: o.exposure ?? "ASSESSMENT", elapsedActiveMs: o.ms ?? 30000, stimulusId: r.payload.stimulusId ?? null, ...(o.audio ? { audioSource: o.audio.source, plays: o.audio.plays } : {}) } });
const pres = (r: ContentRecord, exposure = "PRACTICE") => createEvent({ profileId: "p", deviceId: "d", deviceSeq: ++seq, type: "QUESTION_PRESENTED", entityId: r.contentId, now: new Date("2026-11-10T01:00:00Z"), payload: { contentId: r.contentId, exposureType: exposure, stimulusId: r.payload.stimulusId ?? null } });
const revealed = (r: ContentRecord) => createEvent({ profileId: "p", deviceId: "d", deviceSeq: ++seq, type: "ANSWER_REVEALED", entityId: r.contentId, now: new Date("2026-11-10T01:00:00Z"), payload: { contentId: r.contentId } });
const index = (rs: ContentRecord[]) => new Map(rs.map((r) => [r.contentId, r]));
const lk = (rs: ContentRecord[], evs: SyncEvent[]) => computeReadiness(evs, index(rs), "N3", NOW).sections.find((s) => s.id === "LANGUAGE_KNOWLEDGE")!;

describe("TST-READINESS-01 sample-size branches (0 / 5 / 20 / 30)", () => {
  const qs = Array.from({ length: 30 }, (_, i) => q(i));
  const run = (n: number, wrong = 0) => lk(qs, qs.slice(0, n).map((r, i) => sub(r, i >= wrong)));
  it("n=0: nothing measured", () => {
    const r = computeReadiness([], index(qs), "N3", NOW);
    expect(r.overall).toBe("NONE");
    expect(lk(qs, []).evidence).toBe("NONE");
    expect(sectionLines(lk(qs, []))).toEqual(["아직 평가 문항을 풀지 않았습니다."]);
  });
  it("n=5: 자료 부족, k/n shown, no interval", () => {
    const s = run(5, 1);
    expect(s).toMatchObject({ n: 5, k: 4, evidence: "INSUFFICIENT", interval: null });
    expect(sectionLines(s).join("\n")).toContain("자료 부족");
  });
  it("n=20: observed, still no interval", () => {
    const s = run(MIN_SAMPLE, 4);
    expect(s).toMatchObject({ n: 20, k: 16, evidence: "OBSERVED", interval: null });
  });
  it("n=30: observed with a Wilson reference interval labelled as the app's own sample", () => {
    const s = run(WILSON_MIN_SAMPLE, 6);
    expect(s.interval).not.toBeNull();
    expect(s.interval!.lo).toBeLessThan(0.8); expect(s.interval!.hi).toBeGreaterThan(0.8);
    expect(sectionLines(s).join("\n")).toContain("실제 JLPT 합격점에 대한 구간이 아닙니다");
  });
  it("wilson is sane at the edges", () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
    expect(wilson(30, 30).hi).toBe(1);
    expect(wilson(0, 30).lo).toBe(0);
  });
});

describe("validity rules", () => {
  it("a learning-pool question can never count, and a question seen in learning before the assessment is excluded", () => {
    const learn = q(1, { pool: "LEARN" }), seen = q(2), fresh = q(3);
    const evs = [sub(learn, true), pres(seen), sub(seen, true), sub(fresh, true)];
    const r = computeReadiness(evs, index([learn, seen, fresh]), "N3", NOW);
    expect(r.sections[0]!.n).toBe(1);
    expect(r.excluded.map((x) => x.reason).sort()).toEqual(["NOT_ASSESS_POOL", "NOT_FIRST_EXPOSURE"]);
  });
  it("a passage already read in learning excludes its questions; a repeat attempt of an assessment question is not first exposure", () => {
    const a = q(4, { domain: "READING_Q", section: "READING", stimulusId: "pas:x" }), b = q(5);
    const learnedPassage = createEvent({ profileId: "p", deviceId: "d", deviceSeq: ++seq, type: "QUESTION_PRESENTED", entityId: "z", now: new Date("2026-11-01T00:00:00Z"), payload: { contentId: "q:other", exposureType: "PRACTICE", stimulusId: "pas:x" } });
    const r = computeReadiness([learnedPassage, sub(a, true), sub(b, true), sub(b, false)], index([a, b]), "N3", NOW);
    expect(r.sections.find((s) => s.id === "READING")!.n).toBe(0);
    const lkS = r.sections.find((s) => s.id === "LANGUAGE_KNOWLEDGE")!;
    expect(lkS).toMatchObject({ n: 1, k: 1 });
  });
  it("an answer revealed before the attempt is excluded; the 28-day window is respected", () => {
    const a = q(6), b = q(7);
    const r = computeReadiness([revealed(a), sub(a, true), sub(b, true, { day: "2026-10-01T00:00:00Z" })], index([a, b]), "N3", NOW);
    expect(r.sections[0]!.n).toBe(0);
    expect(r.excluded.map((x) => x.reason).sort()).toEqual(["ANSWER_SEEN_BEFORE", "OUT_OF_WINDOW"]);
    for (const x of r.excluded) expect(EXCLUDED_LABEL[x.reason]).toBeTruthy();
  });
  it("listening counts only with a played, non-browser audio file; sources are tallied and the TTS badge text exists", () => {
    const l = (n: number) => q(100 + n, { domain: "LISTENING_Q", section: "LISTENING" });
    const [a, b, c, d] = [l(1), l(2), l(3), l(4)];
    const evs = [sub(a, true, { audio: { source: "GENERATED_FILE", plays: 1 } }), sub(b, false, { audio: { source: "RECORDED", plays: 1 } }), sub(c, true, { audio: { source: "BROWSER_TTS", plays: 1 } }), sub(d, true, { audio: { source: "GENERATED_FILE", plays: 0 } })];
    const s = computeReadiness(evs, index([a, b, c, d]), "N3", NOW).sections.find((x) => x.id === "LISTENING")!;
    expect(s).toMatchObject({ n: 2, k: 1 });
    expect(s.sources).toEqual({ GENERATED_FILE: 1, RECORDED: 1 });
  });
  it("two-section levels follow their own scoring sections", () => {
    const r = computeReadiness([], new Map(), "N5", NOW);
    expect(r.sections.map((s) => s.id)).toEqual(["LANGUAGE_KNOWLEDGE_READING", "LISTENING"]);
  });
});

describe("relative weakness (plan.md §9.3)", () => {
  const mk = (id: string, n: number, k: number) => {
    const domain = id === "LISTENING" ? "LISTENING_Q" : id === "READING" ? "READING_Q" : "GRAMMAR_FORM";
    const rs = Array.from({ length: n }, (_, i) => q(1000 + i + (id === "LISTENING" ? 0 : id === "READING" ? 300 : 600), { domain, section: id }));
    return { rs, evs: rs.map((r, i) => sub(r, i < k, id === "LISTENING" ? { audio: { source: "GENERATED_FILE", plays: 1 } } : {})) };
  };
  it("not judged while any section is below the minimum", () => {
    const a = mk("LANGUAGE_KNOWLEDGE", 20, 18), b = mk("READING", 20, 18), c = mk("LISTENING", 5, 1);
    const r = computeReadiness([...a.evs, ...b.evs, ...c.evs], index([...a.rs, ...b.rs, ...c.rs]), "N3", NOW);
    expect(r.overall).toBe("INSUFFICIENT");
    expect(r.sections.every((s) => !s.weak)).toBe(true);
  });
  it("flags a section 0.15 behind the best, or below 0.60", () => {
    const a = mk("LANGUAGE_KNOWLEDGE", 20, 18), b = mk("READING", 20, 17), c = mk("LISTENING", 20, 12);
    const r = computeReadiness([...a.evs, ...b.evs, ...c.evs], index([...a.rs, ...b.rs, ...c.rs]), "N3", NOW);
    expect(r.overall).toBe("OBSERVED");
    expect(r.sections.map((s) => s.weak)).toEqual([false, false, true]);
    expect(WEAK_NOTE).toContain("변환할 수 없습니다");
  });
});

describe("no probability or official-score text is ever generated", () => {
  it("every string the readiness layer can produce is free of probability / predicted-score wording", () => {
    const qs = Array.from({ length: 31 }, (_, i) => q(2000 + i));
    const r = computeReadiness(qs.map((x, i) => sub(x, i % 3 !== 0)), index(qs), "N3", NOW);
    const text = [...r.sections.flatMap((s) => sectionLines(s)), ...Object.values(EVIDENCE_LABEL), WEAK_NOTE, ...Object.values(EXCLUDED_LABEL)].join("\n");
    expect(text).not.toMatch(/합격\s*(확률|가능성\s*\d|률)|예상\s*점수|과락\s*(확률|\d)|\d+\s*점(?!수)/);
    expect(text).not.toMatch(/probabilit|expected score|pass chance/i);
  });
});

describe("assessment sets", () => {
  it("only fresh ASSESS questions; passages stay whole; exposed ones are never offered again; LEARN pool never included", () => {
    const pas = buildRecord({ kind: "PASSAGE", level: "N3", pool: "ASSESS", tags: [], payload: { type: "SHORT", pages: ["短い文章です。町の図書館では毎週読み聞かせ会があります。"], questionIds: [] }, provenance: prov, verification: ver(false) });
    const rq = [1, 2].map((n) => q(300 + n, { domain: "READING_Q", section: "READING", stimulusId: pas.contentId }));
    const learn = q(310, { pool: "LEARN", domain: "READING_Q", section: "READING" });
    const pool = [pas, ...rq];
    const byId = index([...pool, learn]);
    const s = assessmentSet(pool, byId, new Set(), "N3", "READING");
    expect(s.items.map((i) => i.id).sort()).toEqual(rq.map((x) => x.contentId).sort());
    expect(s.items[0]!.passage).toBeTruthy();
    expect(assessmentSet(pool, byId, new Set([pas.contentId]), "N3", "READING").items.length).toBe(0);
    expect(assessmentSet(pool, byId, new Set([rq[0]!.contentId]), "N3", "READING").items.length).toBe(1);
    expect(assessmentSet([learn], byId, new Set(), "N3", "READING").items.length).toBe(0);
  });
  it("a listening assessment item carries its audio reference", () => {
    const segs = [{ speaker: "F" as const, text: "どこへ行きますか。" }];
    const qq = q(400, { domain: "LISTENING_Q", section: "LISTENING" });
    const lis = buildRecord({ kind: "LISTENING", level: "N3", pool: "ASSESS", tags: [], payload: { taskType: "POINT", segments: segs, questionId: qq.contentId, audio: { key: audioKeyFor(segs, "e", "v", 1), source: "GENERATED_FILE", engine: "e", voice: "v", speed: 1 } }, provenance: prov, verification: ver(false) });
    const s = assessmentSet([lis, qq], index([lis, qq]), new Set(), "N3", "LISTENING");
    expect(s.items[0]!.audio?.listeningId).toBe(lis.contentId);
  });
});

describe("study-time series", () => {
  it("28 days, oldest first, minutes from STUDY_INTERVAL_COMPLETED", () => {
    const e = (day: string, seconds: number) => createEvent({ profileId: "p", deviceId: "d", deviceSeq: ++seq, type: "STUDY_INTERVAL_COMPLETED", entityId: "s", payload: { dayKey: day, activity: "STUDY", seconds } });
    const d = dailyMinutes([e("2026-11-20", 600), e("2026-11-20", 660), e("2026-11-01", 120), e("2026-09-01", 9999)], "2026-11-20");
    expect(d.length).toBe(28);
    expect(d[27]).toEqual({ day: "2026-11-20", minutes: 21 });
    expect(d.find((x) => x.day === "2026-11-01")!.minutes).toBe(2);
    expect(d[0]!.day).toBe("2026-10-24");
  });
});
