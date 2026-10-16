import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { cardItemId, cardQuestion, directionsFor, parseCardItemId, vocabCards } from "../../app/src/domain/cards";
import { QuizSession } from "../../app/src/domain/quiz";
import { seedRecords } from "../../app/src/content/seed";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import { loadModel } from "../../app/src/state";
import { AppStorage } from "../../app/src/storage/session";
import { DEFAULT_SETTINGS } from "../../app/src/domain/settings";
import { createEvent } from "../../app/src/storage/events";
import { REVIEW_LIMIT_MINUTES } from "../../app/src/domain/srs";

const vocabSeed = seedRecords().filter((r) => r.kind === "VOCAB");
const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = { status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: ["SCHEMA_LINT", "QUALITY_CHECK"].map((id) => ({ id, result: "PASS" as const })) };
const mkVocab = (n: number): ContentRecord => buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { surface: `単語${n}`, reading: `たんご${"あいうえおかきくけこ"[n % 10]}${"ぁぃぅぇぉ"[Math.floor(n / 10) % 5]}${n}`, pos: "noun", meaningKo: `단어 뜻 ${n}`, example: { ja: `これは単語${n}の例文です。`, ko: "예문" }, levelEstimate: "N3", miscTags: [] }, provenance: prov, verification: ver });

describe("card questions (real seed vocabulary)", () => {
  it("the seed has enough words and every direction yields a valid 4-choice item with reasons for the wrong ones", () => {
    expect(vocabSeed.length).toBeGreaterThanOrEqual(4);
    let n = 0;
    for (const r of vocabSeed) for (const d of directionsFor(r, vocabSeed)) {
      const q = cardQuestion(r, d, vocabSeed, "2026-10-16")!;
      expect(q, `${r.contentId} ${d}`).toBeTruthy();
      expect(() => new QuizSession([q])).not.toThrow(); // exactly 4 choices, exactly one correct
      const texts = q.choices.map((c) => c.text);
      expect(new Set(texts).size).toBe(4);
      const wrong = q.choices.filter((c) => c.id !== q.correctChoiceId);
      expect(wrong.every((c) => c.whyWrong && c.howToCorrect)).toBe(true);
      expect(new Set(wrong.map((c) => c.whyWrong)).size).toBe(3);
      expect(q.choices.find((c) => c.id === q.correctChoiceId)!.whyWrong).toBeUndefined();
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(16);
  });
  it("READING asks for the reading, MEANING for the meaning, CLOZE blanks the word", () => {
    const r = vocabSeed[0]!; const p = r.payload as any;
    expect(cardQuestion(r, "READING", vocabSeed, "d")!.choices.find((c) => c.id === "a")!.text).toBe(p.reading);
    expect(cardQuestion(r, "MEANING", vocabSeed, "d")!.choices.find((c) => c.id === "a")!.text).toBe(p.meaningKo);
    const cl = directionsFor(r, vocabSeed).includes("CLOZE") ? cardQuestion(r, "CLOZE", vocabSeed, "d")! : null;
    if (cl) { expect(cl.stem).toContain("（　　）"); expect(cl.stem).not.toContain(p.surface); expect(cl.choices.find((c) => c.id === "a")!.text).toBe(p.surface); }
  });
  it("deterministic for the same day, may differ on another day; answer text never duplicated as a distractor", () => {
    const r = vocabSeed[1]!;
    const a = cardQuestion(r, "READING", vocabSeed, "2026-10-16")!, b = cardQuestion(r, "READING", vocabSeed, "2026-10-16")!;
    expect(a).toEqual(b);
    const days = new Set(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"].map((d) => cardQuestion(r, "READING", vocabSeed, d)!.choices.map((c) => c.text).sort().join("|")));
    expect(days.size).toBeGreaterThan(1);
  });
  it("fewer than 4 words -> no cards; a word whose example lacks the surface has no CLOZE", () => {
    expect(directionsFor(vocabSeed[0]!, vocabSeed.slice(0, 3))).toEqual([]);
    expect(cardQuestion(vocabSeed[0]!, "READING", vocabSeed.slice(0, 3), "d")).toBeNull();
    const odd = buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { ...(vocabSeed[0]!.payload as object), example: { ja: "全然違う文です。", ko: "x" } }, provenance: prov, verification: ver });
    expect(directionsFor(odd, [odd, ...vocabSeed.slice(1, 5)])).toEqual(["READING", "MEANING"]);
  });
  it("item ids round trip", () => {
    expect(parseCardItemId(cardItemId("vocab:abc", "CLOZE", true))).toEqual({ contentId: "vocab:abc", direction: "CLOZE", retry: true });
    expect(parseCardItemId("q:abc")).toBeNull();
  });
  it("cards are listed per word and direction", () => {
    expect(vocabCards(vocabSeed, new Map()).length).toBe(vocabSeed.reduce((a, r) => a + directionsFor(r, vocabSeed).length, 0));
  });
});

describe("review state from events (AppModel)", () => {
  async function world(nWords: number) {
    const st = await AppStorage.init(new IDBFactory());
    await st.store.putContent(Array.from({ length: nWords }, (_, i) => mkVocab(i)));
    return st;
  }
  const now = new Date("2026-10-16T03:00:00Z"); // 12:00 in Seoul
  const diagDone = async (st: AppStorage) => { await st.record("ROUTE_CHANGED", "route", { route: "TARGET_FOCUS" }); }; // route itself is derived from the diagnostic answers; see below
  void diagDone;
  async function completeDiagnostic(st: AppStorage) {
    const { buildDiagnostic } = await import("../../app/src/domain/diagnostic");
    for (const it of buildDiagnostic(seedRecords())) await st.record("QUESTION_SUBMITTED", it.record.contentId, { contentId: it.record.contentId, selectedChoiceId: "a", isCorrect: true, exposureType: "DIAGNOSTIC" });
  }
  const reviewed = (st: AppStorage, key: { contentId: string; direction: string }, correct: boolean, day: string, extra: object = {}) => st.record("CARD_REVIEWED", key.contentId, { ...key, correct, dayKey: day, ...extra });

  it("new cards appear after the diagnostic with the route's daily cap; before it none are introduced", async () => {
    const st = await world(30);
    const before = await loadModel(st, DEFAULT_SETTINGS, now);
    expect(before.review.session.length).toBe(0); // no route yet -> cap 0, nothing is due
    await completeDiagnostic(st);
    const m = await loadModel(st, DEFAULT_SETTINGS, now);
    expect(m.diag.routing.route).toBe("TARGET_FOCUS");
    expect(m.review.newAllowed).toBe(15);
    expect(m.review.session.length).toBe(15);
    expect(m.plan!.allocation.VOCAB).toBeGreaterThan(0);
  });
  it("the day's new-card cap counts cards already started today", async () => {
    const st = await world(30); await completeDiagnostic(st);
    const m0 = await loadModel(st, DEFAULT_SETTINGS, now);
    for (const c of m0.review.session.slice(0, 6)) await reviewed(st, c, true, m0.today);
    const m1 = await loadModel(st, DEFAULT_SETTINGS, now);
    expect(m1.newToday).toBe(6);
    expect(m1.review.session.filter((c) => c.reviews === 0).length).toBe(9);
  });
  it("more than 25 expected review minutes -> 0 new cards (TST: 하루 25분 초과)", async () => {
    const st = await world(60); await completeDiagnostic(st);
    const m0 = await loadModel(st, DEFAULT_SETTINGS, now);
    const all = m0.cards; // 60 words x (READING, MEANING, CLOZE)
    expect(all.length).toBeGreaterThanOrEqual(150);
    // answer 62 cards correctly 2 days ago -> all due today with the default 25 s each (62 x 25 s = 25.8 min)
    for (const c of all.slice(0, 62)) await reviewed(st, c, true, "2026-10-14"); // stage 1, due 10-15 -> due
    const m = await loadModel(st, DEFAULT_SETTINGS, now);
    expect(m.review.due.length).toBe(62);
    expect(m.review.expectedDueMinutes).toBeGreaterThan(REVIEW_LIMIT_MINUTES);
    expect(m.review.newAllowed).toBe(0);
    expect(m.review.session.every((c) => c.reviews > 0)).toBe(true);
    expect(m.review.reason).toContain("새 항목을 추가하지 않습니다");
    // with only 40 due the same day new cards are allowed again
    const st2 = await world(60); await completeDiagnostic(st2);
    for (const c of (await loadModel(st2, DEFAULT_SETTINGS, now)).cards.slice(0, 40)) await reviewed(st2, c, true, "2026-10-14");
    const m2 = await loadModel(st2, DEFAULT_SETTINGS, now);
    expect(m2.review.newAllowed).toBe(15);
  });
  it("state is restored from events alone (a second device replays the same log)", async () => {
    const a = await world(10); await completeDiagnostic(a);
    const m0 = await loadModel(a, DEFAULT_SETTINGS, now);
    const c = m0.review.session.slice(0, 5);
    await reviewed(a, c[0]!, true, "2026-10-10"); await reviewed(a, c[0]!, true, "2026-10-11");
    await reviewed(a, c[1]!, false, "2026-10-15"); await reviewed(a, c[1]!, true, "2026-10-15", { retry: true });
    const mA = await loadModel(a, DEFAULT_SETTINGS, now);
    const b = await AppStorage.init(new IDBFactory());
    await b.store.putContent(Array.from({ length: 10 }, (_, i) => mkVocab(i)));
    for (const s of await a.store.listEvents()) await b.store.appendEvent(s.event, "SYNCED");
    const mB = await loadModel(b, DEFAULT_SETTINGS, now);
    expect(mB.cards).toEqual(mA.cards);
    const s0 = mA.cards.find((x) => x.key === c[0]!.key)!;
    expect(s0).toMatchObject({ stage: 2, dueAt: "2026-10-14" });
    const s1 = mA.cards.find((x) => x.key === c[1]!.key)!;
    expect(s1).toMatchObject({ stage: 1, lastAnswerWrong: false, dueAt: "2026-10-16" });
    expect(s1.recent).toEqual([false, true]);
  });
  it("stage distribution counts words by their weakest direction", async () => {
    const st = await world(8); await completeDiagnostic(st);
    const m0 = await loadModel(st, DEFAULT_SETTINGS, now);
    const w = m0.vocab[0]!;
    for (const d of ["READING", "MEANING"]) await reviewed(st, { contentId: w.contentId, direction: d }, true, "2026-10-10");
    await reviewed(st, { contentId: w.contentId, direction: "READING" }, true, "2026-10-11");
    const m = await loadModel(st, DEFAULT_SETTINGS, now);
    expect(m.vocabStages.filter((s) => s > 0).length).toBe(1);
    expect(m.vocabStages[0]).toBe(1); // READING is stage 2, MEANING stage 1 -> the word shows stage 1
  });
  void createEvent;
});
