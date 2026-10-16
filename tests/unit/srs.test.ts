import { describe, expect, it } from "vitest";
import { applyAnswer, buildQueue, isDue, newCard, NEXT_ON_CORRECT, observedSecondsPerCard, replayCards, stageDistribution, weaknessScore, wordStage, cardKey, REVIEW_LIMIT_MINUTES, type CardState, type Stage } from "../../app/src/domain/srs";
import { createEvent } from "../../app/src/storage/events";

const D0 = "2026-10-16";
const card = (stage: Stage, over: Partial<CardState> = {}): CardState => ({ ...newCard("v:1", "READING"), stage, reviews: stage ? 3 : 0, dueAt: stage ? D0 : null, ...over });

describe("TST: transition table, every case", () => {
  const correct: [Stage, Stage, string][] = [[0, 1, "2026-10-17"], [1, 2, "2026-10-19"], [2, 3, "2026-10-23"], [3, 4, "2026-11-06"], [4, 4, "2026-11-06"]];
  it.each(correct)("correct at stage %i -> stage %i, due %s", (from, to, due) => {
    for (const wrongBefore of [false, true]) {
      const n = applyAnswer(card(from, { lastAnswerWrong: wrongBefore }), { correct: true, day: D0 });
      expect(n.stage).toBe(to); expect(n.dueAt).toBe(due); expect(n.lastAnswerWrong).toBe(false);
    }
  });
  const wrong: [Stage, Stage][] = [[0, 1], [1, 1], [2, 1], [3, 2], [4, 3]];
  it.each(wrong)("wrong at stage %i -> stage %i, due next day, flagged", (from, to) => {
    const n = applyAnswer(card(from), { correct: false, day: D0 });
    expect(n.stage).toBe(to); expect(n.dueAt).toBe("2026-10-17"); expect(n.lastAnswerWrong).toBe(true);
  });
  it("the table constant matches the plan (1/3/7/21/21)", () => {
    expect(Object.values(NEXT_ON_CORRECT).map((x) => x.days)).toEqual([1, 3, 7, 21, 21]);
  });
  it("retry in the same session never moves stage or due date", () => {
    const w = applyAnswer(card(3), { correct: false, day: D0 });
    const ok = applyAnswer(w, { correct: true, day: D0, retry: true });
    expect(ok).toMatchObject({ stage: w.stage, dueAt: w.dueAt, lastAnswerWrong: false });
    const bad = applyAnswer(w, { correct: false, day: D0, retry: true });
    expect(bad).toMatchObject({ stage: w.stage, dueAt: w.dueAt, lastAnswerWrong: true });
  });
  it("month and year boundaries are calendar-correct", () => {
    expect(applyAnswer(card(3), { correct: true, day: "2026-12-20" }).dueAt).toBe("2027-01-10");
    expect(applyAnswer(card(0), { correct: true, day: "2028-02-28" }).dueAt).toBe("2028-02-29");
  });
  it("recent history keeps 5 answers", () => {
    let c = card(1);
    for (let i = 0; i < 8; i++) c = applyAnswer(c, { correct: i % 2 === 0, day: D0, retry: true });
    expect(c.recent.length).toBe(5);
  });
});

describe("one review rule: due or last answer wrong", () => {
  it("due when dueAt <= today; not before", () => {
    expect(isDue(card(2, { dueAt: "2026-10-16" }), "2026-10-16")).toBe(true);
    expect(isDue(card(2, { dueAt: "2026-10-15" }), "2026-10-16")).toBe(true);
    expect(isDue(card(2, { dueAt: "2026-10-17" }), "2026-10-16")).toBe(false);
    expect(isDue(newCard("x", "MEANING"), "2026-10-16")).toBe(false);
  });
  it("a wrong card handled today waits until tomorrow; an old wrong card is due", () => {
    const w = applyAnswer(card(2), { correct: false, day: D0 });
    expect(isDue(w, D0)).toBe(false);
    expect(isDue(w, "2026-10-17")).toBe(true);
    expect(isDue(card(2, { dueAt: "2026-12-01", lastAnswerWrong: true, lastReviewedDay: "2026-10-10" }), D0)).toBe(true);
  });
});

describe("weakness score (§6.3)", () => {
  it("recent wrong ratio + 0.25 x overdue ratio", () => {
    const c = card(2, { recent: [true, false, false, true, false], dueAt: "2026-10-10", intervalDays: 7 });
    expect(weaknessScore(c, "2026-10-17")).toBeCloseTo(3 / 5 + 0.25 * 1, 5);
    expect(weaknessScore({ ...c, dueAt: "2026-10-15", intervalDays: 4 }, "2026-10-17")).toBeCloseTo(0.6 + 0.25 * 0.5, 5);
    expect(weaknessScore(newCard("x", "READING"), D0)).toBe(0);
    expect(weaknessScore(card(4, { recent: [true, true, true] }), D0)).toBe(0);
  });
});

describe("queue and the 25-minute rule", () => {
  const mk = (n: number, due: boolean, i0 = 0): CardState[] => Array.from({ length: n }, (_, i) => card(2, { key: `k${i0 + i}`, contentId: `c${i0 + i}`, dueAt: due ? D0 : "2026-12-01" }));
  const fresh = (n: number): CardState[] => Array.from({ length: n }, (_, i) => newCard(`n${i}`, "MEANING"));
  it("due first (weakest first), then new cards up to the cap", () => {
    const due = mk(3, true); due[2] = { ...due[2]!, recent: [false, false, true] };
    const q = buildQueue({ cards: [...fresh(30), ...due], today: D0, dailyNewCap: 10, secondsPerCard: 25, availableMinutes: 60 });
    expect(q.due.map((c) => c.key)[0]).toBe("k2");
    expect(q.session.length).toBe(3 + 10);
    expect(q.session.slice(0, 3).every((c) => c.reviews > 0)).toBe(true);
    expect(q.newAllowed).toBe(10);
  });
  it("expected review time over 25 minutes -> zero new cards", () => {
    const perMin = 60 / 25;
    const n = Math.ceil(REVIEW_LIMIT_MINUTES * perMin) + 1; // 61 cards = 25.4 min
    const q = buildQueue({ cards: [...fresh(30), ...mk(n, true)], today: D0, dailyNewCap: 15, secondsPerCard: 25, availableMinutes: 60 });
    expect(q.expectedDueMinutes).toBeGreaterThan(25);
    expect(q.newAllowed).toBe(0);
    expect(q.session.every((c) => c.reviews > 0)).toBe(true);
    expect(q.reason).toContain("새 항목을 추가하지 않습니다");
    const ok = buildQueue({ cards: [...fresh(30), ...mk(n - 2, true)], today: D0, dailyNewCap: 15, secondsPerCard: 25, availableMinutes: 60 });
    expect(ok.expectedDueMinutes).toBeLessThanOrEqual(25);
    expect(ok.newAllowed).toBe(15);
  });
  it("never exceeds the time budget; already-started new cards count against the cap", () => {
    const q = buildQueue({ cards: [...fresh(30), ...mk(5, true)], today: D0, dailyNewCap: 10, secondsPerCard: 30, availableMinutes: 2 });
    expect(q.session.length).toBe(4); // 2 min / 30 s
    const capped = buildQueue({ cards: fresh(30), today: D0, dailyNewCap: 10, secondsPerCard: 25, availableMinutes: 60, newToday: 7 });
    expect(capped.session.length).toBe(3);
    expect(buildQueue({ cards: fresh(5), today: D0, dailyNewCap: 10, secondsPerCard: 25, availableMinutes: 0 }).session).toEqual([]);
  });
  it("weak list holds cards with a positive score, worst first", () => {
    const a = card(2, { key: "a", recent: [false, false] }), b = card(2, { key: "b", recent: [true, false] }), c = card(2, { key: "c", recent: [true, true] });
    expect(buildQueue({ cards: [a, b, c], today: D0, dailyNewCap: 5, secondsPerCard: 25, availableMinutes: 60 }).weak.map((x) => x.key)).toEqual(["a", "b"]);
  });
});

describe("state is rebuilt from events (replay)", () => {
  const ev = (n: number, p: any, at = n) => createEvent({ profileId: "p", deviceId: "d", deviceSeq: n, type: "CARD_REVIEWED", entityId: p.contentId, payload: p, now: new Date(Date.UTC(2026, 9, 16, 0, 0, at)), eventId: `e${n}` });
  it("replay equals applying the answers one by one, in any input order", () => {
    const evs = [ev(1, { contentId: "v:1", direction: "READING", correct: true, dayKey: "2026-10-10" }), ev(2, { contentId: "v:1", direction: "READING", correct: true, dayKey: "2026-10-11" }), ev(3, { contentId: "v:1", direction: "READING", correct: false, dayKey: "2026-10-14" }), ev(4, { contentId: "v:1", direction: "MEANING", correct: true, dayKey: "2026-10-12" })];
    const manual = applyAnswer(applyAnswer(applyAnswer(newCard("v:1", "READING"), { correct: true, day: "2026-10-10" }), { correct: true, day: "2026-10-11" }), { correct: false, day: "2026-10-14" });
    const a = replayCards(evs), b = replayCards([...evs].reverse());
    expect(a.get(cardKey("v:1", "READING"))).toEqual(manual);
    expect(b).toEqual(a);
    expect(a.get(cardKey("v:1", "MEANING"))!.stage).toBe(1);
    expect(wordStage(a, "v:1", ["READING", "MEANING"])).toBe(manual.stage < 1 ? 0 : (Math.min(manual.stage, 1) as Stage));
    expect(wordStage(a, "v:none", ["READING"])).toBe(0);
  });
  it("observed seconds per card replaces the 25 s default only after enough data", () => {
    const few = Array.from({ length: 4 }, (_, i) => ev(i + 1, { contentId: "c", direction: "READING", correct: true, dayKey: D0, elapsedActiveMs: 40000 }));
    expect(observedSecondsPerCard(few)).toBe(25);
    const many = Array.from({ length: 10 }, (_, i) => ev(i + 1, { contentId: "c", direction: "READING", correct: true, dayKey: D0, elapsedActiveMs: 40000 }));
    expect(observedSecondsPerCard(many)).toBe(40);
    expect(stageDistribution([0, 1, 1, 4])).toEqual({ 0: 1, 1: 2, 2: 0, 3: 0, 4: 1 });
  });
});
