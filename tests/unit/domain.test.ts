import { describe, expect, it } from "vitest";
import { buildDiagnostic, diagnosticState, exposedContentIds, isFreshForAssessment, routeFromScores, type Scores } from "../../app/src/domain/diagnostic";
import { BASE_SPLIT, DOMAINS, makePlan, type PlanDomain } from "../../app/src/domain/planner";
import { ActiveTimer } from "../../app/src/domain/activity";
import { projectExamTarget } from "../../app/src/domain/target";
import { createEvent } from "../../app/src/storage/events";
import { seedRecords } from "../../app/src/content/seed";
import { toQuizItem, indexRecords } from "../../app/src/domain/content";
import { question } from "../fixtures/records";
import { buildRecord } from "../../shared/schema";

const sc = (k: number, f: number, kAns = 8, fAns = 8): Scores => ({
  KANA: { answered: kAns, correct: k, total: 8 }, FOUNDATION: { answered: fAns, correct: f, total: 8 },
  TARGET_LANGUAGE: { answered: 6, correct: 3, total: 6 }, TARGET_READING: { answered: 6, correct: 3, total: 6 },
});

describe("TST-DIAG-01 routing", () => {
  it("kana <= 6/8 -> KANA_FOUNDATION", () => { for (const k of [0, 3, 6]) expect(routeFromScores(sc(k, 8)).route).toBe("KANA_FOUNDATION"); });
  it("kana passes but foundation <= 5/8 -> FOUNDATION", () => { for (const f of [0, 4, 5]) expect(routeFromScores(sc(7, f)).route).toBe("FOUNDATION"); expect(routeFromScores(sc(8, 5)).route).toBe("FOUNDATION"); });
  it("both above the cutoffs -> TARGET_FOCUS", () => { expect(routeFromScores(sc(7, 6)).route).toBe("TARGET_FOCUS"); expect(routeFromScores(sc(8, 8)).route).toBe("TARGET_FOCUS"); });
  it("incomplete kana/foundation -> PROVISIONAL", () => {
    expect(routeFromScores(sc(8, 8, 7, 8)).route).toBe("PROVISIONAL");
    expect(routeFromScores(sc(8, 8, 8, 0)).route).toBe("PROVISIONAL");
  });
  it("borderline flags and listening is always NOT_MEASURED", () => {
    expect(routeFromScores(sc(7, 8)).borderline).toBe(true);
    expect(routeFromScores(sc(8, 6)).borderline).toBe(true);
    expect(routeFromScores(sc(8, 8)).borderline).toBe(false);
    for (const k of [0, 8]) expect(routeFromScores(sc(k, 8)).listeningEvidence).toBe("NOT_MEASURED");
  });
});

describe("seed diagnostic", () => {
  const items = buildDiagnostic(seedRecords());
  it("has the plan's 28 questions in group order (8/8/6/6)", () => {
    expect(items.length).toBe(28);
    const g = items.map((i) => i.group);
    expect(g.filter((x) => x === "KANA").length).toBe(8);
    expect(g.filter((x) => x === "FOUNDATION").length).toBe(8);
    expect(g.filter((x) => x === "TARGET_LANGUAGE").length).toBe(6);
    expect(g.filter((x) => x === "TARGET_READING").length).toBe(6);
    expect(g.indexOf("FOUNDATION")).toBeGreaterThan(g.lastIndexOf("KANA") - 1);
  });
  it("reading questions carry their passage and share a stimulusId", () => {
    const byId = indexRecords(seedRecords());
    const reading = items.filter((i) => i.group === "TARGET_READING");
    const stim = new Set(reading.map((r) => r.record.payload.stimulusId));
    expect(stim.size).toBe(2);
    const qi = toQuizItem(reading[0]!.record, byId);
    expect(qi.stem.length).toBeGreaterThan(String(reading[0]!.record.payload.stem).length);
    expect(qi.stimulusId).toBeTruthy();
  });
});

const submit = (n: number, contentId: string, correct: boolean, exposureType = "DIAGNOSTIC", eventId = `s-${n}`) =>
  createEvent({ profileId: "p", deviceId: "d", deviceSeq: n, type: "QUESTION_SUBMITTED", entityId: contentId, eventId, now: new Date(Date.UTC(2026, 9, 16, 0, 0, n)), payload: { contentId, selectedChoiceId: "a", isCorrect: correct, exposureType, elapsedActiveMs: 1000 } });

describe("TST-DIAG-02 resume / no second submit / no re-entry", () => {
  const items = buildDiagnostic(seedRecords());
  it("answered items are excluded on resume; the first submission wins", () => {
    const e = [submit(1, items[0]!.record.contentId, true), submit(2, items[0]!.record.contentId, false), submit(3, items[1]!.record.contentId, false)];
    const st = diagnosticState(items, e);
    expect(st.answered).toBe(2);
    expect(st.remaining.length).toBe(26);
    expect(st.scores.KANA).toMatchObject({ answered: 2, correct: 1 });
    expect(st.completed).toBe(false);
  });
  it("replaying the same events twice gives the same state (idempotent)", () => {
    const e = items.slice(0, 5).map((it, i) => submit(i + 1, it.record.contentId, i % 2 === 0));
    expect(diagnosticState(items, [...e, ...e]).answered).toBe(5);
  });
  it("all 28 answered -> completed with a route", () => {
    const e = items.map((it, i) => submit(i + 1, it.record.contentId, true));
    const st = diagnosticState(items, e);
    expect(st.completed).toBe(true);
    expect(st.routing.route).toBe("TARGET_FOCUS");
  });
  it("exposed items (and their passages) can never be fresh assessment items", () => {
    const q = question();
    const ass = buildRecord({ kind: "QUESTION", level: "N3", pool: "ASSESS", tags: [], payload: { ...q.payload, stimulusId: "pass:xyz" }, provenance: q.provenance, verification: q.verification });
    expect(isFreshForAssessment(ass, new Set())).toBe(true);
    expect(isFreshForAssessment(ass, new Set([ass.contentId]))).toBe(false);
    expect(isFreshForAssessment(ass, new Set(["pass:xyz"]))).toBe(false);
    const ev = [createEvent({ profileId: "p", deviceId: "d", deviceSeq: 1, type: "QUESTION_PRESENTED", entityId: "x", payload: { contentId: ass.contentId, exposureType: "DIAGNOSTIC" } })];
    expect(exposedContentIds(ev).has(ass.contentId)).toBe(true);
    expect(isFreshForAssessment(question(), new Set())).toBe(false); // LEARN pool is never an assessment item
  });
});

const all = (v: boolean): Record<PlanDomain, boolean> => ({ KANA: v, VOCAB: v, GRAMMAR: v, READING: v, LISTENING: v });
describe("TST-PLAN-01 60-minute plan", () => {
  it("every route sums to <= 60 and to exactly 60 when all content exists", () => {
    for (const route of Object.keys(BASE_SPLIT) as (keyof typeof BASE_SPLIT)[]) {
      const p = makePlan({ route, activeSecondsToday: 0, available: all(true) });
      expect(p.totalMinutes).toBe(60);
      expect(DOMAINS.every((d) => p.allocation[d] === BASE_SPLIT[route][d])).toBe(true);
      expect(p.excluded).toEqual([]);
    }
  });
  it("studied time is deducted (diagnostic included) and never goes negative", () => {
    expect(makePlan({ route: "TARGET_FOCUS", activeSecondsToday: 20 * 60, available: all(true) }).totalMinutes).toBe(40);
    expect(makePlan({ route: "TARGET_FOCUS", activeSecondsToday: 59 * 60 + 30, available: all(true) }).availableMinutes).toBe(0);
    expect(makePlan({ route: "TARGET_FOCUS", activeSecondsToday: 99999, available: all(true) }).totalMinutes).toBe(0);
  });
  it("listening without content is excluded and its minutes are redistributed, not counted as done", () => {
    const av = { ...all(true), LISTENING: false };
    const p = makePlan({ route: "TARGET_FOCUS", activeSecondsToday: 0, available: av });
    expect(p.allocation.LISTENING).toBe(0);
    expect(p.excluded).toContain("LISTENING");
    expect(p.totalMinutes).toBe(60);
    expect(p.allocation.VOCAB + p.allocation.GRAMMAR + p.allocation.READING).toBe(60);
  });
  it("content capacity caps the plan; less than 60 is allowed and flagged", () => {
    const p = makePlan({ route: "TARGET_FOCUS", activeSecondsToday: 0, available: { ...all(false), VOCAB: true, GRAMMAR: true }, capacityMinutes: { VOCAB: 4, GRAMMAR: 3 } });
    expect(p.allocation.VOCAB).toBe(4);
    expect(p.allocation.GRAMMAR).toBe(3);
    expect(p.totalMinutes).toBe(7);
    expect(p.underfilled).toBe(true);
  });
  it("no negative minutes, deterministic, integer", () => {
    for (let s = 0; s <= 3600; s += 137) for (const route of Object.keys(BASE_SPLIT) as (keyof typeof BASE_SPLIT)[]) {
      const a = makePlan({ route, activeSecondsToday: s, available: { ...all(true), LISTENING: s % 2 === 0 } });
      const b = makePlan({ route, activeSecondsToday: s, available: { ...all(true), LISTENING: s % 2 === 0 } });
      expect(a).toEqual(b);
      expect(DOMAINS.every((d) => Number.isInteger(a.allocation[d]) && a.allocation[d] >= 0)).toBe(true);
      expect(a.totalMinutes).toBeLessThanOrEqual(a.availableMinutes);
    }
  });
});

describe("ActiveTimer", () => {
  it("counts only while touched, visible and not idle", () => {
    const t = new ActiveTimer(60000);
    t.touch(0);
    expect(t.elapsed(30000)).toBe(30000);
    expect(t.elapsed(200000)).toBe(60000); // idle after 60s without input
    t.touch(200000);
    t.pause(210000); // tab hidden
    expect(t.elapsed(500000)).toBe(70000);
    expect(t.take(500000)).toBe(70000);
    expect(t.elapsed(600000)).toBe(0);
  });
});

describe("exam target projection (no data deleted by a change)", () => {
  const ev = (n: number, type: any, payload: unknown) => createEvent({ profileId: "p", deviceId: "d", deviceSeq: n, type, entityId: "exam", payload, now: new Date(Date.UTC(2026, 9, 16, 0, 0, n)) });
  it("latest selection wins; an official date attaches only to its own session", () => {
    const events = [ev(1, "EXAM_TARGET_SELECTED", { level: "N3", year: 2027, month: 7 }), ev(2, "EXAM_NOTICE_VERIFIED", { year: 2027, month: 7, confirmedExamDate: "2027-07-04", sourceUrl: "https://www.jlpt.or.kr/" }), ev(3, "EXAM_TARGET_SELECTED", { level: "N3", year: 2027, month: 12 })];
    expect(projectExamTarget(events.slice(0, 2), "N3")).toMatchObject({ dateStatus: "CONFIRMED", confirmedExamDate: "2027-07-04" });
    const last = projectExamTarget(events, "N3");
    expect(last).toMatchObject({ targetYear: 2027, targetMonth: 12, expectedExamDate: "2027-12-05", dateStatus: "EXPECTED", confirmedExamDate: null });
    expect(projectExamTarget([], "N3").dateStatus).toBe("NOT_SELECTED");
  });
});
