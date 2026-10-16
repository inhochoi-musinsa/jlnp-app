import { describe, expect, it } from "vitest";
import { kanaMistakes, kanaPairs, kanaQuestion, kanaSession, parseKanaItemId, kanaItemId } from "../../app/src/domain/kana";
import { allCards, cardQuestion, directionsFor, linkedQuestions } from "../../app/src/domain/cards";
import { QuizSession } from "../../app/src/domain/quiz";
import { buildRecord, validateContentRecord, type ContentRecord } from "../../shared/schema";
import { lintRecord, endingOnlySolvable } from "../../shared/lint";
import { createEvent } from "../../app/src/storage/events";
import { seedRecords } from "../../app/src/content/seed";

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });
const kana = (a: string, b: string, ra: string, rb: string, note = "점의 방향과 획 순서가 다릅니다."): ContentRecord => buildRecord({ kind: "KANA", level: "N5", pool: "LEARN", tags: [], payload: { chars: [a, b], readings: { [a]: ra, [b]: rb }, confusionNoteKo: note }, provenance: prov, verification: ver("KANA") });
const PAIRS = [kana("シ", "ツ", "시", "츠"), kana("ソ", "ン", "소", "응"), kana("ぬ", "め", "누", "메"), kana("ね", "れ", "네", "레")];

describe("confusion-letter quiz (domain)", () => {
  it("both forms give a valid 4-choice question; every wrong choice has its own reason and the fix", () => {
    for (const r of PAIRS) for (const mode of ["READ", "CHOOSE"] as const) {
      const q = kanaQuestion(r, mode, PAIRS, "2026-10-16")!;
      expect(q).toBeTruthy();
      expect(() => new QuizSession([q])).not.toThrow();
      expect(new Set(q.choices.map((c) => c.text)).size).toBe(4);
      const wrong = q.choices.filter((c) => c.id !== q.correctChoiceId);
      expect(wrong.every((c) => c.whyWrong && c.howToCorrect)).toBe(true);
      expect(new Set(wrong.map((c) => c.whyWrong)).size).toBe(3);
      expect(q.refId).toBe(r.contentId);
    }
    const p = PAIRS[0]!;
    const read = kanaQuestion(p, "READ", PAIRS, "d")!;
    expect(read.choices.map((c) => c.text)).toEqual(expect.arrayContaining(["시", "츠"])); // the look-alike's reading is always offered
    expect(read.choices.find((c) => c.id === "b")!.whyWrong).toContain("츠");
    const choose = kanaQuestion(p, "CHOOSE", PAIRS, "d")!;
    expect(choose.choices.map((c) => c.text)).toEqual(expect.arrayContaining(["シ", "ツ"]));
  });
  it("needs at least two usable pairs; unusable records are ignored", () => {
    expect(kanaQuestion(PAIRS[0]!, "READ", [PAIRS[0]!], "d")).toBeNull();
    const same = kana("あ", "ア", "아", "아");
    expect(kanaPairs([same, ...PAIRS]).length).toBe(4);
    expect(kanaSession([PAIRS[0]!], [], "d")).toEqual([]);
  });
  it("sessions are deterministic per day and favour pairs that were missed", () => {
    expect(kanaSession(PAIRS, [], "2026-10-16", 6)).toEqual(kanaSession(PAIRS, [], "2026-10-16", 6));
    const miss = createEvent({ profileId: "p", deviceId: "d", deviceSeq: 1, type: "QUESTION_SUBMITTED", entityId: "x", payload: { kanaPair: PAIRS[2]!.contentId, isCorrect: false } });
    expect(kanaMistakes([miss]).get(PAIRS[2]!.contentId)).toBe(1);
    let first = 0;
    for (let d = 1; d <= 40; d++) { const day = `2026-11-${String(d % 28 + 1).padStart(2, "0")}-${d}`; if (kanaSession(PAIRS, Array.from({ length: 5 }, () => miss), day, 4)[0]!.refId === PAIRS[2]!.contentId) first++; }
    expect(first).toBeGreaterThan(14); // 25 % by chance; clearly boosted
    expect(parseKanaItemId(kanaItemId("kana:abc", "READ"))).toEqual({ pairId: "kana:abc", mode: "READ" });
  });
  it("lint: kana records need two different kana and two different readings", () => {
    expect(lintRecord(PAIRS[0]!)).toEqual([]);
    const bad = [kana("シ", "シ", "시", "츠"), kana("シ", "ツ", "시", "시"), kana("シ", "A", "시", "에이"), kana("シ", "つつ", "시", "츠")];
    for (const b of bad) expect(lintRecord(b).some((i) => i.code.startsWith("KANA_")), JSON.stringify(b.payload.chars)).toBe(true);
    expect(validateContentRecord(PAIRS[0]!)).toEqual([]);
  });
});

describe("grammar points as review cards", () => {
  const pool = seedRecords();
  const points = pool.filter((r) => r.kind === "GRAMMAR");
  const withQ = points.filter((g) => linkedQuestions(g, pool).length);
  it("a point with linked verified questions has one CLOZE card; one without has none", () => {
    expect(points.length).toBe(4);
    expect(withQ.length).toBeGreaterThanOrEqual(1);
    for (const g of withQ) expect(directionsFor(g, pool)).toEqual(["CLOZE"]);
    for (const g of points.filter((x) => !withQ.includes(x))) expect(directionsFor(g, pool)).toEqual([]);
    expect(allCards(pool, new Map()).filter((c) => points.some((g) => g.contentId === c.contentId)).length).toBe(withQ.length);
  });
  it("the first review shows the principle (intro) then a context question; later reviews rotate questions without the intro", () => {
    const g = withQ[0]!;
    const first = cardQuestion(g, "CLOZE", pool, "d", false, 0)!;
    expect(first.intro?.title).toContain("새 문법");
    expect(first.intro!.lines.join(" ")).toContain("뜻:");
    expect(first.refId).toBe(linkedQuestions(g, pool)[0]!.contentId);
    expect(() => new QuizSession([first])).not.toThrow();
    const wrong = first.choices.filter((c) => c.id !== first.correctChoiceId);
    expect(wrong.every((c) => c.whyWrong && c.howToCorrect)).toBe(true);
    const second = cardQuestion(g, "CLOZE", pool, "d", false, 1)!;
    expect(second.intro).toBeUndefined();
    expect(cardQuestion(g, "CLOZE", pool, "d", true, 0)!.intro).toBeUndefined(); // a retry never repeats the intro
    const n = linkedQuestions(g, pool).length;
    expect(cardQuestion(g, "CLOZE", pool, "d", false, n)!.refId).toBe(first.refId); // wraps around
  });
});

describe("grammar lint: items solvable from the ending alone are blocked", () => {
  const blocked: [string, string[]][] = [
    ["これを（　　）。", ["食べる", "食べた", "食べて", "食べない"]],
    ["手紙を（　　）。", ["書いた", "書いて", "書く", "書かない"]],
    ["本を（　　）。", ["読む", "読んだ", "読んで", "読まない"]],
    ["窓を（　　）。", ["開ける", "開けた", "開けて", "開けない"]],
    ["水を（　　）。", ["飲む", "飲んだ", "飲んで", "飲まない"]],
    ["この花は（　　）。", ["きれいだ", "きれいで", "きれいに", "きれいな"]],
  ];
  const allowed: [string, string[]][] = [
    ["昨日は雨が降っていたので、友達との約束を（　　）ことにした。", ["やめる", "やめた", "やめて", "やめない"]],
    ["私は毎朝、母が作ってくれたパンを（　　）から会社へ行きます。", ["食べる", "食べた", "食べて", "食べない"]],
    ["彼は昨日まで病気だったが、今日はもう元気に（　　）。", ["働く", "働いた", "働いて", "働かない"]],
    ["図書館で借りた本を、先生に（　　）。", ["返した", "あげた", "くれた", "もらった"]],
    ["雨が降りそうなので、傘を（　　）行きましょう。", ["持って", "持つ", "持った", "持たない"]],
    ["田中さんは来週から新しい会社で（　　）。", ["働く", "働いた", "働いて", "働かない"]],
  ];
  it.each(blocked)("blocks: %s", (stem, ch) => expect(endingOnlySolvable(stem, ch)).toBe(true));
  it.each(allowed)("allows: %s", (stem, ch) => expect(endingOnlySolvable(stem, ch)).toBe(false));
  it("choices that differ in meaning (not only in ending) are never flagged", () => {
    expect(endingOnlySolvable("明日（　　）。", ["行く", "来る", "帰る", "戻る"])).toBe(false);
  });
});
